import { pipeline, Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';
import { building } from '$app/env';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { describeError, errorReference, UNEXPECTED } from '#lib/errors.js';
import { record } from '#lib/server/log.js';

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
	const accepted = request.headers.get('accept-encoding') ?? '';
	const encoding = /\bbr\b/.test(accepted) ? 'br' : /\bgzip\b/.test(accepted) ? 'gzip' : undefined;

	if (
		!encoding ||
		!response.body ||
		response.headers.has('content-encoding') ||
		!COMPRESSIBLE.test(response.headers.get('content-type') ?? '')
	) {
		return response;
	}

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
	headers.append('vary', 'Accept-Encoding');
	// The length is no longer the original's, and is not known until the stream ends.
	headers.delete('content-length');

	return new Response(Readable.toWeb(compressed) as ReadableStream, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	const started = performance.now();
	const response = await resolve(event);

	// How long the server took to produce the response, reported to the browser so the on-page
	// readout can show it. For a streamed page this is the time until the page started to be
	// sent, which is the wait the visitor actually experienced. Prerendered pages are served as
	// static files and never pass through here, so they carry no timing.
	response.headers.set('Server-Timing', `render;dur=${(performance.now() - started).toFixed(1)}`);

	// While building, responses are being written to disk as prerendered files, which the
	// adapter compresses itself.
	return building ? response : compress(event.request, response);
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
 *
 * The query string is left out of the record, because that is where personal details end up.
 */
export const handleError: HandleServerError = ({ error, event, kind }) => {
	const request = {
		method: event.request.method,
		path: event.url.pathname,
		route: event.route.id
	};

	if (kind !== 'unknown') {
		record('info', 'request refused', { kind, status: error.status, ...request });
		return;
	}

	const reference = errorReference();
	record('error', 'unexpected error', { reference, ...request, ...describeError(error) });

	return { message: UNEXPECTED, reference };
};
