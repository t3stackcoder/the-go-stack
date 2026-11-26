/**
 * The lock that makes a worker the only one, and what the worker does without it.
 *
 * It is a Postgres advisory lock, on a connection of its own: Postgres holds it for as long as
 * the connection that took it lives, and lets it go by itself when the process ends however it
 * ends. That connection can fail while the worker runs, when Postgres restarts or the network
 * between them is reset, and the lock goes with it. The jobs then stop, since two workers must
 * never run at once and another may now take the lock, and this one tries to take it again,
 * waiting longer each time as the jobs do after a failure. The jobs start again once it has it.
 * A Postgres that is not there when the worker starts is waited for in the same way.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { describeError } from '#lib/errors.js';
import { record } from '#lib/server/log.js';

/** The first wait after failing to take the lock, in milliseconds, and the longest. */
const FIRST_WAIT = 1000;
const LONGEST_WAIT = 30_000;
/**
 * How long a try to connect may take, in milliseconds. Without a bound, a Postgres that does not
 * answer at all would hold the worker in one try for as long as the system's own timeout, and a
 * stop would wait for it.
 */
const CONNECT_TIMEOUT = 5000;

/** Another worker has the lock. */
class HeldElsewhere extends Error {}

/**
 * Takes the lock on a connection of its own. `lost` is called if that connection fails once the
 * lock is held, since the lock has then gone with it.
 */
async function takeLock(
	connectionString: string,
	lost: (error: Error) => void
): Promise<pg.Client> {
	const connection = new pg.Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT });
	try {
		await connection.connect();
		connection.on('error', lost);
		const { rows } = await connection.query<{ held: boolean }>(
			"select pg_try_advisory_lock(hashtext('billing worker')) as held"
		);
		if (rows[0].held) return connection;
	} catch (error) {
		await connection.end().catch(() => {});
		throw error;
	}
	await connection.end().catch(() => {});
	throw new HeldElsewhere(
		'Another billing worker is running against this database. One is enough: stop that one first.'
	);
}

/**
 * Calls `work` each time this process takes the lock, until `signal` says to stop, and returns
 * once it has let the lock go. `work` is handed a signal that aborts when it is to stop, which is
 * when `signal` does or the lock is lost, and one that aborts only when the lock is lost. It must
 * return soon after the first aborts, and the lock is not tried for again until it has, so that
 * the work is never done without it.
 *
 * It throws only if another worker holds the lock when this one starts, which is a mistake for a
 * person to put right. Once this one has held it, a lock held elsewhere is waited out like any
 * other failure: it may be this worker's own old connection, which Postgres has not yet noticed
 * is gone, or a second worker that took over in the meantime, and either is reason only to wait.
 */
export async function whileLocked(
	signal: AbortSignal,
	connectionString: string,
	work: (until: AbortSignal, lost: AbortSignal) => Promise<void>
): Promise<void> {
	let heldBefore = false;
	let wait = FIRST_WAIT;

	while (!signal.aborted) {
		const lost = new AbortController();
		let connection: pg.Client;
		try {
			connection = await takeLock(connectionString, (error) => {
				record('error', 'billing worker lost its lock', describeError(error));
				lost.abort();
			});
		} catch (error) {
			if (error instanceof HeldElsewhere && !heldBefore) throw error;
			record('error', 'billing worker cannot take its lock', describeError(error));
			// Rejects when told to stop mid-wait, which is the wait being over.
			await sleep(wait, undefined, { signal }).catch(() => {});
			wait = Math.min(wait * 2, LONGEST_WAIT);
			continue;
		}

		heldBefore = true;
		wait = FIRST_WAIT;
		try {
			await work(AbortSignal.any([signal, lost.signal]), lost.signal);
		} finally {
			await connection.end().catch(() => {});
		}
	}
}
