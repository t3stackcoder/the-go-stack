import type { HandleClientError } from '@sveltejs/kit/hooks';
import { reportError, watchForErrors } from '#lib/browser-errors.js';
import { UNEXPECTED } from '#lib/errors.js';

// Navigation errors come to `handleError` below. Everything else that goes wrong in the browser,
// an exception in an event handler or a promise nobody awaited, is caught by this.
watchForErrors();

/**
 * Runs when a navigation fails in the browser: a `load` function or a component threw, or the
 * server could not be reached.
 *
 * Expected errors (a missing page, or one raised with `error()`) already carry a message meant
 * for the visitor, and are left as they are. An unexpected one is sent to the server to be
 * recorded, and the visitor is shown a safe message with the reference it was recorded under.
 */
export const handleError: HandleClientError = ({ error, event, kind }) => {
	if (kind !== 'unknown') return;

	const reference = reportError(error, {
		source: 'navigation',
		path: event.url.pathname,
		route: event.route.id
	});

	return { message: UNEXPECTED, reference };
};
