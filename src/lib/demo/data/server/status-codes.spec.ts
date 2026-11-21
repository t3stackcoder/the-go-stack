import { describe, expect, it } from 'vitest';
import { STATUS_CODES, searchStatusCodes } from './status-codes.js';

const codes = (query: string) => searchStatusCodes(query).map((status) => status.code);

describe('searchStatusCodes', () => {
	it('returns every code, in order, for an empty or blank query', () => {
		expect(searchStatusCodes('')).toEqual(STATUS_CODES);
		expect(searchStatusCodes('   ')).toEqual(STATUS_CODES);
	});

	it('matches the start of the code, not digits in the middle of it', () => {
		expect(codes('40')).toEqual([400, 401, 402, 403, 404, 405, 406, 407, 408, 409]);
		expect(codes('04')).toEqual([]);
	});

	it('matches any part of the phrase, ignoring case', () => {
		expect(codes('TIMEOUT')).toEqual([408, 504]);
	});

	it('matches the kind of status', () => {
		expect(codes('redirect')).toEqual(
			STATUS_CODES.filter((s) => s.code < 400 && s.code >= 300).map((s) => s.code)
		);
	});

	it('requires every word to match, in any order', () => {
		expect(codes('5 not')).toEqual([501, 505, 510]);
		expect(codes('found not')).toEqual([404]);
	});

	it('returns nothing when nothing matches', () => {
		expect(codes('teapot')).toEqual([]);
	});

	it('assigns each code the kind given by its first digit', () => {
		for (const { code, kind } of STATUS_CODES) {
			const expected = ['Informational', 'Success', 'Redirection', 'Client error', 'Server error'];
			expect(kind).toBe(expected[Math.floor(code / 100) - 1]);
		}
	});
});
