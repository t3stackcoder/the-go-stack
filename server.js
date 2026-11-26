/**
 * The production entry point: `node server.js`, after `pnpm build`.
 *
 * It starts the server the Node adapter built, unchanged, and adds the security headers that
 * belong on every response. They are set here, and not in src/hooks.server.ts, because
 * prerendered pages and static files are served straight from disk and never pass through a
 * hook: a header set there would be missing from most of the site.
 *
 * It also settles what address the server takes to be its own on a developer's machine, where
 * nobody has told it, and keeps a record of each form it turns away for coming from elsewhere.
 * Both are about the check that a form was posted from this site, which SvelteKit makes before
 * any of the site's own code runs.
 *
 * And it decides what an unhandled promise rejection does to the process, which is a question
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

/**
 * Whether the deployment has said what the server's own address is: with ORIGIN, or with the
 * headers a proxy in front of it sets. These are the Node adapter's variables, and wherever one
 * is set the adapter is left to it.
 *
 * Where none is, the adapter assumes `https` and the host the request named. That is right behind
 * a proxy that terminates TLS and wrong on a developer's machine, where the site is opened over
 * plain HTTP: every form was refused with "Cross-site POST form submissions are forbidden",
 * because the page it came from was at `http://localhost:4173` and the server took itself to be
 * at `https://localhost:4173`. Setting ORIGIN by hand only moves the fault. To a browser
 * `localhost` and `127.0.0.1` are different sites, and a form posted from whichever one ORIGIN
 * does not name is refused.
 *
 * So with nothing set, a request that names this machine as its host (LOCAL below) has the
 * protocol it really arrived by passed to the adapter, in a header the adapter is told to read.
 * `localhost` and `127.0.0.1` then each work, on whatever port is in use. Any other host is
 * treated as before, so a real deployment still has to set ORIGIN, and still fails closed if it
 * does not.
 *
 * The host a request names is not proof of where it came from. A proxy in front of the server
 * may rewrite it, and nginx and Apache both do unless told otherwise: they pass on the address
 * they forward to, which is commonly `localhost`. A deployment like that which has also forgotten
 * ORIGIN looks, from here, like a developer's machine. Two things follow from that:
 *
 * - A page running on a visitor's own machine, at that same name and port, could post a form to
 *   the deployment and pass the check. That is closed. A request that changes anything is taken
 *   for a local one only if the browser itself says that the page and the server are one origin,
 *   in `Sec-Fetch-Site`, which a page cannot set and a proxy passes on. Any other post is held
 *   to `https`, and refused as it was before this rule existed. So is one from a browser too old
 *   to send that header, or from a script: set ORIGIN for those.
 * - Cookies, which is not closed. SvelteKit marks a cookie Secure unless the site is at
 *   `http://localhost`, and such a deployment is now taken to be there, so its cookies may
 *   travel over plain HTTP. Nothing in a request tells the two cases apart. What limits it is
 *   that the deployment is already refusing every form its visitors send, sign-in included,
 *   until someone sets ORIGIN.
 */
const ADDRESS_SET =
	'ORIGIN' in process.env ||
	['PROTOCOL_HEADER', 'HOST_HEADER', 'PORT_HEADER'].some((name) => process.env[name]);

/** The header the real protocol is passed in. Removed from every request that arrives with it. */
const LOCAL_PROTOCOL = 'x-local-protocol';

/** The names a browser on this machine can call it by, with or without a port. */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * The kinds of request SvelteKit checks for having come from this site, and the kinds of body
 * it takes for a form's. No content type at all counts as one.
 */
const CHECKED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const FORM_TYPES = [
	'',
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
];

/**
 * Whether a request is taken to have come straight from a browser on this machine. See above.
 *
 * @param {import('node:http').IncomingMessage} request
 */
function arrivedLocally(request) {
	if (!LOCAL.test(request.headers.host ?? '')) return false;

	return (
		!CHECKED_METHODS.includes(request.method ?? '') ||
		request.headers['sec-fetch-site'] === 'same-origin'
	);
}

// Before the build is imported: the adapter reads its variables as it loads.
if (!ADDRESS_SET) process.env.PROTOCOL_HEADER = LOCAL_PROTOCOL;

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

/**
 * One header of a request, by the name a variable gives it, as the adapter reads it.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {string | undefined} name
 */
function header(request, name) {
	const value = name ? request.headers[name.toLowerCase()] : undefined;
	return Array.isArray(value) ? value[0] : value;
}

/**
 * What the server takes its own address to be for a request, worked out the way the adapter
 * does: ORIGIN if it is set, and otherwise a protocol and a host from the request's headers. It
 * is written as SvelteKit compares it, which is how a browser writes an origin: lower case, and
 * without a port that is the protocol's own. Left as the headers had it, `https://host:443`
 * would not equal the `https://host` a browser sends, and a refusal the site raised itself
 * would be recorded as this one.
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {string | null} Null for headers that make no address, which SvelteKit never serves.
 */
function ownAddress(request) {
	const protocol = header(request, process.env.PROTOCOL_HEADER) ?? 'https';
	const host = header(request, process.env.HOST_HEADER) ?? request.headers.host ?? '';
	const port = header(request, process.env.PORT_HEADER);

	try {
		return new URL(
			process.env.ORIGIN?.trim() ??
				(port ? `${protocol}://${host.replace(/:\d*$/, '')}:${port}` : `${protocol}://${host}`)
		).origin;
	} catch {
		return null;
	}
}

/**
 * Whether SvelteKit turned this request away as a form posted from another site. It says so with
 * a bare 403, before the site's hooks run, so the site's own log never hears of it. Here it can
 * only be recognised from outside: a 403, for a request that SvelteKit checks, whose `Origin`
 * header is not the server's own address. A 403 the site raised itself was let through that
 * check, so its `Origin` matched.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
function refusedAsCrossSite(request, response) {
	const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();

	return (
		response.statusCode === 403 &&
		CHECKED_METHODS.includes(request.method ?? '') &&
		FORM_TYPES.includes(type) &&
		request.headers.origin !== ownAddress(request)
	);
}

// Ahead of the adapter's own listener, because that one may start writing the response at once.
server.prependListener('request', (request, response) => {
	for (const [name, value] of Object.entries(HEADERS)) response.setHeader(name, value);
	if (request.url?.startsWith('/fonts/')) response.setHeader('Cache-Control', FONTS);

	if (!ADDRESS_SET) {
		// Never the visitor's to set: it says how the request arrived, and only this file knows.
		delete request.headers[LOCAL_PROTOCOL];
		if (arrivedLocally(request)) {
			request.headers[LOCAL_PROTOCOL] = 'encrypted' in request.socket ? 'https' : 'http';
		}
	}

	// A wrong ORIGIN on a real deployment refuses every form, and without this line nothing
	// anywhere would say why. The two addresses side by side are the whole diagnosis.
	response.on('finish', () => {
		if (!refusedAsCrossSite(request, response)) return;

		record('info', 'post refused as cross-site', {
			method: request.method,
			path: request.url?.split('?')[0],
			from: request.headers.origin ?? null,
			own: ownAddress(request)
		});
	});
});
