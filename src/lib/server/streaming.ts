import { error, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { WAIT_FLAG, type Late, type Settled } from '#lib/stable/late.js';
import { recordFault, recordRefusal, whichRequest } from './faults.js';
import { record } from './log.js';

/** What a page is given in place of each promise, wherever in the data it was. */
type Lates<T> =
	T extends Promise<infer Value>
		? Late<Value>
		: T extends readonly (infer Entry)[]
			? Lates<Entry>[]
			: T;

type Streamed<Data> = { [Key in keyof Data]: Lates<Data[Key]> } & {
	/** Whether late values are still to come. The root layout reads it (see +layout.svelte). */
	streams: boolean;
};

/**
 * The one way a server `load` hands a page data it does not wait for. Return what it returns:
 *
 *     export const load = (event) =>
 *         streaming(event, 5000, { products, stock: loadStock() });
 *
 * Every promise among the data's properties, or in a list among them, is slow data. The page
 * shows each with the `Streamed` component.
 *
 * For most visitors the promises go to the page as they are, and each is streamed into the
 * response when it settles. Streaming hands late values to JavaScript to put on the page, so a
 * visitor without it would look at placeholders for good. Such a visitor is sent on to the same
 * address with a flag added (see `WAIT_FLAG`), and for that address this waits for every promise
 * and returns what each settled as: the page is sent whole. So is the page that answers a form
 * posted the browser's own way. Its visitor has no JavaScript running either, and sent on to
 * another address they would lose the form's answer. Which visitor gets which is decided here
 * and nowhere else.
 *
 * Being sent on is not free. A browser follows the tag that sends it only when the streamed
 * response has ended, so a visitor without JavaScript sits through that response and then the
 * one that waits: up to twice the limit below, on each page that streams.
 *
 * `limit` is how long, in milliseconds, any one promise is given. When it passes, the promise is
 * treated as failed, and its box says so. Without a limit a value that never settles would hold
 * the response open for as long as the visitor stayed, and would hold the whole page back from a
 * visitor being waited for. The limit ends the wait and not the work: a dependency that can be
 * cancelled should carry a limit of its own (`AbortSignal.timeout`, for a fetch).
 *
 * A promise that fails costs the visitor its box and never the page, whichever way it is sent.
 * Streamed, SvelteKit passes the failure through the error hook on its way to the browser. While
 * waiting, it is caught here and put through the same recording.
 */
export function streaming<Data extends Record<string, unknown>>(
	event: RequestEvent,
	limit: number,
	data: Data
): Streamed<Data> | Promise<Streamed<Data>> {
	const waiting = event.url.searchParams.has(WAIT_FLAG) || event.request.method === 'POST';

	const limited = (value: Promise<unknown>) => {
		const promise = within(limit, value, event);
		// Nothing listens to a streamed promise until the page starts to render. One that fails
		// before then would otherwise be an unhandled rejection. The page still gets the failure.
		promise.catch(() => {});
		return promise;
	};

	const entries = Object.entries(data).map(([key, value]) => [key, each(value, limited)] as const);

	if (!waiting) return { ...Object.fromEntries(entries), streams: true } as Streamed<Data>;

	return Promise.all(
		entries.map(async ([key, value]) => [key, await settled(value, event)] as const)
	).then((all) => ({ ...Object.fromEntries(all), streams: false }) as Streamed<Data>);
}

/**
 * A value with `change` applied to every promise: the value itself, or the entries of a list.
 *
 * A promise one level further in, as a property of an object, is not looked for there: it would
 * be streamed with no limit, and never waited for. That is stopped here, the first time the
 * page is loaded, and not left to show up as a box that never fills without JavaScript.
 */
function each(value: unknown, change: (promise: Promise<unknown>) => unknown): unknown {
	if (value instanceof Promise) return change(value);
	if (Array.isArray(value)) return value.map((entry) => each(entry, change));

	if (value !== null && typeof value === 'object') {
		const hidden = Object.entries(value).find(([, inner]) => inner instanceof Promise);
		if (hidden) {
			throw new Error(
				`streaming() was given a promise inside an object, under "${hidden[0]}". ` +
					`Give it a property of its own, or put it in a list.`
			);
		}
	}

	return value;
}

/** A value with every promise replaced by what it settled as. */
async function settled(value: unknown, event: RequestEvent): Promise<unknown> {
	if (Array.isArray(value)) return Promise.all(value.map((entry) => settled(entry, event)));
	if (!(value instanceof Promise)) return value;

	try {
		return { late: 'arrived', value: await value } satisfies Settled<unknown>;
	} catch (thrown) {
		return { late: 'failed', error: describe(thrown, event) } satisfies Settled<unknown>;
	}
}

/**
 * What the visitor may be shown of a failure, recorded as the error hook would have recorded it:
 * an expected error's own message, or for a fault the fixed sentence and a reference.
 */
function describe(thrown: unknown, event: RequestEvent): App.Error {
	if (isHttpError(thrown)) {
		recordRefusal('app', thrown.status, event);
		return { ...thrown.body, status: thrown.status };
	}
	return { status: 500, ...recordFault(thrown, event) };
}

const TOO_SLOW = 'This took too long to load.';

/** The promise, or a failure the visitor can be shown if it has not settled within the limit. */
function within<T>(limit: number, value: Promise<T>, event: RequestEvent): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;

	const expired = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, limit);
	}).then(() => {
		record('error', 'slow data given up on', { limit, ...whichRequest(event) });
		// An expected error, so its message is the one the visitor is shown.
		error(504, TOO_SLOW);
	});

	// Whichever settles first. If that is the value, the timer is cleared and `expired` is left
	// pending, to be collected. If it is the timer, the value is still listened to, so it cannot
	// become an unhandled rejection later.
	return Promise.race([value, expired]).finally(() => clearTimeout(timer));
}
