// The lock is what keeps two workers from running at once, and what lets one carry on after
// Postgres has gone away and come back. Broken one way, two workers send every batch twice; broken
// the other, a restart of Postgres ends the worker for good and nothing reaches Polar until a
// person notices. Run against a real Postgres, where a lock, and a connection that is killed while
// it holds one, are what the server makes of them. Advisory locks belong to a database, and this
// file has one of its own, so a worker running on the developer's database is not in its way.

import pg from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { reachServices } from '../testing.js';

vi.mock('$app/env/private', () => ({ LOG_LEVEL: 'error' }));

const { whileLocked } = await import('./lock.js');

const services = await reachServices(14);
afterAll(async () => services?.close());
afterEach(() => vi.restoreAllMocks());

/** Resolves when `signal` aborts. */
const aborted = (signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener('abort', () => resolve(), { once: true });
	});

describe.skipIf(!services)('the lock that makes the worker the only one', () => {
	const { pool } = services!;
	const address = pool.options.connectionString!;

	/** The connections that hold an advisory lock on this file's database, by their process ids. */
	const holders = async () =>
		(
			await pool.query<{ pid: number }>(
				`select pid from pg_locks
				where locktype = 'advisory'
				and database = (select oid from pg_database where datname = current_database())`
			)
		).rows.map((row) => row.pid);

	/** The lines recorded as errors that name `event`. */
	const recorded = (error: { mock: { calls: unknown[][] } }, event: string) =>
		error.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(event));

	it('runs the work while it holds the lock, and lets it go once told to stop', async () => {
		const stop = new AbortController();
		let started!: () => void;
		const running = new Promise<void>((resolve) => {
			started = resolve;
		});

		const done = whileLocked(stop.signal, address, async (until) => {
			started();
			await aborted(until);
		});
		await running;
		expect(await holders()).toHaveLength(1);

		stop.abort();
		await done;
		expect(await holders()).toEqual([]);
	});

	it('will not start beside another worker that holds it, and says why', async () => {
		const other = new pg.Client({ connectionString: address });
		await other.connect();
		try {
			await other.query("select pg_advisory_lock(hashtext('billing worker'))");
			const work = vi.fn(async () => {});

			await expect(whileLocked(new AbortController().signal, address, work)).rejects.toThrow(
				'Another billing worker is running against this database'
			);
			expect(work).not.toHaveBeenCalled();
		} finally {
			await other.end();
		}
	});

	it('stops the work when the lock is lost, and starts it again once it has it back', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const stop = new AbortController();
		const events: string[] = [];
		let again!: () => void;
		const restarted = new Promise<void>((resolve) => {
			again = resolve;
		});

		const done = whileLocked(stop.signal, address, async (until, lost) => {
			events.push('started');
			if (events.length === 1) {
				// What a restart of Postgres does to the connection that holds the lock.
				await pool.query('select pg_terminate_backend(pid) from unnest($1::int[]) as pid', [
					await holders()
				]);
			} else {
				again();
			}
			await aborted(until);
			events.push(lost.aborted ? 'lost' : 'stopped');
		});

		await restarted;
		// Never two at once: the first had ended before the second began.
		expect(events).toEqual(['started', 'lost', 'started']);
		expect(await holders()).toHaveLength(1);
		expect(recorded(error, 'billing worker lost its lock')).toHaveLength(1);

		stop.abort();
		await done;
		expect(events).toEqual(['started', 'lost', 'started', 'stopped']);
		expect(await holders()).toEqual([]);
	}, 15_000);

	it('waits for a Postgres that is not there, and stops waiting when told', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const nowhere = new URL(address);
		nowhere.port = '1';
		const stop = new AbortController();
		const work = vi.fn(async () => {});

		const done = whileLocked(stop.signal, nowhere.href, work);
		await vi.waitFor(
			() => expect(recorded(error, 'billing worker cannot take its lock')).toHaveLength(1),
			{ timeout: 10_000 }
		);

		stop.abort();
		await expect(done).resolves.toBeUndefined();
		expect(work).not.toHaveBeenCalled();
	}, 15_000);

	it('does nothing when told to stop before it began, as a stop during loading is', async () => {
		const work = vi.fn(async () => {});

		await whileLocked(AbortSignal.abort(), address, work);

		expect(work).not.toHaveBeenCalled();
		expect(await holders()).toEqual([]);
	});
});
