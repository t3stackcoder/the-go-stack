/**
 * What is done to every cookie Better Auth sets, on its way to the browser. Two rules, kept in
 * one place because every answer of Better Auth's passes through it: the ones it gives a form's
 * action (./call.ts), and the ones it gives the browser itself (src/hooks.server.ts).
 *
 * The marker rule. Whenever the session cookie is set, the marker is set beside it, and whenever
 * the session cookie is cleared, the marker is cleared: the same lifetime, the same `SameSite`
 * and the same `Secure`, but readable by script, which is what it is for (src/lib/auth/marker.ts).
 * What it says is the caller's to decide, from whose session it is (`markerFor`).
 *
 * The Secure rule. A cookie is marked Secure exactly when the request arrived over HTTPS, as the
 * rest of the site's cookies are (see the note in src/routes/forms/+page.server.ts). Better Auth
 * decides once, as the server starts, and goes by NODE_ENV: a deployment that forgot to set it
 * would send its session cookie without Secure, and a production build opened at
 * http://127.0.0.1 would send it with, where WebKit drops it. So Better Auth is told never to
 * mark them (`useSecureCookies: false` in ./index.ts), and they are marked here, a request at a
 * time, from the protocol the request came by.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { MARKED, MARKER } from '#lib/auth/marker.js';
import { can } from './access.js';

/** The part of a Set-Cookie line before its attributes: the cookie's name and its value. */
function pairOf(line: string): [name: string, value: string] {
	const pair = line.split(';', 1)[0];
	const equals = pair.indexOf('=');
	return [pair.slice(0, equals).trim(), pair.slice(equals + 1).trim()];
}

/** One attribute of a Set-Cookie line, as it was written, such as `Max-Age=604800`. */
function attribute(line: string, name: string): string | undefined {
	return line
		.split(';')
		.slice(1)
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().split('=', 1)[0] === name);
}

/**
 * Whether a Set-Cookie line clears its cookie, as a browser reads it: no value, or a lifetime
 * that is already over.
 */
function clears(line: string): boolean {
	const maxAge = attribute(line, 'max-age');
	return pairOf(line)[1] === '' || (maxAge !== undefined && Number(maxAge.slice(8)) <= 0);
}

/**
 * What the marker says for someone who is signed in: whether their role lets them open the admin
 * area.
 */
export function markerFor(user: { role?: string | null }): string {
	return can(user, { adminArea: ['open'] }) ? MARKED.admin : MARKED.signedIn;
}

/**
 * The session cookie these lines set, as a Cookie header would carry it (`name=value`), so that
 * whose session it is can be looked up. Undefined when they do not set one: they clear it, or
 * leave it alone.
 */
export function sessionSetIn(lines: string[], sessionCookie: string): string | undefined {
	const line = lines.find((each) => pairOf(each)[0] === sessionCookie && !clears(each));
	return line?.split(';', 1)[0].trim();
}

/**
 * The Set-Cookie lines of one answer, with the two rules applied.
 *
 * @param lines What Better Auth set, one cookie a line.
 * @param sessionCookie The name of its session cookie.
 * @param secure Whether the request arrived over HTTPS.
 * @param marker What the marker says, if these lines set the session cookie (`markerFor`).
 */
export function settleCookies(
	lines: string[],
	sessionCookie: string,
	secure: boolean,
	marker: string = MARKED.signedIn
): string[] {
	const settled: string[] = [];

	for (const line of lines) {
		settled.push(secure && !attribute(line, 'secure') ? `${line}; Secure` : line);

		if (pairOf(line)[0] !== sessionCookie) continue;

		const maxAge = attribute(line, 'max-age');
		const cleared = clears(line);

		settled.push(
			[
				`${MARKER}=${cleared ? '' : marker}`,
				'Path=/',
				// A session cookie with no lifetime lasts until the browser closes, and so does
				// its marker.
				cleared ? 'Max-Age=0' : maxAge,
				cleared ? undefined : attribute(line, 'expires'),
				attribute(line, 'samesite') ?? 'SameSite=Lax',
				secure ? 'Secure' : undefined
			]
				.filter((part) => part !== undefined)
				.join('; ')
		);
	}

	return settled;
}

/**
 * Hands Set-Cookie lines to SvelteKit, which adds them to whatever answer the request ends in: a
 * page, a form's result, a redirect. For a request SvelteKit is answering itself. An answer of
 * Better Auth's own, sent as it stands, carries its lines in its headers instead.
 */
export function keepCookies(event: Pick<RequestEvent, 'cookies'>, lines: string[]): void {
	for (const line of lines) {
		for (const [name, cookie] of parseSetCookieHeader(line)) {
			// Each said outright. Left out, SvelteKit would fill in defaults of its own: HttpOnly,
			// which the marker must not be, and a Secure that goes by the host's name.
			event.cookies.set(name, cookie.value, {
				path: cookie.path ?? '/',
				domain: cookie.domain,
				maxAge: cookie['max-age'],
				expires: cookie.expires,
				httpOnly: cookie.httponly === true,
				secure: cookie.secure === true,
				sameSite: cookie.samesite ?? 'lax'
			});
		}
	}
}
