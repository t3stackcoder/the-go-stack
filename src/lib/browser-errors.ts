/**
 * Sends errors that happen in the browser to the server to be recorded, since a browser console is
 * read by nobody. They are caught in three places: a navigation that failed (src/hooks.client.ts),
 * an exception nothing caught, and a rejected promise nothing handled.
 */
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { describeError, errorReference } from '#lib/errors.js';
import { hydration } from '#lib/stable/hydration.svelte.js';

interface Origin {
	/** Where it was caught: by the router, or by the window event of this name. */
	source: 'navigation' | 'error' | 'unhandledrejection';
	path: string;
	route: string | null;
}

/** Records an error on the server, and returns the reference it was recorded under. */
export function reportError(error: unknown, origin: Origin): string {
	const reference = errorReference();

	// A beacon is handed to the browser to deliver, so it still arrives if the visitor leaves the
	// page. It returns false when the browser refuses it, and there is then nowhere left to say so.
	navigator.sendBeacon(
		resolve('/api/client-errors'),
		new Blob([JSON.stringify({ reference, ...origin, ...describeError(error) })], {
			type: 'application/json'
		})
	);

	return reference;
}

/**
 * The most reports one page load may send for errors outside navigation. Code that fails on every
 * pointer move or every frame would otherwise post without end, and the first few reports say all
 * that the rest would. Every error still reaches the console. This keeps an honest page from
 * flooding the log; limiting a dishonest client is the job of the proxy in front of the server.
 */
const MAX_REPORTS = 10;
let reports = 0;

function reportUncaught(error: unknown, source: 'error' | 'unhandledrejection') {
	if (reports >= MAX_REPORTS) return;
	reports += 1;
	reportError(error, { source, path: location.pathname, route: page.route.id });
}

/**
 * Rejections seen before hydration finished, and not handled since.
 *
 * Until then, "unhandled" can mean "not handled yet". The promise for streamed data exists from
 * the moment the app starts, but nothing listens to it until the page's components are rendered.
 * If the data fails in between, the browser announces an unhandled rejection, and takes it back
 * when the component picks the promise up. Each one is kept here until hydration has shown which
 * kind it is.
 */
const early = new Map<Promise<unknown>, unknown>();

/** How long after hydration the browser is given to say that an early rejection was handled. */
const SETTLE_MS = 1000;

/** Starts recording uncaught errors. Called once, when the app's code first runs in the browser. */
export function watchForErrors() {
	// `error` is missing for a script from another origin and for a few warnings browsers raise
	// themselves, which have only a message.
	addEventListener('error', (event) => reportUncaught(event.error ?? event.message, 'error'));

	addEventListener('unhandledrejection', (event) => {
		if (hydration.done) {
			reportUncaught(event.reason, 'unhandledrejection');
			return;
		}
		// The browser is about to log this as an error. It may not be one, so that is put off too.
		event.preventDefault();
		early.set(event.promise, event.reason);
	});

	addEventListener('rejectionhandled', (event) => early.delete(event.promise));
}

/**
 * Reports the early rejections that nothing picked up after all. Called once by the root layout
 * when hydration has finished.
 */
export function settleEarlyRejections() {
	// The browser says a rejection was handled in a task of its own, some time after the handler
	// was attached, so the verdict has to wait a moment longer than hydration itself.
	setTimeout(() => {
		for (const reason of early.values()) {
			// The log entry that was put off above.
			console.error('Unhandled rejection before hydration:', reason);
			reportUncaught(reason, 'unhandledrejection');
		}
		early.clear();
	}, SETTLE_MS);
}
