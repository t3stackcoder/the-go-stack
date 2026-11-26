/**
 * The billing worker: everything about billing that is not answering a request.
 *
 * Four jobs, each done over and over for as long as it runs:
 *
 * - drain: usage that requests allowed goes from Redis into the ledger (./drain.ts).
 * - ship: the ledger goes to Polar (./ship.ts).
 * - sync: what Polar says about each customer goes into `billing.state` and Redis (./sync.ts).
 * - remove: customers whose accounts are gone are removed from Polar (./sync.ts).
 *
 * It is a process of its own, started with `pnpm billing:worker` (scripts/billing-worker.js),
 * so that none of this shares a thread with a page being rendered. Without it the site still
 * serves, and still counts usage, for as long as Redis has room to hold it. What stops is
 * anything changing: nobody's subscription starts or ends, and nothing reaches Polar.
 *
 * One runs at a time, and a second one started by mistake says so and stops. Every job is safe
 * to do twice, so two would not corrupt anything. They would send each batch to Polar twice
 * and spend twice the rate limit doing it. It is one because one is enough: what limits the
 * work is how fast Polar will take it, not how fast this can send it. The jobs run only while
 * this process holds the lock that says so (./lock.ts), and wait while it cannot.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { PolarRateLimitError } from '@polar-sh/sdk';
import { describeError } from '#lib/errors.js';
import { db } from '#lib/server/db/index.js';
import { record } from '#lib/server/log.js';
import { DATABASE_URL, REDIS_URL } from '$app/env/private';
import { catalogue, polarConnection, polarKind } from '../config.js';
import { polarCore } from '../polar/client.js';
import { syncCalls } from '../polar/sync.js';
import { openRedis } from '../redis.js';
import { type Budget, createBudget, POLAR_LIMITS } from './budget.js';
import { drainOnce } from './drain.js';
import { whileLocked } from './lock.js';
import { shipOnce } from './ship.js';
import { removeDeleted, syncOnce } from './sync.js';

/** How long each job rests when it found nothing to do, in milliseconds. */
const REST = { drain: 250, ship: 1000, sync: 500, remove: 60_000 };
/** The longest a job waits before trying again after failing. */
const LONGEST_WAIT = 30_000;
/**
 * How long the worker goes on draining, and then shipping, once told to stop, in milliseconds.
 * Both are bounded. The site may still be counting usage, and a drain that kept up with it would
 * never end; and whatever stops the worker will not wait for ever (Docker sends SIGTERM and kills
 * ten seconds later), so the two together fit inside that. What is left is still there for the
 * next start.
 */
const FINAL_DRAIN = 2000;
const FINAL_SHIP = 5000;

/** Whether a failure is a wait that a stop cut short, which is not a failure at all. */
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/**
 * Runs the worker until `signal` says to stop, then finishes what it can and returns. It throws
 * if it cannot start: the configuration is wrong, or another worker is running. Postgres, Redis
 * and Polar not being there are waited for, however long that is.
 */
export async function runWorker(signal: AbortSignal): Promise<void> {
	// First, so that a variable that is missing ends the process at once, whatever else is up.
	const polar = syncCalls(polarCore(polarConnection()), catalogue());
	const budget = createBudget(POLAR_LIMITS[polarKind]);
	const { redis, close } = openRedis(REDIS_URL);

	/** The budget, with every wait in it cut short by `until`. */
	const spending = (until: AbortSignal): Budget => ({
		take: () => budget.take(until),
		pause: (seconds) => budget.pause(seconds)
	});

	/**
	 * Does one job until `until` says to stop. A pass that did some work is followed at once by
	 * another, and one that found none by a rest. A failure is recorded and waited out, twice as
	 * long each time it happens again: Polar, Redis and Postgres all come back by themselves,
	 * and the work is still there when they do.
	 */
	async function repeat(until: AbortSignal, name: keyof typeof REST, pass: () => Promise<number>) {
		let wait = REST[name];
		while (!until.aborted) {
			try {
				const done = await pass();
				wait = REST[name];
				if (done > 0) continue;
			} catch (error) {
				if (until.aborted && isAbort(error)) break;
				if (error instanceof PolarRateLimitError) budget.pause(error.retryAfter);
				record('error', `billing ${name} failed`, describeError(error));
				wait = Math.min(wait * 2, LONGEST_WAIT);
			}
			// Rejects when told to stop mid-rest, which is the rest being over.
			await sleep(wait, undefined, { signal: until }).catch(() => {});
		}
	}

	/**
	 * Told to stop. What is in the stream and the ledger now is sent on its way first, because
	 * Polar bills usage in the period it arrives in, and the next start may be a while off. Each
	 * of the two is bounded (see FINAL_DRAIN), and the ship is tried whatever became of the drain.
	 */
	async function finish() {
		try {
			const client = await redis();
			const drainUntil = Date.now() + FINAL_DRAIN;
			while (Date.now() < drainUntil && (await drainOnce({ redis: client, db })) > 0);
		} catch (error) {
			record('error', 'billing worker stopped with usage left in Redis', describeError(error));
		}
		try {
			const shipUntil = AbortSignal.timeout(FINAL_SHIP);
			const deps = { db, polar, budget: spending(shipUntil) };
			while (!shipUntil.aborted && (await shipOnce(deps)) > 0);
		} catch (error) {
			record('error', 'billing worker stopped with usage left to send', describeError(error));
		}
	}

	try {
		await whileLocked(signal, DATABASE_URL, async (until, lost) => {
			record('info', 'billing worker started', { polar: polarKind });
			const spend = spending(until);
			// Kept from pass to pass, so that the sync sweeps for the forgotten once a minute.
			const sweep = { dueAt: 0 };
			await Promise.all([
				repeat(until, 'drain', async () => drainOnce({ redis: await redis(), db })),
				repeat(until, 'ship', () => shipOnce({ db, polar, budget: spend })),
				repeat(until, 'sync', async () =>
					syncOnce({ db, redis: await redis(), polar, budget: spend }, sweep)
				),
				repeat(until, 'remove', async () =>
					removeDeleted({ db, redis: await redis(), polar, budget: spend })
				)
			]);
			// Without the lock the work is another worker's to do, if there is one.
			if (!lost.aborted) await finish();
		});
	} finally {
		await close();
		record('info', 'billing worker stopped', {});
	}
}
