/**
 * The production entry point: `node server.js`, after `pnpm build`.
 *
 * It starts the server the Node adapter built, unchanged, and adds the security headers that
 * belong on every response. They are set here, and not in src/hooks.server.ts, because
 * prerendered pages and static files are served straight from disk and never pass through a
 * hook: a header set there would be missing from most of the site.
 *
 * It also decides what an unhandled promise rejection does to the process, which is a question
 * for the process and not for any one request. That is at the foot of the file.
 *
 * Two things are deliberately not here:
 *
 * - The content security policy. It needs a hash or a nonce per page, so SvelteKit writes it:
 *   as a header on pages rendered per request, and as a <meta> tag in prerendered ones. It is
 *   configured in vite.config.ts.
 * - Strict-Transport-Security. This server speaks plain HTTP to whatever terminates TLS in front
 *   of it, and that is where a promise about HTTPS has to be made.
 */

import { inspect } from 'node:util';

const HEADERS = {
	// Browsers must not guess a file's type from its contents.
	'X-Content-Type-Options': 'nosniff',
	// No other site may show this one in a frame. The policy's `frame-ancestors` says the same
	// for pages rendered per request, but it cannot be given in a <meta> tag, so prerendered
	// pages rely on this.
	'X-Frame-Options': 'DENY',
	// Other sites are told which site a visitor came from, never which page.
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	// A window this site opens, or is opened from, gets no handle on it.
	'Cross-Origin-Opener-Policy': 'same-origin',
	// The site uses none of these, so nothing running in it may ask for them.
	'Permissions-Policy': 'camera=(), geolocation=(), microphone=()'
};

// The build only exists after `pnpm build`, so its address is assembled here and not written as
// a static import, which the type check would try to follow.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- typed by the cast: the build has no types of its own
const { server } = /** @type {{ server: import('node:http').Server }} */ (
	await import(new URL('./build/index.js', import.meta.url).href)
);

/**
 * How long a browser may keep the font: a month, and after that it goes on using its copy while
 * it fetches a new one in the background.
 *
 * Built files have their contents in their names and are kept for good. The font cannot be one of
 * them, because the script in src/app.html has to name it before anything else on the page has
 * been read, and that script's text is fixed by the content security policy. So the font has one
 * address (static/fonts) and is cached by time. The adapter sends files from `static` with no
 * instruction at all, which makes a browser ask about them on every visit. For the font that
 * question costs a round trip the first frame does not wait for.
 */
const FONTS = 'public, max-age=2592000, stale-while-revalidate=31536000';

/**
 * One event as one line of JSON, the form src/lib/server/log.ts writes. That file is part of the
 * build and cannot be imported from here, so its few lines are repeated, LOG_LEVEL included.
 *
 * @param {'info' | 'error'} level
 * @param {string} event
 * @param {Record<string, unknown>} details
 */
function record(level, event, details) {
	if (level === 'info' && process.env.LOG_LEVEL === 'error') return;

	const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...details });

	if (level === 'error') console.error(line);
	else console.log(line);
}

/**
 * A promise that rejects with nothing listening must not end the process, which is what Node does
 * by default. On a web server it is almost always one request's failure. The case that prompted
 * this: a `load` function returns a promise un-awaited, to be streamed, and the promise fails
 * before the page has started rendering. Exiting would cut off every other visitor mid-response,
 * for a fault that touched none of them. Measured: one request to such a page stopped the server.
 *
 * So the rejection is recorded and the server carries on. That goes for every promise in the
 * process, not only streamed ones. An uncaught exception is a different matter and still ends the
 * process: there the stack was abandoned part-way through and nothing after it can be trusted.
 *
 * In the streaming case SvelteKit attaches its handler a moment later, shows the visitor the
 * failure in place, and records it again through the error hook, this time with its route and a
 * reference. Node announces that the promise was picked up, and that is recorded too, under the
 * number the rejection was given: a rejection followed by such a line was dealt with, and one
 * that is not was never handled by anything.
 *
 * @type {WeakMap<Promise<unknown>, number>}
 */
const rejections = new WeakMap();
let rejected = 0;

process.on('unhandledRejection', (reason, promise) => {
	rejected += 1;
	rejections.set(promise, rejected);

	// Nothing here may throw. An exception in this listener is an uncaught one, and would end the
	// process the listener exists to keep alive. Anything can be rejected with, including values
	// that cannot be turned into text or JSON, so a failure to describe one is itself recorded.
	try {
		record('error', 'unhandled rejection', {
			rejection: rejected,
			...(reason instanceof Error
				? { name: reason.name, message: reason.message, stack: reason.stack }
				: { name: typeof reason, message: inspect(reason) })
		});
	} catch {
		record('error', 'unhandled rejection', {
			rejection: rejected,
			message: 'The rejection could not be described.'
		});
	}
});

process.on('rejectionHandled', (promise) => {
	record('info', 'rejection handled late', { rejection: rejections.get(promise) });
});

// Ahead of the adapter's own listener, because that one may start writing the response at once.
server.prependListener('request', (request, response) => {
	for (const [name, value] of Object.entries(HEADERS)) response.setHeader(name, value);
	if (request.url?.startsWith('/fonts/')) response.setHeader('Cache-Control', FONTS);
});
