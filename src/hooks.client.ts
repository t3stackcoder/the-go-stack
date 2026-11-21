import { resolve } from '$app/paths';
import type { HandleClientError } from '@sveltejs/kit/hooks';
import { describeError, errorReference, UNEXPECTED } from '#lib/errors.js';

/**
 * Runs when a navigation fails in the browser: a `load` function or a component threw, or the
 * server could not be reached.
 *
 * Expected errors (a missing page, or one raised with `error()`) already carry a message meant
 * for the visitor, and are left as they are. An unexpected one is sent to the server to be
 * recorded, since a browser console is read by nobody, and the visitor is shown a safe message
 * with the reference it was recorded under.
 *
 * It covers navigation only. An exception in an event handler, or a promise nobody awaited, does
 * not pass through here.
 */
export const handleError: HandleClientError = ({ error, event, kind }) => {
	if (kind !== 'unknown') return;

	const reference = errorReference();
	const report = {
		reference,
		path: event.url.pathname,
		route: event.route.id,
		...describeError(error)
	};

	// A beacon is handed to the browser to deliver, so it still arrives if the visitor leaves the
	// page. It returns false when the browser refuses it, and there is then nowhere left to say so.
	navigator.sendBeacon(
		resolve('/api/client-errors'),
		new Blob([JSON.stringify(report)], { type: 'application/json' })
	);

	return { message: UNEXPECTED, reference };
};
