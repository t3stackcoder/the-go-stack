// How the worker stops. Broken, a stop waits for ever: on a drain that never runs dry while the
// site is still counting usage, or on an hour's pause that Polar asked for, and whatever stopped
// it kills it before the last of the usage is sent. The four jobs are fakes here, so that how
// long each takes is what the test says; the lock and Redis are real.

import { setTimeout as sleep } from 'node:timers/promises';
import { PolarRateLimitError } from '@polar-sh/sdk';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reachServices } from '../testing.js';
import type { Budget } from './budget.js';

const env = vi.hoisted(() => ({ DATABASE_URL: '' }));
vi.mock('$app/env/private', () => ({
	LOG_LEVEL: 'error',
	DATABASE_URL: env.DATABASE_URL,
	// Redis's database 15, which is this file's (../testing.ts). Nothing is written to it.
	REDIS_URL: Object.assign(new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'), {
		pathname: '/15'
	}).href,
	// The fake Polar, which needs no other variable. Nothing is sent to it: the jobs are fakes.
	POLAR_MOCK_URL: 'http://127.0.0.1:1'
}));

const jobs = vi.hoisted(() => ({
	drain: async (): Promise<number> => 0,
	ship: async (_: { budget: Budget }): Promise<number> => 0
}));
vi.mock('./drain.js', () => ({ drainOnce: () => jobs.drain() }));
vi.mock('./ship.js', () => ({ shipOnce: (deps: { budget: Budget }) => jobs.ship(deps) }));
vi.mock('./sync.js', () => ({ syncOnce: async () => 0, removeDeleted: async () => 0 }));

const services = await reachServices(15);
afterAll(async () => services?.close());
afterEach(() => vi.restoreAllMocks());

// The environment is read when main.ts is first loaded, so the address must be known by then.
if (services) env.DATABASE_URL = services.pool.options.connectionString!;
const { runWorker } = await import('./main.js');

describe.skipIf(!services)('stopping the worker', () => {
	let lines: string[];
	beforeEach(() => {
		lines = [];
		vi.spyOn(console, 'error').mockImplementation((line) => lines.push(String(line)));
		jobs.drain = async () => 0;
		jobs.ship = async () => 0;
	});

	it('is done in a few seconds though the site never stops counting usage, and still ships', async () => {
		// Every pass finds a full batch, as it would while requests go on counting.
		jobs.drain = async () => {
			await sleep(5);
			return 500;
		};
		const shipped: number[] = [];
		jobs.ship = async () => {
			shipped.push(Date.now());
			return 0;
		};
		const stop = new AbortController();
		const running = runWorker(stop.signal);
		await vi.waitFor(() => expect(shipped.length).toBeGreaterThan(0), { timeout: 5000 });

		stop.abort();
		const stopped = Date.now();
		await running;

		expect(Date.now() - stopped).toBeLessThan(4000);
		expect(shipped.at(-1)).toBeGreaterThanOrEqual(stopped);
	}, 20_000);

	it('does not sit out a pause Polar asked for once told to stop', async () => {
		let passes = 0;
		jobs.ship = async ({ budget }) => {
			passes++;
			if (passes === 1) throw new PolarRateLimitError(429, 3600);
			await budget.take();
			return 0;
		};
		const stop = new AbortController();
		const running = runWorker(stop.signal);
		// The second pass is waiting out the hour.
		await vi.waitFor(() => expect(passes).toBe(2), { timeout: 5000 });

		stop.abort();
		const stopped = Date.now();
		await running;

		// The last try to ship waits for the pause too, but only for as long as it is given.
		expect(Date.now() - stopped).toBeLessThan(8000);
		expect(lines.filter((line) => line.includes('billing ship failed'))).toHaveLength(1);
		expect(lines.filter((line) => line.includes('stopped with usage left to send'))).toHaveLength(
			1
		);
	}, 20_000);

	it('starts nothing when told to stop before it began, as a stop during loading is', async () => {
		let passes = 0;
		jobs.drain = async () => {
			passes++;
			return 0;
		};

		await runWorker(AbortSignal.abort());

		expect(passes).toBe(0);
	});
});
