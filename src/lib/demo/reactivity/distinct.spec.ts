import { describe, expect, it } from 'vitest';
import { distinct } from './distinct.js';

describe('distinct', () => {
	it('returns the requested number of different values within range', () => {
		const picked = distinct(1000, 2400);

		expect(picked).toHaveLength(1000);
		expect(new Set(picked).size).toBe(1000);
		expect(picked.every((value) => Number.isInteger(value) && value >= 0 && value < 2400)).toBe(
			true
		);
	});

	it('can pick every value', () => {
		expect(distinct(10, 10).toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('refuses a count it could never satisfy, rather than looping forever', () => {
		expect(() => distinct(11, 10)).toThrow(RangeError);
		expect(() => distinct(-1, 10)).toThrow(RangeError);
	});
});
