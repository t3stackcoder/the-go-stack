/**
 * The two things a request asks of billing: what somebody is entitled to, and whether a use is
 * allowed. Both are answered from Redis, in one round trip, and neither talks to Polar.
 *
 * Postgres is asked only to put back what Redis does not have: a person's entitlements the first
 * time they are wanted, and a period's counts the first time something is counted in it. And it
 * is what answers when Redis cannot be reached: a page can still say what somebody subscribes to,
 * slowly. A use cannot be counted without Redis, and is refused, because allowing what cannot be
 * counted is how a limit stops being one.
 *
 * One thing here writes to Postgres for a request, and it is neither a read nor a use:
 * `requestSync`, for the page a buyer waits on after paying.
 *
 * It is built from what it needs (`createBilling`) so that the tests can hand it a Redis and a
 * database of their own. The app's one instance is in ./index.ts.
 */
import { randomUUIDv7 } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { describeError } from '#lib/errors.js';
import type { db } from '#lib/server/db/index.js';
import { record } from '#lib/server/log.js';
import { billingState, usageEvent } from '../db/billing-schema.js';
import { limitsFor, METER_KEYS, type MeterKey } from './catalogue.js';
import {
	hydrateScript,
	type Redis,
	readSubject,
	recordUsageScript,
	type StoredEntitlements,
	type StoredSubject,
	setEntitlementsScript
} from './redis.js';

export type Database = typeof db;

/**
 * How often one person's waiting page can have Polar asked about them, as Postgres writes an
 * interval. The page looks once a second (#lib/billing/activation.ts), and Polar is rate limited.
 */
const ASK_AGAIN_AFTER = '5 seconds';

/** What an event's id has to be: the ledger keeps it in a `uuid` column, and Polar is sent it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BillingDeps {
	/** The connection, made the first time it is asked for. It rejects while Redis is down. */
	redis: () => Promise<Redis>;
	db: Database;
}

/** What somebody is entitled to, and how much of it they have used. */
export interface Entitlements {
	status: 'none' | 'active';
	productId: string | null;
	periodStart: Date | null;
	periodEnd: Date | null;
	/** `limit` is the most that may be used this period, or null where nothing stops it. */
	meters: Record<MeterKey, { consumed: number; limit: number | null }>;
}

export type UsageResult =
	| {
			allowed: true;
			/** This event had been recorded before, and was not counted again. */
			duplicate: boolean;
			/** What is left this period, or null where nothing stops it. */
			remaining: number | null;
	  }
	| { allowed: false; reason: 'inactive' | 'limit'; remaining: number };

/** A row of `billing.state` as it goes to Redis. No row is nobody's subscription, at version 0. */
export function storedFrom(row: typeof billingState.$inferSelect | undefined): StoredEntitlements {
	if (row?.status !== 'active') {
		return {
			version: row?.version ?? 0,
			status: 'none',
			productId: null,
			periodStart: null,
			periodEnd: null,
			limits: {}
		};
	}
	return {
		version: row.version,
		status: 'active',
		productId: row.productId,
		periodStart: row.periodStart,
		periodEnd: row.periodEnd,
		limits: limitsFor(row.credits)
	};
}

function entitlementsFrom(
	stored: StoredEntitlements,
	consumed: Record<string, number>
): Entitlements {
	return {
		status: stored.status,
		productId: stored.productId,
		periodStart: stored.periodStart,
		periodEnd: stored.periodEnd,
		meters: Object.fromEntries(
			METER_KEYS.map((key) => [
				key,
				{ consumed: consumed[key] ?? 0, limit: stored.limits[key] ?? null }
			])
		) as Entitlements['meters']
	};
}

export function createBilling({ redis, db }: BillingDeps) {
	/**
	 * What is being put back into Redis just now, so that requests that find the same thing
	 * missing wait for the one that is fetching it. Without this each of them asked Postgres for
	 * the same sum, at the moment Postgres has most to do: after Redis has lost what it held,
	 * everybody's counts are missing at once.
	 */
	const fetching = new Map<string, Promise<void>>();
	function once(what: string, fetch: () => Promise<void>): Promise<void> {
		let under = fetching.get(what);
		if (!under) {
			under = fetch().finally(() => fetching.delete(what));
			fetching.set(what, under);
		}
		return under;
	}

	async function stateOf(subjectId: string) {
		const [row] = await db
			.select()
			.from(billingState)
			.where(eq(billingState.subjectId, subjectId))
			.limit(1);
		return row;
	}

	/** What a person used of each meter in a period, added up from the ledger. */
	async function consumedIn(subjectId: string, periodStart: Date): Promise<Record<string, number>> {
		const rows = await db
			.select({ meter: usageEvent.meter, units: sql<string>`sum(${usageEvent.units})` })
			.from(usageEvent)
			.where(and(eq(usageEvent.subjectId, subjectId), eq(usageEvent.periodStart, periodStart)))
			.groupBy(usageEvent.meter);
		return Object.fromEntries(rows.map((row) => [row.meter, Number(row.units)]));
	}

	/** Puts a person's entitlements back into Redis, from Postgres. */
	function load(client: Redis, subjectId: string) {
		return once(`state:${subjectId}`, async () =>
			setEntitlementsScript(client, subjectId, storedFrom(await stateOf(subjectId)))
		);
	}

	/**
	 * Puts a period's counts back into Redis, from the ledger.
	 *
	 * What the ledger does not have yet is not counted: a use still in the stream, allowed in
	 * the last quarter second before the hash was lost, or in however long the worker has been
	 * stopped. The cost is that much use allowed past the limit, and still billed. The hash is
	 * lost without the stream when Redis is told to forget it, when a subscription lapses and
	 * comes back within one period, and when nothing has written to it for a week (`SUBJECT_TTL`
	 * in ./redis.ts).
	 */
	function hydrate(client: Redis, subjectId: string, periodStart: Date) {
		return once(`counts:${subjectId}:${periodStart.getTime()}`, async () =>
			hydrateScript(
				client,
				subjectId,
				periodStart.getTime(),
				await consumedIn(subjectId, periodStart)
			)
		);
	}

	/** A person's hash, with whatever it lacked put back first. One round trip when it lacks nothing. */
	async function subjectOf(client: Redis, subjectId: string): Promise<StoredSubject> {
		let subject = await readSubject(client, subjectId);
		if (!subject) {
			await load(client, subjectId);
			subject = await readSubject(client, subjectId);
		}
		if (subject?.status === 'active' && !subject.hydrated && subject.periodStart) {
			await hydrate(client, subjectId, subject.periodStart);
			subject = await readSubject(client, subjectId);
		}
		if (!subject) {
			throw new Error('Billing wrote a hash to Redis and could not read it back.');
		}
		return subject;
	}

	/** The same answer from Postgres alone, for when Redis cannot be reached. */
	async function entitlementsFromDatabase(subjectId: string): Promise<Entitlements> {
		const stored = storedFrom(await stateOf(subjectId));
		const consumed = stored.periodStart ? await consumedIn(subjectId, stored.periodStart) : {};
		return entitlementsFrom(stored, consumed);
	}

	return {
		/**
		 * What somebody is entitled to and has used. It does not throw because Redis is down: the
		 * answer then comes from Postgres, a moment behind (what is still in the stream is not
		 * counted), and the fault is recorded.
		 */
		async entitlements(subjectId: string): Promise<Entitlements> {
			let subject: StoredSubject;
			try {
				subject = await subjectOf(await redis(), subjectId);
			} catch (error) {
				record('error', 'billing read fell back to postgres', describeError(error));
				return entitlementsFromDatabase(subjectId);
			}
			return entitlementsFrom(subject, subject.consumed);
		},

		/**
		 * Counts one use against a meter, if it is allowed: call it before doing the work, and do
		 * the work only if it says `allowed`.
		 *
		 * `eventId` is what makes a second try safe. Left out, each call is a new event. Given, a
		 * call repeated with the same one within five minutes is counted once. It has to be a
		 * UUID, made for this use and for nothing else: it becomes the ledger's key and the id
		 * Polar knows the event by. Anything else is refused here, where the caller can see it.
		 * Let through, it would be counted, and then could not be written to the ledger.
		 *
		 * It throws if Redis cannot be reached, and the caller should answer 503.
		 */
		async recordUsage(use: {
			subjectId: string;
			meter: MeterKey;
			units?: number;
			eventId?: string;
		}): Promise<UsageResult> {
			const { subjectId, meter, units = 1, eventId = randomUUIDv7() } = use;
			if (!Number.isSafeInteger(units) || units < 1) {
				throw new RangeError(
					`Usage is counted in whole units of 1 or more, and was given ${units}.`
				);
			}
			if (!UUID.test(eventId)) {
				throw new RangeError(`An event's id has to be a UUID, and was given "${eventId}".`);
			}

			const client = await redis();
			// Three times for somebody Redis has nothing of: once to find the hash missing, once to
			// find its counts missing, and once to count. A fourth allows for the period turning
			// between the second and the third, when the counts fetched are the old period's.
			for (let attempt = 0; attempt < 4; attempt++) {
				const reply = await recordUsageScript(client, { subjectId, meter, units, eventId });

				if (reply.answer === 'MISS') await load(client, subjectId);
				else if (reply.answer === 'COLD') {
					await hydrate(client, subjectId, new Date(reply.periodStart));
				} else if (reply.answer === 'DENY') {
					return { allowed: false, reason: reply.reason, remaining: reply.remaining };
				} else {
					return {
						allowed: true,
						duplicate: reply.answer === 'DUP',
						remaining: reply.remaining
					};
				}
			}
			throw new Error('A use could not be counted: its hash in Redis would not stay loaded.');
		},

		/**
		 * Has the worker ask Polar about somebody now, for the page a buyer comes back to after
		 * paying (src/routes/billing/activating). It marks their row as a webhook does, and makes
		 * the row if they have none.
		 *
		 * A subscription normally starts because Polar's webhook arrives (./webhook.ts). If none
		 * did, nothing else asked: the worker asks Polar of its own accord only about people who
		 * subscribe already. Somebody who had paid waited on that page for a subscription that
		 * never came, and was refused everything they had bought. Coming back from the checkout is
		 * the one sign this site has of a payment that does not depend on Polar reaching it.
		 *
		 * Anybody signed in can open that page, as often as they like, so a mark is made at most
		 * once in `ASK_AGAIN_AFTER` for a person, and not while one is waiting already. It does not
		 * throw. If Postgres cannot be reached, the fault is recorded and the page goes on waiting
		 * for the webhook.
		 */
		async requestSync(subjectId: string): Promise<void> {
			try {
				await db.execute(sql`
					insert into billing.state as held (subject_id, dirty_at)
					select id, now() from "user" where id = ${subjectId}
					on conflict (subject_id) do update set dirty_at = now()
					where held.dirty_at is null
						and (held.synced_at is null
							or held.synced_at < now() - ${ASK_AGAIN_AFTER}::interval)
				`);
			} catch (error) {
				record('error', 'billing could not ask for a sync', describeError(error));
			}
		}
	};
}

export type Billing = ReturnType<typeof createBilling>;
