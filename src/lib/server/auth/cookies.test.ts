// The header says who is signed in from a cookie the server keeps in step with the session's
// (src/lib/auth/marker.ts). If the two ever part, the header is wrong on every page that is built
// ahead of time, and nothing else would say so. These hold them together.

import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { MARKER } from '#lib/auth/marker.js';
import { keepCookies, settleCookies } from './cookies.js';

const SESSION = 'better-auth.session_token';

// As Better Auth writes them.
const set = `${SESSION}=abc.def; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`;
const cleared = `${SESSION}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
const other = 'better-auth.state=xyz; Max-Age=600; Path=/; HttpOnly; SameSite=Lax';

/** The marker's line among those that were settled, if there is one. */
const markerIn = (lines: string[]) => lines.find((line) => line.startsWith(`${MARKER}=`));

describe('the marker', () => {
	it('is set with the session cookie, for the same lifetime', () => {
		const marker = markerIn(settleCookies([set], SESSION, false));
		expect(marker).toBe(`${MARKER}=1; Path=/; Max-Age=604800; SameSite=Lax`);
	});

	it('is cleared with the session cookie', () => {
		const marker = markerIn(settleCookies([cleared], SESSION, false));
		expect(marker).toBe(`${MARKER}=; Path=/; Max-Age=0; SameSite=Lax`);
	});

	it('is cleared with a session cookie that is given no value, whatever its lifetime', () => {
		const marker = markerIn(settleCookies([`${SESSION}=; Path=/; HttpOnly`], SESSION, false));
		expect(marker).toBe(`${MARKER}=; Path=/; Max-Age=0; SameSite=Lax`);
	});

	it('lasts until the browser closes when the session cookie does', () => {
		const untilClosed = `${SESSION}=abc.def; Path=/; HttpOnly; SameSite=Lax`;
		expect(markerIn(settleCookies([untilClosed], SESSION, false))).toBe(
			`${MARKER}=1; Path=/; SameSite=Lax`
		);
	});

	it('keeps an expiry date, where the session cookie has one', () => {
		const dated = `${SESSION}=abc.def; Expires=Wed, 02 Dec 2026 12:00:00 GMT; Path=/; SameSite=Strict`;
		expect(markerIn(settleCookies([dated], SESSION, false))).toBe(
			`${MARKER}=1; Path=/; Expires=Wed, 02 Dec 2026 12:00:00 GMT; SameSite=Strict`
		);
	});

	it('can be read by script, which the session cookie cannot', () => {
		expect(markerIn(settleCookies([set], SESSION, true))).not.toMatch(/httponly/i);
	});

	it('carries nothing of the session', () => {
		expect(markerIn(settleCookies([set], SESSION, false))).not.toContain('abc');
	});

	it('is left alone by an answer that does not touch the session cookie', () => {
		expect(settleCookies([other], SESSION, false)).toEqual([other]);
		expect(settleCookies([], SESSION, false)).toEqual([]);
	});

	it('follows only the session cookie, and not one whose name begins the same', () => {
		const lookalike = `${SESSION}_old=abc; Max-Age=10; Path=/`;
		expect(markerIn(settleCookies([lookalike], SESSION, false))).toBeUndefined();
	});

	it('stands straight after the cookie it follows, and the rest keep their order', () => {
		const settled = settleCookies([other, set, cleared], SESSION, false);
		expect(settled.map((line) => line.split('=', 1)[0])).toEqual([
			'better-auth.state',
			SESSION,
			MARKER,
			SESSION,
			MARKER
		]);
	});
});

describe('Secure', () => {
	it('is put on every cookie of a request that came over HTTPS, the marker included', () => {
		const settled = settleCookies([other, set], SESSION, true);
		expect(settled).toHaveLength(3);
		for (const line of settled) expect(line).toMatch(/; Secure$/);
	});

	it('is put on no cookie of a request that came over plain HTTP', () => {
		for (const line of settleCookies([other, set], SESSION, false)) {
			expect(line).not.toMatch(/secure/i);
		}
	});

	it('is not put on twice', () => {
		const [line] = settleCookies([`${other}; Secure`], SESSION, true);
		expect(line.match(/secure/gi)).toHaveLength(1);
	});
});

describe('handing cookies to SvelteKit', () => {
	/** What `event.cookies.set` was called with, in order. */
	function kept(lines: string[]) {
		const calls: { name: string; value: string; options: Record<string, unknown> }[] = [];
		const cookies = {
			set: (name: string, value: string, options: Record<string, unknown>) =>
				void calls.push({ name, value, options })
		} as unknown as Cookies;
		keepCookies({ cookies }, lines);
		return calls;
	}

	it('says every attribute outright, so that SvelteKit fills in none of its own', () => {
		const [session, marker] = kept(settleCookies([set], SESSION, false));

		expect(session).toMatchObject({
			name: SESSION,
			value: 'abc.def',
			options: { path: '/', maxAge: 604800, httpOnly: true, secure: false, sameSite: 'lax' }
		});
		// SvelteKit's own default is HttpOnly, and the marker is for script to read.
		expect(marker).toMatchObject({
			name: MARKER,
			value: '1',
			options: { path: '/', maxAge: 604800, httpOnly: false, secure: false, sameSite: 'lax' }
		});
	});

	it('keeps Secure where the rule put it', () => {
		for (const { options } of kept(settleCookies([set], SESSION, true))) {
			expect(options.secure).toBe(true);
		}
	});

	it('clears what was cleared', () => {
		const [session, marker] = kept(settleCookies([cleared], SESSION, false));
		expect(session).toMatchObject({ value: '', options: { maxAge: 0 } });
		expect(marker).toMatchObject({ value: '', options: { maxAge: 0, httpOnly: false } });
	});
});
