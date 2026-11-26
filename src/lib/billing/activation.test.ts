// The count of looks that a page without JavaScript carries in its address. It is anybody's to
// write, so whatever arrives is read as a number of looks from none to all of them.

import { describe, expect, it } from 'vitest';
import { LOOKS, looksSoFar } from './activation.js';

const at = (query: string) => looksSoFar(new URL(`http://site.invalid/billing/activating${query}`));

describe('the looks a page has had', () => {
	it('is none on arrival from Polar', () => {
		expect(at('')).toBe(0);
	});

	it('is the count in the address', () => {
		expect(at('?looked=1')).toBe(1);
		expect(at(`?looked=${LOOKS}`)).toBe(LOOKS);
	});

	it('is never more than all of them', () => {
		expect(at(`?looked=${LOOKS + 1}`)).toBe(LOOKS);
	});

	it('is none for anything that is not a count', () => {
		for (const looked of ['-3', '2.5', '1e300', 'many', '', 'NaN', 'Infinity']) {
			expect(at(`?looked=${looked}`), looked).toBe(0);
		}
	});
});
