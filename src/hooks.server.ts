import { pipeline, Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';
import { error } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { answerAuth, findSession } from '#lib/server/auth/call.js';
import type { Session } from '#lib/server/auth/index.js';
import { recordFault, recordRefusal } from '#lib/server/faults.js';
import { building, dev } from '$app/env';
import { STRESS_PAGES } from '$app/env/private';

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml))/;

/**
 * Compresses a response rendered for this request.
 *
 * The Node adapter serves prerendered pages and static assets already compressed, but sends
 * anything rendered per request as it is: on this site that was up to 187 KB of HTML that
 * compresses to 18 KB. A proxy or CDN in front of the server would do this too; a response that
 * is already encoded is left alone, so the two do not conflict.
 *
 * The compressor is flushed after every chunk. Without that it would hold the start of a streamed
 * page back until more data arrived, and streaming would stop being streaming.
 */
function compress(request: Request, response: Response): Response {
	if (
		!response.body ||
		response.headers.has('content-encoding') ||
		!COMPRESSIBLE.test(response.headers.get('content-type') ?? '')
	) {
		return response;
	}

	// From here on the answer depends on what the browser said it accepts, whether or not this
	// one ends up compressed. A cache has to be told, or it could hand the compressed copy to a
	// client that cannot read it.
	if (!/\baccept-encoding\b/i.test(response.headers.get('vary') ?? '')) {
		response.headers.append('vary', 'Accept-Encoding');
	}

	const accepted = request.headers.get('accept-encoding') ?? '';
	const encoding = /\bbr\b/.test(accepted) ? 'br' : /\bgzip\b/.test(accepted) ? 'gzip' : undefined;
	if (!encoding) return response;

	const compressor =
		encoding === 'br'
			? createBrotliCompress({
					flush: constants.BROTLI_OPERATION_FLUSH,
					// Well short of the maximum: these pages are compressed on every request, and
					// beyond this level the extra time buys very little.
					params: { [constants.BROTLI_PARAM_QUALITY]: 5 }
				})
			: createGzip({ flush: constants.Z_SYNC_FLUSH });

	// `pipeline` rather than `pipe`, so that a failure on either side tears down both. The usual
	// failure is the visitor leaving before the page has finished arriving; the streams are closed
	// and there is nobody left to tell, so the callback has nothing further to do.
	const source = Readable.fromWeb(response.body as NodeReadableStream);
	const compressed = pipeline(source, compressor, () => {});

	const headers = new Headers(response.headers);
	headers.set('content-encoding', encoding);
	// The length is no longer the original's, and is not known until the stream ends.
	headers.delete('content-length');

	return new Response(Readable.toWeb(compressed) as ReadableStream, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

/**
 * Whether a request is one of Better Auth's own: the address a provider sends a visitor back
 * to, and the links in the emails. The site has no route under this address, and its forms
 * never post here: they go to actions, which ask Better Auth themselves
 * (src/lib/server/auth/call.ts).
 */
const AUTH = /^\/api\/auth(\/|$)/;

export const handle: Handle = async ({ event, resolve }) => {
	// The pages under /stress push the foundation harder than the chapters do, and are not for
	// visitors: anyone can ask one to hold a response or an action open, render twenty thousand
	// rows, or write an error to the log, as often as they like. Outside development they answer
	// as though they did not exist, unless STRESS_PAGES says otherwise (see src/env.ts). The
	// check is here and not in a layout's `load`, which a form action never passes through.
	if (!dev && !STRESS_PAGES && /^\/stress(\/|$)/.test(event.route.id ?? '')) {
		error(404, 'Not Found');
	}

	const started = performance.now();

	// While building, pages are being prerendered: nobody is signed in, there is no database to
	// ask, and nothing is added. Otherwise Better Auth answers what is addressed to it, and
	// every other request is given a way to ask who is signed in. Only a way: the session is
	// looked up when a page or an action first asks, once for the request, and a page that
	// never asks costs no query.
	let response: Response;
	if (building) {
		response = await resolve(event);
	} else if (AUTH.test(event.url.pathname)) {
		response = await answerAuth(event);
	} else {
		let found: Promise<Session | null> | undefined;
		event.locals.session = () => (found ??= findSession(event));
		response = await resolve(event);
	}

	// How long the server took to produce the response, reported to the browser so the on-page
	// readout can show it. For a streamed page this is the time until the page started to be
	// sent, which is the wait the visitor actually experienced. Prerendered pages are served as
	// static files and never pass through here, so they carry no timing.
	response.headers.set('Server-Timing', `render;dur=${(performance.now() - started).toFixed(1)}`);

	// While building, responses are being written to disk as prerendered files. The adapter
	// compresses those itself, and serves them with headers of its own.
	if (building) return response;

	// A page rendered for this request is this visitor's, as of now: a shared cache must not keep
	// it, and the browser must ask again before showing its copy. Without the header a browser
	// decides for itself how long the page stays fresh. A page that can be kept longer says so
	// from its `load` function, with `setHeaders`, and that is left alone.
	//
	// Back and Forward are the exception no header short of `no-store` closes: a browser may show
	// its copy there without asking. Measured in Chromium and Firefox, and settled in the root
	// layout, where a page come back to asks for its data again.
	if (
		!response.headers.has('cache-control') &&
		response.headers.get('content-type')?.startsWith('text/html')
	) {
		response.headers.set('cache-control', 'private, no-cache');
	}

	return compress(event.request, response);
};

/**
 * Runs for every error raised while answering a request.
 *
 * Expected errors are part of normal service: a page that does not exist, or a refusal the app
 * raised itself with `error()`. Their messages were written for the visitor and are shown as they
 * are. They are recorded as information, because a run of 404s for one address is worth noticing.
 *
 * An unexpected error is a fault in the code or in something it depends on. Its message was
 * written for developers and may carry details that must not leave the server, so the visitor is
 * shown a fixed sentence and a reference, and the error itself is recorded under that reference.
 */
export const handleError: HandleServerError = ({ error, event, kind }) => {
	if (kind !== 'unknown') {
		recordRefusal(kind, error.status, event);
		return;
	}

	return recordFault(error, event);
};
