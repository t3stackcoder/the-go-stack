/**
 * Keeps `billing.state`, and its copy in Redis, the same as what Polar says.
 *
 * There is one way a row is brought up to date: Polar is asked for the customer's whole state,
 * and the row is made to match. A webhook does not carry the change. It only marks the row as
 * needing to be asked about (../webhook.ts). So it does not matter if Polar sends a webhook
 * twice, or two of them in the wrong order, or one for something this code has never heard of:
 * each can only cause a question, and the answer is always Polar's latest.
 *
 * A webhook that never arrives is covered the same way, by asking anyway: about every subscriber
 * now and then, and about one whose period has run out, since that is when Polar renews it.
 *
 * One person Polar cannot be asked about, or whose answer cannot be written, costs only that
 * person: the failure is recorded and the rest of the batch goes on. A rate limit is not about
 * any one person, and ends the pass at once.
 */
import { PolarClientError } from '@polar-sh/sdk';
import { and, asc, eq, isNotNull, isNull, lt, lte, notExists, or, sql } from 'drizzle-orm';
import { describeError } from '#lib/errors.js';
import { record } from '#lib/server/log.js';
import { user } from '../../db/auth-schema.js';
import { billingState, usageEvent } from '../../db/billing-schema.js';
import { METER_KEYS } from '../catalogue.js';
import type { Standing, SyncCalls } from '../polar/sync.js';
import { type Redis, setEntitlementsScript, subjectKey } from '../redis.js';
import { type Database, storedFrom } from '../service.js';
import type { Budget } from './budget.js';

/** How many people are asked about in one pass. The rest wait for the next, a moment later. */
const BATCH = 20;
/** A subscriber nothing has been heard about for this long is asked about anyway. */
const STALE_AFTER = sql`interval '6 hours'`;
/** One whose period has run out is asked about this often until Polar says what came next. */
const OVERDUE_EVERY = sql`interval '1 minute'`;
/**
 * How long somebody Polar could not be asked about waits before they are asked about again. Their
 * mark is moved this far ahead, and a mark is only acted on once its time has come. Tried again
 * at once, one person who fails every time was in every pass. Alone in it, they made the pass a
 * failure, the worker waited longer after each (./main.ts), and a new subscriber's webhook could
 * wait half a minute for a worker that should have got to it in half a second. It is short enough
 * that somebody whose one failure was a passing fault is still asked about again while they
 * watch the page that waits for them.
 */
const RETRY_AFTER = sql`interval '15 seconds'`;
/** How often the sweep for those two is made, in milliseconds, once it has found all there were. */
const SWEEP_EVERY = 60_000;

/** Polar's answer that it will take no more requests for now, which no other subject would change. */
const isRateLimit = (error: unknown) =>
	error instanceof PolarClientError && error.statusCode === 429;

export interface SyncDeps {
	db: Database;
	redis: Redis;
	polar: Pick<SyncCalls, 'customerState' | 'deleteCustomer'>;
	budget: Budget;
}

type Row = typeof billingState.$inferSelect;

/** What a row should say, given Polar's answer. Nobody Polar knows of subscribes to nothing. */
function fromStanding(standing: Standing | null) {
	if (!standing?.active) {
		return {
			status: 'none' as const,
			productId: null,
			periodStart: null,
			periodEnd: null,
			credits: {}
		};
	}
	const credits: Record<string, number> = {};
	for (const key of METER_KEYS) {
		const meter = standing.meters[key];
		if (meter) credits[key] = meter.credited;
	}
	return {
		status: 'active' as const,
		productId: standing.productId,
		periodStart: standing.periodStart,
		periodEnd: standing.periodEnd,
		credits
	};
}

function differs(row: Row, next: ReturnType<typeof fromStanding>): boolean {
	return (
		row.status !== next.status ||
		row.productId !== next.productId ||
		row.periodStart?.getTime() !== next.periodStart?.getTime() ||
		row.periodEnd?.getTime() !== next.periodEnd?.getTime() ||
		JSON.stringify(Object.entries(row.credits).sort()) !==
			JSON.stringify(Object.entries(next.credits).sort())
	);
}

/**
 * Says so when Polar has counted a different amount of use than this site sent it.
 *
 * Nothing is corrected. An event Polar has taken cannot be changed or taken back, so sending
 * more to make the numbers meet would only be a second error, and the ledger is the record of
 * what was allowed. A difference is for a person to explain. Some of it is expected at the turn
 * of a period: an event allowed just before it and received by Polar just after is in the
 * ledger's old period and in Polar's new one.
 */
async function reportDrift(db: Database, subjectId: string, standing: Standing) {
	if (!standing.periodStart) return;
	const sent = await db
		.select({ meter: usageEvent.meter, units: sql<string>`sum(${usageEvent.units})` })
		.from(usageEvent)
		.where(
			and(
				eq(usageEvent.subjectId, subjectId),
				eq(usageEvent.periodStart, standing.periodStart),
				isNotNull(usageEvent.shippedAt)
			)
		)
		.groupBy(usageEvent.meter);

	for (const key of METER_KEYS) {
		const polar = standing.meters[key]?.consumed;
		if (polar === undefined) continue;
		const ledger = Number(sent.find((row) => row.meter === key)?.units ?? 0);
		// Ten units or half a percent, whichever is more: below that it is the turn of a period.
		if (Math.abs(polar - ledger) > Math.max(10, polar * 0.005)) {
			record('error', 'billing usage differs from polar', { subjectId, meter: key, polar, ledger });
		}
	}
}

/**
 * Does `work` for each subject in a batch, each with a call from the budget, so that one that
 * fails costs only that one: it is recorded, `failed` is told, and the rest go on.
 *
 * A rate limit is thrown at once, as is a wait for the budget that the worker cut short by
 * stopping. Neither is about the subject, and the next would meet the same. So is a batch in
 * which every one failed, once each is recorded, since that is Polar, Redis or Postgres being
 * away and the caller should wait before trying again. A batch in which only some failed is not
 * thrown: the rest were done, and waiting would only hold up the people behind them.
 */
async function eachAlone<T extends { subjectId: string }>(
	job: string,
	batch: T[],
	budget: Budget,
	work: (item: T) => Promise<void>,
	failed: (item: T) => Promise<void> = async () => {}
): Promise<void> {
	let failures = 0;
	for (const item of batch) {
		await budget.take();
		try {
			await work(item);
		} catch (error) {
			if (isRateLimit(error)) throw error;
			failures++;
			record('error', `billing ${job} failed for a customer`, {
				subjectId: item.subjectId,
				...describeError(error)
			});
			await failed(item);
		}
	}
	if (failures > 0 && failures === batch.length) {
		throw new Error(
			`Billing ${job} failed for every one of the ${batch.length} customers in the batch. Each failure is recorded.`
		);
	}
}

/**
 * When the next sweep is due: the question about subscribers who are stale or overdue, which no
 * index can answer and so reads the whole of `billing.state`. The worker keeps one of these from
 * pass to pass, so that it sweeps about once a minute and not every half second. Left out, every
 * pass sweeps.
 */
export interface SweepSchedule {
	/** The time, as `Date.now()` gives it, from which the next pass sweeps. */
	dueAt: number;
}

/**
 * Asks Polar about everyone who needs asking about, a batch at a time, and answers with how many
 * that was. Nought means nobody does, and the caller can rest.
 *
 * Those a webhook named are found on every pass, from the index that holds only the marked, and
 * come first: somebody may be watching a page for the answer. The sweep fills whatever room they
 * leave, when it is due. While it fills the room it stays due, since there are more behind; once
 * it finds fewer, it is due again in a minute.
 */
export async function syncOnce(
	{ db, redis, polar, budget }: SyncDeps,
	sweep: SweepSchedule = { dueAt: 0 }
): Promise<number> {
	const due = await db
		.select()
		.from(billingState)
		// A mark with a time still to come is somebody who failed and is waiting to be tried again.
		.where(lte(billingState.dirtyAt, sql`now()`))
		.orderBy(asc(billingState.dirtyAt))
		.limit(BATCH);

	const room = BATCH - due.length;
	if (room > 0 && Date.now() >= sweep.dueAt) {
		const forgotten = await db
			.select()
			.from(billingState)
			.where(
				and(
					isNull(billingState.dirtyAt),
					eq(billingState.status, 'active'),
					or(
						lt(billingState.syncedAt, sql`now() - ${STALE_AFTER}`),
						and(
							lt(billingState.periodEnd, sql`now()`),
							lt(billingState.syncedAt, sql`now() - ${OVERDUE_EVERY}`)
						)
					)
				)
			)
			.limit(room);
		due.push(...forgotten);
		if (forgotten.length < room) sweep.dueAt = Date.now() + SWEEP_EVERY;
	}

	await eachAlone(
		'sync',
		due,
		budget,
		async (row) => {
			const standing = await polar.customerState(row.subjectId);
			const next = fromStanding(standing);

			// In this order, so that nothing says the row is up to date until Redis has it too:
			// the row's new standing, then Redis, and only then that it was asked about. The first
			// write also marks the row, if nothing had, because the new standing can take it out
			// of the sweep (a renewed period is no longer overdue) and only a mark would then
			// bring it back. So stopping or failing between any two steps leaves the row marked,
			// and the whole of it is done again. That time finds no difference and keeps the
			// version this time gave it, which Redis has not got if this time failed there, and
			// so takes.
			const mark = row.dirtyAt ?? new Date();
			const [written] = await db
				.update(billingState)
				.set({
					...next,
					version: differs(row, next) ? row.version + 1 : row.version,
					dirtyAt: sql`coalesce(${billingState.dirtyAt}, ${mark})`
				})
				.where(eq(billingState.subjectId, row.subjectId))
				.returning();
			// The row can be gone: the account was deleted while Polar was being asked.
			if (!written) return;

			await setEntitlementsScript(redis, row.subjectId, storedFrom(written));

			// The mark is cleared only if it is still the one this pass saw, or made. A webhook
			// that arrived while Polar was being asked has set a later one, and that question is
			// still to be put. Compared to the millisecond, which is all of the time that
			// JavaScript keeps.
			await db
				.update(billingState)
				.set({
					syncedAt: sql`now()`,
					dirtyAt: sql`case when date_trunc('milliseconds', ${billingState.dirtyAt}) = ${mark} then null else ${billingState.dirtyAt} end`
				})
				.where(eq(billingState.subjectId, row.subjectId));

			if (standing?.active) await reportDrift(db, row.subjectId, standing);
		},
		async (row) => {
			// Out of the queue for a while (see RETRY_AFTER), so that people who fail every time
			// cannot keep everyone marked after them from being asked about. Only if it is marked:
			// one the sweep found and that failed before it was written is found by the next
			// sweep, as it is now.
			await db
				.update(billingState)
				.set({ dirtyAt: sql`now() + ${RETRY_AFTER}` })
				.where(and(eq(billingState.subjectId, row.subjectId), isNotNull(billingState.dirtyAt)));
		}
	);

	return due.length;
}

/**
 * Removes from Polar the customers whose accounts here have been deleted, and forgets them.
 *
 * It goes by `billing.state`, which only ever holds people who had an account when the row was
 * made (../webhook.ts), and never by a list of Polar's customers: an organisation at Polar may
 * have customers this site did not put there, and they are not this site's to delete.
 *
 * The ledger keeps its rows. They name an account's id and nothing else about the person, and
 * they are the record of what Polar was billed for. A customer is removed only once none of
 * theirs is still to be sent, or ./ship.ts would go on to send Polar events for a customer it no
 * longer has.
 * A row that was set aside is never sent, and does not hold the removal back.
 */
export async function removeDeleted({ db, redis, polar, budget }: SyncDeps): Promise<number> {
	const gone = await db
		.select({ subjectId: billingState.subjectId })
		.from(billingState)
		.where(
			and(
				notExists(db.select().from(user).where(eq(user.id, billingState.subjectId))),
				notExists(
					db
						.select()
						.from(usageEvent)
						.where(
							and(
								eq(usageEvent.subjectId, billingState.subjectId),
								isNull(usageEvent.shippedAt),
								isNull(usageEvent.shipError)
							)
						)
				)
			)
		)
		.limit(BATCH);

	await eachAlone('remove', gone, budget, async ({ subjectId }) => {
		await polar.deleteCustomer(subjectId);
		await db.delete(billingState).where(eq(billingState.subjectId, subjectId));
		await redis.del(subjectKey(subjectId));
		record('info', 'billing customer removed', { subjectId });
	});

	return gone.length;
}
