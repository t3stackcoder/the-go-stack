// `next` is written by whoever wrote the link, and followed straight after a visitor has signed
// in. Each case here is a way a link has been made to lead off a site that followed it.

import { describe, expect, it } from 'vitest';
import { HOME, nextQuery, safeNext } from './next.js';

describe('where signing in leads', () => {
	it.each([
		['/account'],
		['/forms?server=slow'],
		['/data/search?q=two%20words&page=2'],
		['/stability#images'],
		['/team-collaborator']
	])('follows a path on this site: %s', (path) => {
		expect(safeNext(path)).toBe(path);
	});

	it.each([
		['nothing', undefined],
		['null', null],
		['an empty value', ''],
		['another site', 'https://evil.example/'],
		['another site, by protocol-relative address', '//evil.example/'],
		['another site, behind a backslash', '/\\evil.example/'],
		['another site, behind two backslashes', '\\\\evil.example/'],
		['a backslash further in', '/account\\..\\evil'],
		['a path with no leading slash', 'account'],
		['a script', 'javascript:alert(1)'],
		['a script behind a slash and a tab', '/\tjavascript:alert(1)'],
		['a tab that browsers drop, before a second slash', '/\t/evil.example/'],
		['a line break that browsers drop', '/\n/evil.example/'],
		['a null character', '/account\u0000'],
		['an encoded slash in the path', '/%2Fevil.example'],
		['an encoded backslash in the path', '/%5Cevil.example'],
		['a data address', 'data:text/html,<script>alert(1)</script>'],
		['credentials before a host', '//user@evil.example/'],
		['a whole address on this site', 'https://site.invalid/account']
	])('goes home for %s', (_what, value) => {
		expect(safeNext(value)).toBe(HOME);
	});

	// A signed-in visitor is sent on from these pages to `next`. Sent on to one of them, they
	// would go round until the browser gave up.
	it.each([
		['/sign-in'],
		['/sign-up'],
		['/sign-in?next=/sign-in'],
		['/sign-up/'],
		['/sign-in#top']
	])('goes home in place of a page that would send the visitor on again: %s', (path) => {
		expect(safeNext(path)).toBe(HOME);
	});

	it('leaves dots in a path to the parser, which keeps them on this site', () => {
		expect(safeNext('/a/../../account')).toBe('/account');
	});

	it('keeps an encoded slash that is in the query, where it is data', () => {
		expect(safeNext('/data/search?q=a%2Fb')).toBe('/data/search?q=a%2Fb');
	});
});

describe('the query that carries it', () => {
	it('is empty for the home page, which is where signing in leads anyway', () => {
		expect(nextQuery(HOME)).toBe('');
	});

	it('survives being read back', () => {
		const next = '/data/search?q=two words&page=2#results';
		const read = new URL(`/sign-in${nextQuery(next)}`, 'https://site.invalid').searchParams;
		expect(read.get('next')).toBe(next);
	});
});
