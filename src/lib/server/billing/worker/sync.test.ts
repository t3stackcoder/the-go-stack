// Syncing is what makes somebody's subscription here the same as what Polar says it is. Broken, a
// person who has paid is told they have not, or one who has cancelled keeps their limit, or a
// webhook that arrived while Polar was being asked about is forgotten and the page stays wrong
// until the next time something happens. Polar is a hand-written fake here, so that what it says
// is exactly what each test decides; the database and Redis are real.

import { PolarRateLimitError } from '@polar-sh/sdk';
import { eq, type SQL, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingState, usageEvent } from '../../db/billing-schema.js';
import type { Standing } from '../polar/sync.js';
import { addUser, reachServices } from '../testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { removeDeleted, syncOnce } = await import('./sync.js');
const { readSubject, setEntitlementsScript, subjectKey } = await import('../redis.js');
const { storedFrom } = await import('../service.js');

const services = await reachServices(9);
afterAll(async () => services?.close());
afterEach(() => vi.restoreAllMocks());

const PERIOD = new Date('2026-11-01T00:00:00Z');
const END = new Date('2026-12-01T00:00:00Z');

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

/** What Polar says about somebody subscribed to the product, unless a field says otherwise. */
const standing = (fields: Partial<Standing> = {}): Standing => ({
	active: true,
	productId: 'product',
	periodStart: PERIOD,
	periodEnd: END,
	meters: { api_calls: { credited: 1000, consumed: 0 } },
	...fields
});

let counter = 0;
const subject = () => `subject-${++counter}`;

describe.skipIf(!services)('keeping subscriptions the same as Polar says', () => {
	const { redis, db } = services!;

	/** What the fake knows: the standing of each customer, and who it has been asked about. */
	let known: Map<string, Standing | null>;
	let asked: string[];
	let deleted: string[];
	let takes: number;
	/** What the fake throws, for a customer it is asked about or told to delete. */
	let failing: Map<string, unknown>;
	/** Something to do while Polar is being asked, to make a webhook arrive in the middle. */
	let meanwhile: ((subjectId: string) => Promise<void>) | undefined;

	const polar = {
		async customerState(subjectId: string) {
			asked.push(subjectId);
			if (failing.has(subjectId)) throw failing.get(subjectId);
			await meanwhile?.(subjectId);
			return known.get(subjectId) ?? null;
		},
		async deleteCustomer(subjectId: string) {
			if (failing.has(subjectId)) throw failing.get(subjectId);
			deleted.push(subjectId);
		}
	};
	const budget = {
		take: async () => {
			takes++;
		},
		pause() {}
	};
	const deps = () => ({ db, redis, polar, budget });

	beforeEach(async () => {
		known = new Map();
		asked = [];
		deleted = [];
		takes = 0;
		failing = new Map();
		meanwhile = undefined;
		await redis.flushDb();
		await db.delete(billingState);
		await db.delete(usageEvent);
	});

	/** A row as the worker or a webhook has left it. A webhook marks it with the database's own now(). */
	async function row(
		fields: Partial<Omit<typeof billingState.$inferInsert, 'dirtyAt'>> & { dirtyAt?: SQL } = {}
	) {
		const subjectId = subject();
		await db.insert(billingState).values({ subjectId, ...fields });
		return subjectId;
	}
	const dirty = { dirtyAt: sql`now()` };

	const stateOf = async (subjectId: string) =>
		(await db.select().from(billingState).where(eq(billingState.subjectId, subjectId)))[0];

	/** The lines recorded as errors that name `event`. */
	const recorded = (error: { mock: { calls: unknown[][] } }, event: string) =>
		error.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(event));

	/** A subscriber nothing has been heard about for seven hours, whom only the sweep finds. */
	const stale = () =>
		row({
			status: 'active',
			productId: 'product',
			periodStart: PERIOD,
			periodEnd: END,
			credits: { api_calls: 1000 },
			syncedAt: ago(7 * HOUR)
		});

	describe('a row a webhook has marked', () => {
		it('is brought to what Polar says, in Postgres and in Redis, and then unmarked', async () => {
			const id = await row({ version: 3, ...dirty });
			known.set(id, standing());

			expect(await syncOnce(deps())).toBe(1);

			const state = await stateOf(id);
			expect(state).toMatchObject({
				version: 4,
				status: 'active',
				productId: 'product',
				periodStart: PERIOD,
				periodEnd: END,
				credits: { api_calls: 1000 },
				dirtyAt: null
			});
			expect(state.syncedAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
			// A thousand credits and the catalogue's overage of 100.
			expect(await readSubject(redis, id)).toMatchObject({
				version: 4,
				status: 'active',
				limits: { api_calls: 1100 }
			});
			expect(asked).toEqual([id]);
			expect(takes).toBe(1);
		});

		it('keeps its version when Polar says what it already had', async () => {
			const id = await row({
				version: 3,
				status: 'active',
				productId: 'product',
				periodStart: PERIOD,
				periodEnd: END,
				credits: { api_calls: 1000 },
				...dirty
			});
			known.set(id, standing());

			await syncOnce(deps());

			expect(await stateOf(id)).toMatchObject({ version: 3, dirtyAt: null });
		});

		it.each([
			['the credits', { meters: { api_calls: { credited: 2000, consumed: 0 } } }],
			['the period', { periodStart: END, periodEnd: new Date('2027-01-01T00:00:00Z') }],
			['the product', { productId: 'another' }]
		])('goes up a version when only %s changed', async (_, change) => {
			const id = await row({
				version: 3,
				status: 'active',
				productId: 'product',
				periodStart: PERIOD,
				periodEnd: END,
				credits: { api_calls: 1000 },
				...dirty
			});
			known.set(id, standing(change));

			await syncOnce(deps());

			expect((await stateOf(id)).version).toBe(4);
		});

		it('becomes none when Polar does not know the customer, and Redis is told', async () => {
			const id = await row({
				version: 2,
				status: 'active',
				productId: 'product',
				periodStart: PERIOD,
				periodEnd: END,
				credits: { api_calls: 1000 },
				...dirty
			});
			await setEntitlementsScript(redis, id, storedFrom(await stateOf(id)));
			// Polar has no entry for this customer: the fake answers null.

			await syncOnce(deps());

			expect(await stateOf(id)).toMatchObject({
				version: 3,
				status: 'none',
				productId: null,
				periodStart: null,
				periodEnd: null,
				credits: {},
				dirtyAt: null
			});
			expect(await readSubject(redis, id)).toMatchObject({
				version: 3,
				status: 'none',
				limits: {}
			});
		});

		it('becomes none when Polar lists no subscription to the product', async () => {
			const id = await row({ version: 1, status: 'active', productId: 'product', ...dirty });
			known.set(
				id,
				standing({ active: false, productId: null, periodStart: null, periodEnd: null, meters: {} })
			);

			await syncOnce(deps());

			expect(await stateOf(id)).toMatchObject({ version: 2, status: 'none', productId: null });
		});

		it('stays marked when it was marked again while Polar was being asked, and is asked about again', async () => {
			// Marked a second ago, so that the mark made meanwhile is a later one to the millisecond.
			const id = await row({ version: 1, dirtyAt: sql`now() - interval '1 second'` });
			known.set(id, standing());
			meanwhile = async (subjectId) => {
				await db
					.update(billingState)
					.set({ dirtyAt: sql`now()` })
					.where(eq(billingState.subjectId, subjectId));
				meanwhile = undefined;
			};

			await syncOnce(deps());

			// What Polar said was taken, but the later mark is a question not yet put.
			const state = await stateOf(id);
			expect(state).toMatchObject({ status: 'active', version: 2 });
			expect(state.dirtyAt).not.toBeNull();

			await syncOnce(deps());
			expect(asked).toEqual([id, id]);
			expect((await stateOf(id)).dirtyAt).toBeNull();
		});

		it('is left alone when the account was deleted while Polar was being asked', async () => {
			const id = await row({ version: 1, ...dirty });
			known.set(id, standing());
			meanwhile = async (subjectId) => {
				await db.delete(billingState).where(eq(billingState.subjectId, subjectId));
			};

			expect(await syncOnce(deps())).toBe(1);

			expect(await stateOf(id)).toBeUndefined();
			expect(await readSubject(redis, id)).toBeNull();
		});
	});

	describe('a subscriber nobody has mentioned', () => {
		const active = {
			status: 'active',
			productId: 'product',
			periodStart: PERIOD,
			credits: { api_calls: 1000 }
		} as const;
		const future = new Date(Date.now() + 10 * 24 * HOUR);

		it.each([
			[
				'is asked about once six hours have passed',
				{ syncedAt: ago(7 * HOUR), periodEnd: future },
				true
			],
			['is left alone at five hours', { syncedAt: ago(5 * HOUR), periodEnd: future }, false],
			[
				'is left alone when it was asked about a minute ago',
				{ syncedAt: ago(60_000), periodEnd: future },
				false
			],
			[
				'is asked about when the period has ended and it was last asked over a minute ago',
				{ syncedAt: ago(2 * 60_000), periodEnd: ago(HOUR) },
				true
			],
			[
				'is left alone when the period has ended and it was asked about under a minute ago',
				{ syncedAt: ago(30_000), periodEnd: ago(HOUR) },
				false
			]
		])('%s', async (_, fields, isAsked) => {
			const id = await row({ ...active, ...fields });
			known.set(id, standing());

			await syncOnce(deps());

			expect(asked).toEqual(isAsked ? [id] : []);
		});

		it('is not asked about when it has no subscription, however long ago it was', async () => {
			await row({ status: 'none', syncedAt: ago(30 * 24 * HOUR) });

			expect(await syncOnce(deps())).toBe(0);
			expect(asked).toEqual([]);
			expect(takes).toBe(0);
		});

		it('is not asked about again once Polar has said that the next period began', async () => {
			const id = await row({ ...active, periodEnd: ago(HOUR), syncedAt: ago(5 * 60_000) });
			known.set(id, standing({ periodStart: END, periodEnd: new Date('2027-01-01T00:00:00Z') }));

			await syncOnce(deps());

			// The next period has begun, so it is no longer overdue and is not asked about again.
			expect(await syncOnce(deps())).toBe(0);
			expect(asked).toEqual([id]);
		});
	});

	describe('the sweep for subscribers nobody has mentioned', () => {
		it('is made about once a minute, while marked rows are asked about on every pass', async () => {
			const sweep = { dueAt: 0 };
			const first = await stale();

			await syncOnce(deps(), sweep);
			expect(asked).toEqual([first]);
			expect(sweep.dueAt).toBeGreaterThan(Date.now() + 50_000);

			const second = await stale();
			const marked = await row(dirty);
			await syncOnce(deps(), sweep);
			expect(asked).toEqual([first, marked]);

			sweep.dueAt = Date.now(); // A minute later.
			await syncOnce(deps(), sweep);
			expect(asked).toEqual([first, marked, second]);
		});

		it('stays due while it fills the batch, since there are more behind', async () => {
			const sweep = { dueAt: 0 };
			for (let i = 0; i < 25; i++) await stale();

			expect(await syncOnce(deps(), sweep)).toBe(20);
			expect(sweep.dueAt).toBeLessThanOrEqual(Date.now());

			expect(await syncOnce(deps(), sweep)).toBe(5);
			expect(sweep.dueAt).toBeGreaterThan(Date.now());
		});

		it('waits while marked rows fill the batch, which come first', async () => {
			const sweep = { dueAt: 0 };
			const forgotten = await stale();
			const marked: string[] = [];
			for (let i = 0; i < 20; i++) marked.push(await row(dirty));

			expect(await syncOnce(deps(), sweep)).toBe(20);
			expect(asked.sort()).toEqual(marked.sort());

			expect(await syncOnce(deps(), sweep)).toBe(1);
			expect(asked).toContain(forgotten);
		});
	});

	describe('when one person cannot be brought up to date', () => {
		it('is asked about again when Redis could not be written, and Redis ends up right', async () => {
			// A subscriber whose period ran out and whom no webhook mentioned: only the sweep finds
			// them. Redis still has the old period, and Polar has renewed them.
			const before = new Date('2026-10-01T00:00:00Z');
			const id = await row({
				version: 1,
				status: 'active',
				productId: 'product',
				periodStart: before,
				periodEnd: PERIOD,
				credits: { api_calls: 1000 },
				syncedAt: ago(5 * 60_000)
			});
			await setEntitlementsScript(redis, id, storedFrom(await stateOf(id)));
			known.set(id, standing());
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			// What Postgres says as Redis is written, which is what a worker that stopped there
			// would leave behind.
			let during: Awaited<ReturnType<typeof stateOf>> | undefined;
			vi.spyOn(redis, 'evalSha').mockImplementationOnce(async () => {
				during = await stateOf(id);
				throw new Error('Redis went away');
			});

			await expect(syncOnce(deps())).rejects.toThrow('failed for every one');
			expect(during).toMatchObject({ version: 2, periodStart: PERIOD });
			expect(during!.dirtyAt).not.toBeNull();
			expect(during!.syncedAt!.getTime()).toBeLessThan(Date.now() - 4 * 60_000);

			// Postgres has the new standing, which is no longer overdue, so it is marked: it does
			// not say it was asked about, and the sweep alone would not find it for six hours.
			const state = await stateOf(id);
			expect(state).toMatchObject({ version: 2, periodStart: PERIOD });
			expect(state.syncedAt!.getTime()).toBeLessThan(Date.now() - 4 * 60_000);
			expect(state.dirtyAt).not.toBeNull();
			expect(await readSubject(redis, id)).toMatchObject({ version: 1, periodStart: before });
			expect(recorded(error, 'billing sync failed for a customer')).toHaveLength(1);

			// Not in the very next pass: somebody who failed waits a while to be tried again.
			expect(await syncOnce(deps())).toBe(0);
			await db
				.update(billingState)
				.set({ dirtyAt: sql`now()` })
				.where(eq(billingState.subjectId, id));

			// Once their time has come, the pass finds nothing different, keeps version 2, and
			// Redis takes it.
			expect(await syncOnce(deps())).toBe(1);
			expect(asked).toEqual([id, id]);
			expect(await stateOf(id)).toMatchObject({ version: 2, dirtyAt: null });
			expect((await stateOf(id)).syncedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
			expect(await readSubject(redis, id)).toMatchObject({
				version: 2,
				periodStart: PERIOD,
				limits: { api_calls: 1100 }
			});
		});

		it('goes on to the next, records it, and sends the one that failed to the back', async () => {
			const broken = await row({ version: 1, dirtyAt: sql`now() - interval '3 seconds'` });
			const fine = await row({ version: 1, dirtyAt: sql`now() - interval '2 seconds'` });
			const later = await row({ version: 1, dirtyAt: sql`now() - interval '1 second'` });
			const laterMark = (await stateOf(later)).dirtyAt!;
			failing.set(broken, new Error('Polar fell over'));
			known.set(fine, standing());
			known.set(later, standing());
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});

			// Not thrown: the others were done, and the caller has no reason to wait.
			expect(await syncOnce(deps())).toBe(3);

			expect(asked).toEqual([broken, fine, later]);
			expect(await stateOf(fine)).toMatchObject({ status: 'active', dirtyAt: null });
			expect(await stateOf(later)).toMatchObject({ status: 'active', dirtyAt: null });
			const failed = await stateOf(broken);
			expect(failed).toMatchObject({ status: 'none', version: 1, syncedAt: null });
			expect(failed.dirtyAt!.getTime()).toBeGreaterThan(laterMark.getTime());
			const lines = recorded(error, 'billing sync failed for a customer');
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain(broken);
			expect(lines[0]).toContain('Polar fell over');
		});

		it('cannot keep the people marked after them waiting, even a whole batch of them', async () => {
			const broken: string[] = [];
			for (let i = 0; i < 20; i++) {
				const id = await row({ dirtyAt: sql`now() - interval '1 minute'` });
				failing.set(id, new Error('Polar fell over'));
				broken.push(id);
			}
			const waiting = await row({ dirtyAt: sql`now() - interval '1 second'` });
			known.set(waiting, standing());
			vi.spyOn(console, 'error').mockImplementation(() => {});

			// Every one failed, which is what Polar being down looks like, so the caller is told.
			await expect(syncOnce(deps())).rejects.toThrow('failed for every one of the 20');
			expect(asked).not.toContain(waiting);

			await syncOnce(deps());
			expect(asked[20]).toBe(waiting);
			expect(await stateOf(waiting)).toMatchObject({ status: 'active', dirtyAt: null });
		});

		it('is left alone for a while, so that one who fails every time is not in every pass', async () => {
			const broken = await row({ dirtyAt: sql`now() - interval '1 second'` });
			failing.set(broken, new Error('Polar fell over'));
			vi.spyOn(console, 'error').mockImplementation(() => {});

			// Alone in the pass they are the whole of it, and it is a failure.
			await expect(syncOnce(deps())).rejects.toThrow('failed for every one of the 1');

			// The next finds nobody to ask about, and is none. Were they still in it, every pass
			// would fail, and the worker would wait longer and longer between passes with a new
			// subscriber's webhook waiting behind them.
			expect(await syncOnce(deps())).toBe(0);
			expect(asked).toEqual([broken]);
			// Still marked, for a time that is yet to come.
			expect((await stateOf(broken)).dirtyAt!.getTime()).toBeGreaterThan(Date.now() + 10_000);
		});

		it('stops the pass at once when Polar says to wait, and leaves everyone as they were', async () => {
			const first = await row({ dirtyAt: sql`now() - interval '2 seconds'` });
			const second = await row({ dirtyAt: sql`now() - interval '1 second'` });
			const mark = (await stateOf(first)).dirtyAt;
			const limited = new PolarRateLimitError(429, 5);
			failing.set(first, limited);
			known.set(second, standing());

			await expect(syncOnce(deps())).rejects.toBe(limited);

			expect(asked).toEqual([first]);
			expect(takes).toBe(1);
			// Still at the front: it is not this person Polar refused, but every request.
			expect((await stateOf(first)).dirtyAt).toEqual(mark);
			expect((await stateOf(second)).dirtyAt).not.toBeNull();
		});
	});

	describe('use that Polar counted differently from the ledger', () => {
		/** The ledger's shipped use in the period, as one row. */
		async function shipped(
			subjectId: string,
			units: number,
			fields: Partial<typeof usageEvent.$inferInsert> = {}
		) {
			await db.insert(usageEvent).values({
				id: crypto.randomUUID(),
				recordedAt: PERIOD,
				subjectId,
				meter: 'api_calls',
				periodStart: PERIOD,
				units,
				shippedAt: new Date(),
				...fields
			});
		}

		/** How many times the difference was said, after syncing a customer Polar has counted `polarCounted` for. */
		async function drifts(polarCounted: number, ledger: (subjectId: string) => Promise<void>) {
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			const id = await row(dirty);
			await ledger(id);
			known.set(
				id,
				standing({ meters: { api_calls: { credited: 1000, consumed: polarCounted } } })
			);

			await syncOnce(deps());

			return error.mock.calls.filter((call) =>
				String(call[0]).includes('billing usage differs from polar')
			).length;
		}

		it.each([
			['the same', 1000, 1000, 0],
			['ten units under, which is within the tolerance', 1000, 990, 0],
			['eleven units under', 1000, 989, 1],
			['half a percent under, on a large count', 10_000, 9950, 0],
			['more than half a percent under, on a large count', 10_000, 9949, 1],
			['over, as well as under', 1000, 1011, 1]
		])('is %s', async (_, polarCounted, ledger, times) => {
			expect(await drifts(polarCounted, (id) => shipped(id, ledger))).toBe(times);
		});

		it('is counted from what was shipped, in the period, and nothing else', async () => {
			// Polar counted 100. The ledger has 100 shipped, and use that would make it differ:
			// unshipped, in another period, and by somebody else.
			const times = await drifts(100, async (id) => {
				await shipped(id, 100);
				await shipped(id, 500, { shippedAt: null });
				await shipped(id, 500, { periodStart: END });
				await shipped(subject(), 500);
			});

			expect(times).toBe(0);
		});

		it('is said when the ledger has nothing shipped and Polar has counted use', async () => {
			expect(await drifts(100, async () => {})).toBe(1);
		});
	});

	describe('removing accounts that have been deleted', () => {
		/** A use of theirs in the ledger, unsent unless a field says otherwise. Answers with its id. */
		async function use(subjectId: string, fields: Partial<typeof usageEvent.$inferInsert> = {}) {
			const id = crypto.randomUUID();
			await db.insert(usageEvent).values({
				id,
				recordedAt: PERIOD,
				subjectId,
				meter: 'api_calls',
				periodStart: PERIOD,
				units: 3,
				...fields
			});
			return id;
		}

		it('removes only rows with no account, from Polar and from Redis', async () => {
			const keeper = await row({
				status: 'active',
				version: 1,
				periodStart: PERIOD,
				periodEnd: END
			});
			await addUser(db, keeper);
			const goneA = await row({
				status: 'active',
				version: 1,
				periodStart: PERIOD,
				periodEnd: END
			});
			const goneB = await row({ version: 1 });
			for (const id of [keeper, goneA, goneB]) {
				await setEntitlementsScript(redis, id, storedFrom(await stateOf(id)));
			}
			await use(goneA, { shippedAt: new Date() });

			expect(await removeDeleted(deps())).toBe(2);

			expect(deleted.sort()).toEqual([goneA, goneB].sort());
			expect(await stateOf(keeper)).toBeDefined();
			expect(await stateOf(goneA)).toBeUndefined();
			expect(await stateOf(goneB)).toBeUndefined();
			expect(await redis.exists(subjectKey(keeper))).toBe(1);
			expect(await redis.exists(subjectKey(goneA))).toBe(0);
			expect(await redis.exists(subjectKey(goneB))).toBe(0);
			expect(takes).toBe(2);
			// The ledger is the record of what Polar was billed, and is kept.
			expect(await db.select().from(usageEvent)).toHaveLength(1);
		});

		it('does nothing when every row has an account', async () => {
			await addUser(db, await row());

			expect(await removeDeleted(deps())).toBe(0);
			expect(deleted).toEqual([]);
		});

		// Removed first, the customer would be gone from Polar when their last use was sent.
		it('waits until none of their use is still to be sent', async () => {
			const gone = await row({ version: 1 });
			const event = await use(gone);

			expect(await removeDeleted(deps())).toBe(0);
			expect(deleted).toEqual([]);
			expect(await stateOf(gone)).toBeDefined();

			await db.update(usageEvent).set({ shippedAt: new Date() }).where(eq(usageEvent.id, event));
			expect(await removeDeleted(deps())).toBe(1);
			expect(deleted).toEqual([gone]);
		});

		it('is not held back by use that was set aside, which is never sent', async () => {
			const gone = await row({ version: 1 });
			await use(gone, { shipError: 'Polar refused the event as invalid.' });

			expect(await removeDeleted(deps())).toBe(1);
			expect(deleted).toEqual([gone]);
		});

		it('goes on to the next when Polar cannot remove one, which stays to be tried again', async () => {
			const broken = await row({ version: 1 });
			const fine = await row({ version: 1 });
			failing.set(broken, new Error('Polar fell over'));
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await removeDeleted(deps())).toBe(2);

			expect(deleted).toEqual([fine]);
			expect(await stateOf(broken)).toBeDefined();
			expect(await stateOf(fine)).toBeUndefined();
			expect(recorded(error, 'billing remove failed for a customer')).toHaveLength(1);
		});

		it('stops at once when Polar says to wait', async () => {
			// Both, since the order Postgres hands them out in is its own.
			const limited = new PolarRateLimitError(429, 5);
			failing.set(await row({ version: 1 }), limited);
			failing.set(await row({ version: 1 }), limited);

			await expect(removeDeleted(deps())).rejects.toBe(limited);
			expect(takes).toBe(1);
		});
	});
});
