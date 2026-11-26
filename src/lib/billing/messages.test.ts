// Every sentence the billing page's forms can say fits the line reserved for it: two lines for a
// form's status, one under a field, held to the account pages' limits (src/lib/auth/messages.ts).
// The sentences with numbers in them are tried with the longest numbers they can be given.

import { describe, expect, it } from 'vitest';
import { FIELD_MAX, FORM_MAX } from '#lib/auth/messages.js';
import {
	counted,
	NOTHING_TO_MANAGE,
	notCounted,
	UNCOUNTABLE,
	UNITS,
	UNREACHABLE
} from './messages.js';

/** More than anybody will be allowed in a period, written out with its commas. */
const MOST = 9_999_999_999;

describe("the billing page's sentences", () => {
	it('fit the two lines of a form status', () => {
		const sentences = [
			UNREACHABLE,
			NOTHING_TO_MANAGE,
			UNCOUNTABLE,
			counted(100, MOST),
			counted(100, null),
			notCounted(100, 'inactive', 0),
			// Refused at the limit, what is left is always less than what was asked for.
			notCounted(100, 'limit', 99),
			notCounted(100, 'limit', 0)
		];
		for (const sentence of sentences) {
			expect(sentence.length, sentence).toBeLessThanOrEqual(FORM_MAX);
		}
	});

	it('fit the line under a field', () => {
		expect(UNITS.length).toBeLessThanOrEqual(FIELD_MAX);
	});

	it('say what was counted and what is left, in numbers', () => {
		expect(counted(10, 1190)).toBe('Counted 10. 1,190 left this period.');
		expect(notCounted(100, 'limit', 42)).toBe(
			'Not counted: 100 is more than the 42 left this period.'
		);
		expect(notCounted(1, 'limit', 0)).toBe(
			'Not counted: the limit for this period has been reached.'
		);
	});
});
