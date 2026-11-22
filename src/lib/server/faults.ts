import type { RequestEvent } from '@sveltejs/kit';
import { describeError, errorReference, UNEXPECTED } from '#lib/errors.js';
import { record } from './log.js';

type Request = Pick<RequestEvent, 'request' | 'url' | 'route'>;

/**
 * Which request an event in the log belongs to. The query string is left out, because that is
 * where personal details end up.
 */
export function whichRequest(event: Request) {
	return {
		method: event.request.method,
		path: event.url.pathname,
		route: event.route.id
	};
}

/**
 * Records an expected error: a page that does not exist, or a refusal the app raised itself with
 * `error()`. It is part of normal service and is recorded as information, because a run of them
 * for one address is worth noticing. Its message was written for the visitor and needs no
 * replacing.
 */
export function recordRefusal(kind: string, status: number, event: Request) {
	record('info', 'request refused', { kind, status, ...whichRequest(event) });
}

/**
 * Records a fault: an error in the code or in something it depends on. Its message was written for
 * developers and may carry details that must not leave the server, so what comes back is what the
 * visitor may be shown instead: a fixed sentence, and the reference the error was recorded under.
 *
 * The error hook in src/hooks.server.ts sends every error SvelteKit catches through these two.
 * The two places that catch one themselves, so that it costs the visitor a box or a form and not
 * the page, do the same: src/lib/server/streaming.ts and src/lib/forms/server/save-action.ts.
 */
export function recordFault(error: unknown, event: Request) {
	const reference = errorReference();
	record('error', 'unexpected error', {
		reference,
		...whichRequest(event),
		...describeError(error)
	});

	return { message: UNEXPECTED, reference };
}
