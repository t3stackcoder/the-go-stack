/**
 * Keeps the worker's calls to Polar under Polar's rate limit.
 *
 * Polar allows an organisation so many requests a minute (500 in production and 100 in the
 * sandbox, when this was written) and answers 429 beyond that. The worker is one caller among
 * two: a person pressing Upgrade makes a call too, from the server that answers them, and must
 * never be the one refused because the worker was busy. So the worker spends at most its share,
 * and waits here when it has spent it.
 *
 * It is a bucket of tokens. A call takes one, and they come back at the rate of the worker's
 * share, 80% of the limit a minute. The bucket holds only 5% of the limit, so a quiet spell saves
 * up very little: the most the worker can spend in any minute is the 5% it had saved and the 80%
 * that came back during it, which is 85%, and the requests keep the other 15%. (A bucket that
 * held a whole minute's share would let a backlog after a quiet minute spend that share twice
 * over in one minute: 800 of production's 500.)
 */
import { setTimeout as sleep } from 'node:timers/promises';

/** Polar's limits, in requests a minute, by which Polar it is. */
export const POLAR_LIMITS = { production: 500, sandbox: 100, mock: 500 } as const;

/** The part of the limit the worker may spend each minute. The rest is the requests' own. */
const WORKERS_SHARE = 0.8;
/** The part of the limit it may save up while it is quiet, and spend at once. */
const BURST = 0.05;
/** How long to wait, in seconds, when Polar says to wait and not for how long. */
const DEFAULT_PAUSE = 60;

export interface Budget {
	/**
	 * Resolves when the next call may be made. Rejects, and takes nothing, if `signal` aborts
	 * first: a worker that is stopping does not sit out a pause.
	 */
	take(signal?: AbortSignal): Promise<void>;
	/**
	 * Polar said to wait: no call is let through for this many seconds. Null, or anything that
	 * is not a number of seconds, is the default of a minute. The SDK reads Retry-After as a
	 * whole number, and makes NaN of one that is written as a date.
	 */
	pause(seconds: number | null): void;
}

export function createBudget(
	limitPerMinute: number,
	{
		now = Date.now,
		wait = (ms: number, signal?: AbortSignal) =>
			sleep(ms, undefined, { signal }) as Promise<unknown>
	} = {}
): Budget {
	const capacity = Math.max(1, Math.floor(limitPerMinute * BURST));
	const perMs = (limitPerMinute * WORKERS_SHARE) / 60_000;

	let tokens = capacity;
	let refilled = now();
	let pausedUntil = 0;

	return {
		async take(signal) {
			for (;;) {
				signal?.throwIfAborted();
				const time = now();
				if (time < pausedUntil) {
					await wait(pausedUntil - time, signal);
					continue;
				}

				tokens = Math.min(capacity, tokens + (time - refilled) * perMs);
				refilled = time;
				if (tokens >= 1) {
					tokens -= 1;
					return;
				}
				await wait(Math.ceil((1 - tokens) / perMs), signal);
			}
		},
		pause(seconds) {
			const valid = seconds !== null && Number.isFinite(seconds) && seconds >= 0;
			pausedUntil = Math.max(pausedUntil, now() + (valid ? seconds : DEFAULT_PAUSE) * 1000);
		}
	};
}
