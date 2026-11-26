// What a person sees on their billing page, and whether the thing they paid for lets them use
// it. Broken, somebody who subscribes is told they do not, or is let past their limit, or loses
// the use they had made when Redis forgets it, or finds the page down because Redis is. The
// service is put together here from a real Redis and a real Postgres, the same two it is made
// from in the app.

import { randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { billingState, usageEvent } from '../db/billing-schema.js';
import { addUser, reachServices } from './testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { createBilling } = await import('./service.js');
const { readSubject, subjectKey } = await import('./redis.js');

const services = await reachServices(12);
afterAll(async () => services?.close());
afterEach(() => vi.restoreAllMocks());

const PERIOD = new Date('2026-11-01T00:00:00Z');
const LAST_PERIOD = new Date('2026-10-01T00:00:00Z');

let counter = 0;
/** A subject nobody else in this file has used. */
const subject = () => `subject-${++counter}`;

describe.skipIf(!services)('billing as a request sees it', () => {
	const { redis, db } = services!;
	const billing = createBilling({ redis: async () => redis, db });

	/** A subscriber in Postgres only, as the worker leaves one: nothing of them in Redis yet. */
	async function subscriber(credits = 5) {
		const subjectId = subject();
		await db.insert(billingState).values({
			subjectId,
			version: 1,
			status: 'active',
			productId: 'product',
			periodStart: PERIOD,
			periodEnd: new Date('2026-12-01T00:00:00Z'),
			credits: { api_calls: credits }
		});
		return subjectId;
	}

	/** Use already in the ledger, in the period it was allowed in. */
	async function inLedger(subjectId: string, periodStart: Date, ...units: number[]) {
		await db.insert(usageEvent).values(
			units.map((each) => ({
				id: randomUUIDv7(),
				recordedAt: periodStart,
				subjectId,
				meter: 'api_calls',
				periodStart,
				units: each
			}))
		);
	}

	describe('what somebody is entitled to', () => {
		it('is nothing for somebody with no row, and that is kept in Redis at version 0', async () => {
			const id = subject();

			expect(await billing.entitlements(id)).toEqual({
				status: 'none',
				productId: null,
				periodStart: null,
				periodEnd: null,
				meters: { api_calls: { consumed: 0, limit: null } }
			});
			expect(await readSubject(redis, id)).toMatchObject({ version: 0, status: 'none' });
		});

		it('is read back from Postgres for a subscriber Redis has no hash for', async () => {
			const id = await subscriber(5);
			await inLedger(id, PERIOD, 7, 3);
			// Another period's use is not this period's.
			await inLedger(id, LAST_PERIOD, 100);

			const entitled = await billing.entitlements(id);

			expect(entitled).toMatchObject({
				status: 'active',
				productId: 'product',
				periodStart: PERIOD,
				// Five credits and the catalogue's overage of 100.
				meters: { api_calls: { consumed: 10, limit: 105 } }
			});
		});

		it('is put back after Redis loses the hash, with the use the ledger holds', async () => {
			const id = await subscriber();
			await billing.entitlements(id);
			await redis.del(subjectKey(id));
			await inLedger(id, PERIOD, 4);

			expect((await billing.entitlements(id)).meters.api_calls.consumed).toBe(4);
		});

		it('keeps the counts of a hash that is there, without asking Postgres again', async () => {
			const id = await subscriber();
			await billing.entitlements(id);
			await billing.recordUsage({ subjectId: id, meter: 'api_calls', units: 2 });
			// A row in the ledger that the hash has not been told of must not be added on top.
			await inLedger(id, PERIOD, 50);

			expect((await billing.entitlements(id)).meters.api_calls.consumed).toBe(2);
		});
	});

	describe('counting a use', () => {
		it('refuses somebody with no subscription', async () => {
			expect(await billing.recordUsage({ subjectId: subject(), meter: 'api_calls' })).toEqual({
				allowed: false,
				reason: 'inactive',
				remaining: 0
			});
		});

		it('allows a subscriber, whose hash it has to put back first', async () => {
			const id = await subscriber(5);

			expect(await billing.recordUsage({ subjectId: id, meter: 'api_calls' })).toEqual({
				allowed: true,
				duplicate: false,
				remaining: 104
			});
		});

		it('counts from what the ledger holds when the period is new to Redis', async () => {
			const id = await subscriber(5);
			await inLedger(id, PERIOD, 100);
			await inLedger(id, LAST_PERIOD, 100);

			expect(await billing.recordUsage({ subjectId: id, meter: 'api_calls', units: 6 })).toEqual({
				allowed: false,
				reason: 'limit',
				remaining: 5
			});
			expect(await billing.recordUsage({ subjectId: id, meter: 'api_calls', units: 5 })).toEqual({
				allowed: true,
				duplicate: false,
				remaining: 0
			});
		});

		it('says duplicate for the same event id, and does not count it twice', async () => {
			const id = await subscriber(5);
			const eventId = randomUUIDv7();
			const use = { subjectId: id, meter: 'api_calls', units: 100, eventId } as const;

			expect(await billing.recordUsage(use)).toEqual({
				allowed: true,
				duplicate: false,
				remaining: 5
			});
			expect(await billing.recordUsage(use)).toEqual({
				allowed: true,
				duplicate: true,
				remaining: 5
			});
			expect((await billing.entitlements(id)).meters.api_calls.consumed).toBe(100);
		});

		it('counts each call as a new event when no event id is given', async () => {
			const id = await subscriber(5);

			await billing.recordUsage({ subjectId: id, meter: 'api_calls' });
			const second = await billing.recordUsage({ subjectId: id, meter: 'api_calls' });

			expect(second).toMatchObject({ allowed: true, duplicate: false });
			expect((await billing.entitlements(id)).meters.api_calls.consumed).toBe(2);
		});

		it('stops at the limit and says what is left', async () => {
			const id = await subscriber(5);
			await billing.recordUsage({ subjectId: id, meter: 'api_calls', units: 100 });

			expect(await billing.recordUsage({ subjectId: id, meter: 'api_calls', units: 6 })).toEqual({
				allowed: false,
				reason: 'limit',
				remaining: 5
			});
		});

		it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])(
			'throws for %s units, which is not a whole number of 1 or more',
			async (units) => {
				await expect(
					billing.recordUsage({ subjectId: subject(), meter: 'api_calls', units })
				).rejects.toBeInstanceOf(RangeError);
			}
		);
	});

	describe("an event id of the caller's own", () => {
		it.each(['req_abc123', '', 'not-a-uuid', '0193a2b4-7c1e-7d90-8a2e-5b9f6c3d0b0'])(
			'is refused as "%s", which the ledger could not keep',
			async (eventId) => {
				// Counted, it would sit in the stream and fail the write of every use beside it.
				const id = await subscriber(5);

				await expect(
					billing.recordUsage({ subjectId: id, meter: 'api_calls', eventId })
				).rejects.toBeInstanceOf(RangeError);
				expect((await billing.entitlements(id)).meters.api_calls.consumed).toBe(0);
			}
		);
	});

	describe('many requests for somebody Redis has nothing of', () => {
		it('ask Postgres once between them, and all get the answer', async () => {
			// After Redis has lost what it held, every subscriber's counts are missing at once.
			// Each request asking for the same sum is Postgres doing the same work many times
			// over, at the moment it has most to do.
			const id = await subscriber(5);
			await inLedger(id, PERIOD, 3, 4);
			const selects = vi.spyOn(db, 'select');

			const answers = await Promise.all(Array.from({ length: 25 }, () => billing.entitlements(id)));

			// The row, and the sum.
			expect(selects).toHaveBeenCalledTimes(2);
			for (const answer of answers) expect(answer.meters.api_calls.consumed).toBe(7);
		});

		it('count every use, and not one of them twice', async () => {
			const id = await subscriber(50);
			await inLedger(id, PERIOD, 10);

			const answers = await Promise.all(
				Array.from({ length: 25 }, () => billing.recordUsage({ subjectId: id, meter: 'api_calls' }))
			);

			expect(answers.every((answer) => answer.allowed)).toBe(true);
			expect((await billing.entitlements(id)).meters.api_calls.consumed).toBe(35);
		});
	});

	describe('asking for the worker to ask Polar, from the page a buyer waits on', () => {
		const row = async (subjectId: string) =>
			(await db.select().from(billingState).where(eq(billingState.subjectId, subjectId)))[0];
		/** As the worker leaves a row it has just asked Polar about: not marked, and asked at `when`. */
		const asked = (subjectId: string, when: Date) =>
			db
				.update(billingState)
				.set({ dirtyAt: null, syncedAt: when })
				.where(eq(billingState.subjectId, subjectId));
		const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

		it('makes a marked row for somebody with an account and none yet', async () => {
			const id = subject();
			await addUser(db, id);

			await billing.requestSync(id);

			expect(await row(id)).toMatchObject({ status: 'none', syncedAt: null });
			expect((await row(id)).dirtyAt).toBeInstanceOf(Date);
		});

		it("makes no row for an id that is nobody's account", async () => {
			// The worker takes a row with no account behind it for a deleted account's, and
			// removes that customer from Polar.
			const id = subject();

			await billing.requestSync(id);

			expect(await row(id)).toBeUndefined();
		});

		it('leaves a mark that is waiting as it is, however often the page looks', async () => {
			const id = subject();
			await addUser(db, id);
			await billing.requestSync(id);
			const first = (await row(id)).dirtyAt;

			await billing.requestSync(id);
			await billing.requestSync(id);

			expect((await row(id)).dirtyAt).toEqual(first);
		});

		it('does not mark again when Polar was asked a moment ago', async () => {
			const id = subject();
			await addUser(db, id);
			await billing.requestSync(id);
			await asked(id, ago(1));

			await billing.requestSync(id);

			expect((await row(id)).dirtyAt).toBeNull();
		});

		it('marks again once a few seconds have passed since Polar was asked', async () => {
			// Polar may not have had the subscription the first time it was asked.
			const id = subject();
			await addUser(db, id);
			await billing.requestSync(id);
			await asked(id, ago(30));

			await billing.requestSync(id);

			expect((await row(id)).dirtyAt).toBeInstanceOf(Date);
		});

		it('does not fail the page when Postgres cannot be reached, and says so in the log', async () => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(db, 'execute').mockRejectedValue(new Error('postgres is away'));

			await expect(billing.requestSync(subject())).resolves.toBeUndefined();
			expect(String(error.mock.calls[0][0])).toContain('billing could not ask for a sync');
		});
	});

	describe('when Redis is down', () => {
		const down = createBilling({ redis: () => Promise.reject(new Error('down')), db });

		it('answers what somebody is entitled to from Postgres, and says so in the log', async () => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			const id = await subscriber(5);
			await inLedger(id, PERIOD, 7);

			expect(await down.entitlements(id)).toMatchObject({
				status: 'active',
				periodStart: PERIOD,
				meters: { api_calls: { consumed: 7, limit: 105 } }
			});
			expect(error).toHaveBeenCalledOnce();
			expect(String(error.mock.calls[0][0])).toContain('billing read fell back to postgres');
		});

		it('answers nothing for somebody with no row', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});

			expect((await down.entitlements(subject())).status).toBe('none');
		});

		it('cannot count a use, and throws so that the caller can answer 503', async () => {
			const id = await subscriber(5);

			await expect(down.recordUsage({ subjectId: id, meter: 'api_calls' })).rejects.toThrow('down');
		});
	});
});
