/**
 * The three ways a request reaches Better Auth, each through the same two rules: the visitor's
 * address goes in (./address.ts), and what is done to the cookies comes out (./cookies.ts).
 *
 * - `callAuth`, for a form's action. The action asks Better Auth by its HTTP handler, in this
 *   process, with a request made here. Going in by the handler and not by `auth.api` is what
 *   runs the rate limiter and the origin check, neither of which a direct call passes through.
 * - `answerAuth`, for a request the browser makes to `/api/auth/*` itself: the address a
 *   provider sends a visitor back to, and the links in the emails.
 * - `findSession`, for a page that asks who is signed in.
 *
 * Nothing else may call Better Auth in a way that sets a cookie. The pages read with `auth.api`
 * after they have asked for the session, which is when there is nothing left for a read to set.
 * (That is why Better Auth's own `sveltekitCookies` plugin is not used: it would pass cookies on
 * from such a call without either rule.)
 */
import type { RequestEvent } from '@sveltejs/kit';
import { MARKER } from '#lib/auth/marker.js';
import { setClientAddress } from './address.js';
import { keepCookies, markerFor, sessionSetIn, settleCookies } from './cookies.js';
import { auth, type Session, sessionCookieName } from './index.js';

/** Better Auth's answer to a call, as an action needs it. */
export interface AuthAnswer {
	ok: boolean;
	status: number;
	/** The parsed body, when it was JSON. */
	data: Record<string, unknown> | null;
	/** Better Auth's code for what went wrong, such as `INVALID_EMAIL_OR_PASSWORD`. */
	code?: string;
	/** After a 429: how many seconds until the limiter will let another through. */
	retryAfter?: number;
}

type Visit = Pick<RequestEvent, 'url' | 'request' | 'cookies' | 'getClientAddress'>;

/**
 * The Set-Cookie lines of an answer, with the marker and Secure rules applied.
 *
 * The marker says things about the person whose session is being set (whether they may open the
 * admin area, whether they have switched the readout on), so they have to be known. `user` is
 * them, where the caller already knows (null for nobody). Otherwise, when the lines set a session
 * cookie, the session is looked up by it: one query, made as someone signs in, when their session
 * is renewed (once a day at most), and after `/update-user` (a new name, or a preference), whose
 * answer sets the session cookie again. Without it the admin button would not show after signing
 * in until some page happened to look the session up, and a preference would reach the marker a
 * page late.
 */
async function cookiesOf(
	event: Visit,
	headers: Headers,
	user?: Session['user'] | null
): Promise<string[]> {
	const lines = headers.getSetCookie();
	if (lines.length === 0) return lines;

	const name = await sessionCookieName();
	let owner = user;
	if (owner === undefined) {
		const cookie = sessionSetIn(lines, name);
		owner = cookie
			? ((
					await auth.api.getSession({
						headers: new Headers({ cookie }),
						// A look, and not a use: it must not renew the session it has just been handed.
						query: { disableRefresh: true }
					})
				)?.user ?? null)
			: null;
	}

	return settleCookies(
		lines,
		name,
		event.url.protocol === 'https:',
		owner ? markerFor(owner) : undefined
	);
}

/**
 * Asks Better Auth to do something, on behalf of the visitor whose request this is: `path` is
 * one of its POST endpoints, such as `/sign-in/email`, and `body` what that endpoint takes.
 *
 * The request carries the visitor's cookies and browser, and names this site as its origin.
 * That is honest: by the time an action runs, SvelteKit has already checked that the form was
 * posted from this site, and Better Auth's own check then has the same origin to compare.
 *
 * Whatever cookies the answer sets are handed to SvelteKit, to go out with the action's answer.
 * It does not throw for a refusal: the caller reads `ok`, and turns the code into a sentence
 * (src/lib/auth/messages.ts).
 */
export async function callAuth(event: Visit, path: string, body: object = {}): Promise<AuthAnswer> {
	const headers = new Headers({
		'content-type': 'application/json',
		origin: event.url.origin
	});
	for (const name of ['cookie', 'user-agent']) {
		const value = event.request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	setClientAddress(headers, event);

	const response = await auth.handler(
		new Request(`${event.url.origin}/api/auth${path}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		})
	);
	keepCookies(event, await cookiesOf(event, response.headers));

	// An answer that is not JSON is one Better Auth did not write, and has nothing to read.
	const data: unknown = await response.json().catch(() => null);
	const fields =
		typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
	const retryAfter = Number(response.headers.get('x-retry-after'));

	return {
		ok: response.ok,
		status: response.status,
		data: fields,
		code: typeof fields?.code === 'string' ? fields.code : undefined,
		retryAfter: response.status === 429 && retryAfter > 0 ? retryAfter : undefined
	};
}

/**
 * Answers a request the browser sent to `/api/auth/*`, with Better Auth's own answer. SvelteKit
 * has no route there, and does not add cookies to an answer it did not make, so they are
 * written into this one's headers.
 */
export async function answerAuth(event: RequestEvent): Promise<Response> {
	const asked = new Headers(event.request.headers);
	setClientAddress(asked, event);

	const response = await auth.handler(new Request(event.request, { headers: asked }));

	const headers = new Headers(response.headers);
	headers.delete('set-cookie');
	for (const line of await cookiesOf(event, response.headers)) headers.append('set-cookie', line);
	// Who is signed in, a link that has been used: none of it is a cache's to keep.
	if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

/**
 * Who is signed in, for the request this is, or null. Asked of the database every time: there is
 * no copy in a cookie to go stale, so a session that was revoked a moment ago is not found.
 *
 * It is also where the marker is put right. Better Auth may set or clear the session cookie as
 * it looks (it renews one that is a day old, and clears one whose session is gone), and the
 * marker follows as it does everywhere. Beyond that, a session found with no marker beside it,
 * or with one that says the wrong thing (the person's role has changed since it was set, or they
 * have switched the readout on or off in another browser), gets the right one, for as long as the
 * session has left. A marker with no session behind it is cleared: that is the browser whose
 * cookie outlived its session, or was written by hand.
 */
export async function findSession(event: Visit): Promise<Session | null> {
	const { response: session, headers } = await auth.api.getSession({
		headers: event.request.headers,
		returnHeaders: true
	});
	keepCookies(event, await cookiesOf(event, headers, session?.user ?? null));

	// What the request came with, or what Better Auth's own answer has just put in its place.
	const marked = event.cookies.get(MARKER);
	const secure = event.url.protocol === 'https:';
	if (session) {
		const wanted = markerFor(session.user);
		if (marked !== wanted) {
			const seconds = Math.floor((session.session.expiresAt.getTime() - Date.now()) / 1000);
			event.cookies.set(MARKER, wanted, {
				path: '/',
				maxAge: seconds,
				httpOnly: false,
				secure,
				sameSite: 'lax'
			});
		}
	} else if (marked !== undefined) {
		event.cookies.delete(MARKER, { path: '/', httpOnly: false, secure, sameSite: 'lax' });
	}

	return session;
}
