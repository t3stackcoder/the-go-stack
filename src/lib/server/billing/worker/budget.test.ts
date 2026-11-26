// The budget is what stops the worker from using up Polar's rate limit, and so from making a
// person who pressed Upgrade wait for an error. Broken one way, the worker floods Polar and
// somebody's checkout is refused; broken the other, it waits when it need not and usage reaches
// Polar late, in the wrong period. Time here is a number the test moves, and waiting is a note
// of how long was asked for, so nothing sleeps.

import { describe, expect, it } from 'vitest';
import { createBudget } from './budget.js';

/** A budget over a clock that only moves when it waits or is told to. */
function budgetWith(limitPerMinute: number) {
	let time = 1_000_000;
	const waits: number[] = [];
	const budget = createBudget(limitPerMinute, {
		now: () => time,
		wait: async (ms) => {
			waits.push(ms);
			time += ms;
		}
	});
	return {
		budget,
		waits,
		advance: (ms: number) => {
			time += ms;
		},
		elapsed: () => time - 1_000_000
	};
}

/** Takes `count` in a row, answering with how many times it had to wait to do so. */
async function takeMany(budget: { take(): Promise<void> }, waits: number[], count: number) {
	const before = waits.length;
	for (let i = 0; i < count; i++) await budget.take();
	return waits.length - before;
}

// 100 a minute is a bucket of 5 (5% of the limit), and one token back every 750 ms, which is 80
// a minute (the worker's share).
describe('the budget for calls to Polar', () => {
	it('lets a burst of its capacity through at once, which is 5% of the limit', async () => {
		const { budget, waits } = budgetWith(100);

		expect(await takeMany(budget, waits, 5)).toBe(0);
	});

	it('makes the next call wait about one refill interval', async () => {
		const { budget, waits } = budgetWith(100);
		await takeMany(budget, waits, 5);

		await budget.take();

		expect(waits).toEqual([750]);
	});

	it('then lets calls through at the rate the limit allows, one a refill interval', async () => {
		const { budget, waits, elapsed } = budgetWith(100);
		await takeMany(budget, waits, 5);

		await takeMany(budget, waits, 40);

		expect(waits).toHaveLength(40);
		expect(elapsed()).toBeGreaterThanOrEqual(40 * 750);
		expect(elapsed()).toBeLessThan(41 * 750);
	});

	it('gets tokens back as time passes, and lets that many through without waiting', async () => {
		const { budget, waits, advance } = budgetWith(100);
		await takeMany(budget, waits, 5);

		advance(3 * 750); // Three refill intervals: three tokens.

		expect(await takeMany(budget, waits, 3)).toBe(0);
		expect(await takeMany(budget, waits, 1)).toBe(1);
	});

	it('does not save up more than its capacity however long it has been quiet', async () => {
		const { budget, waits, advance } = budgetWith(100);
		await takeMany(budget, waits, 5);

		advance(60 * 60_000);

		expect(await takeMany(budget, waits, 5)).toBe(0);
		expect(await takeMany(budget, waits, 1)).toBe(1);
	});

	// What leaves the requests their 15%. Polar counts a minute from any moment, so every window
	// is checked, from each call that was let through. The worker is busy, then quiet for long
	// enough to save up all it can, then busy again, which is where a bucket that saved up too
	// much would spend it.
	it.each([100, 500])(
		'never lets through more than 85%% of a limit of %i in any 60 seconds',
		async (limit) => {
			const { budget, waits, advance, elapsed } = budgetWith(limit);
			const times: number[] = [];
			const busy = async (count: number) => {
				for (let i = 0; i < count; i++) {
					await budget.take();
					times.push(elapsed());
				}
			};

			await busy(limit * 2);
			advance(90_000);
			await busy(limit * 2);
			advance(20_000);
			await busy(limit);

			let most = 0;
			for (const start of times) {
				const within = times.filter((time) => time >= start && time <= start + 60_000).length;
				most = Math.max(most, within);
			}
			expect(waits.length).toBeGreaterThan(0);
			expect(most).toBeLessThanOrEqual(limit * 0.85);
			// And not much less, or usage would reach Polar later than it need.
			expect(most).toBeGreaterThanOrEqual(limit * 0.85 - 1);
		}
	);

	it('has room for one call at a limit too low to have a share', async () => {
		const { budget, waits } = budgetWith(1);

		expect(await takeMany(budget, waits, 1)).toBe(0);
		expect(await takeMany(budget, waits, 1)).toBe(1);
	});

	describe('when Polar says to wait', () => {
		it('holds a call until the time is over, though there is room', async () => {
			const { budget, waits, elapsed } = budgetWith(100);

			budget.pause(10);
			await budget.take();

			expect(waits).toEqual([10_000]);
			expect(elapsed()).toBe(10_000);
		});

		it('holds every call, not only the first', async () => {
			const { budget, elapsed } = budgetWith(100);
			budget.pause(10);

			const times: number[] = [];
			await Promise.all(
				[1, 2, 3].map(async () => {
					await budget.take();
					times.push(elapsed());
				})
			);

			expect(Math.min(...times)).toBeGreaterThanOrEqual(10_000);
		});

		it('is not shortened by a shorter pause that comes after', async () => {
			const { budget, waits } = budgetWith(100);

			budget.pause(10);
			budget.pause(2);
			await budget.take();

			expect(waits).toEqual([10_000]);
		});

		it('is lengthened by a longer one', async () => {
			const { budget, waits } = budgetWith(100);

			budget.pause(2);
			budget.pause(10);
			await budget.take();

			expect(waits).toEqual([10_000]);
		});

		it('lets calls through again once it is over', async () => {
			const { budget, waits, advance } = budgetWith(100);
			budget.pause(10);
			advance(10_000);

			expect(await takeMany(budget, waits, 5)).toBe(0);
		});

		// The SDK reads Retry-After with parseInt, which makes NaN of one written as a date. A
		// NaN kept as the end of the pause would make every later pause, real ones included,
		// compare as no longer and be ignored.
		it.each([
			['not say for how long', null],
			['give a time that is not a number', Number.NaN],
			['give no end', Number.POSITIVE_INFINITY],
			['give a time already past', -5]
		])('waits a minute when it does %s, and still heeds the next pause', async (_, seconds) => {
			const { budget, waits, advance } = budgetWith(100);

			budget.pause(seconds);
			await budget.take();
			expect(waits).toEqual([60_000]);

			advance(1000);
			budget.pause(10);
			await budget.take();
			expect(waits).toEqual([60_000, 10_000]);
		});
	});

	describe('when the worker is stopping', () => {
		it('stops waiting at once, and takes nothing', async () => {
			// The real clock and the real wait, since what is tested is that the wait is cut short.
			const budget = createBudget(100);
			budget.pause(60);
			const stop = new AbortController();

			const taking = budget.take(stop.signal);
			stop.abort();

			await expect(taking).rejects.toMatchObject({ name: 'AbortError' });
		});

		it('does not let a call through once it has been told to stop, though there is room', async () => {
			const { budget } = budgetWith(100);

			await expect(budget.take(AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
		});
	});
});
