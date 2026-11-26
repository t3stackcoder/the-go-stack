// The catalogue says what a person may use, and what the fake Polar says it is, in two files that
// cannot share code (the fake runs alone, as a script). A limit worked out wrong lets somebody use
// more than they paid for, or stops them short of it. A name that differs between the two is only
// found out when an event is sent and Polar counts nothing for it.

import { describe, expect, it } from 'vitest';
import {
	METER as MOCK_METER,
	PRODUCT as MOCK_PRODUCT,
	TOKEN as MOCK_TOKEN,
	WEBHOOK_SECRET as MOCK_WEBHOOK_SECRET
} from '../../../../scripts/mock-polar/server.js';
import { isMeterKey, limitsFor, METER_KEYS, METERS, MOCK } from './catalogue.js';

describe("a meter's limit", () => {
	it("is the period's credits and the meter's overage", () => {
		expect(limitsFor({ api_calls: 1000 })).toEqual({ api_calls: 1000 + METERS.api_calls.overage });
	});

	it('counts a credit that was not given as nought, so that the overage alone is the limit', () => {
		expect(limitsFor({})).toEqual({ api_calls: METERS.api_calls.overage });
	});

	it('is not made for a meter the catalogue does not have', () => {
		expect(limitsFor({ api_calls: 5, storage: 9 })).toEqual({
			api_calls: 5 + METERS.api_calls.overage
		});
	});

	it('has an entry for every meter that is stopped, and only those', () => {
		const stopped = METER_KEYS.filter((key) => METERS[key].overage !== null);

		expect(Object.keys(limitsFor({})).sort()).toEqual(stopped.sort());
	});
});

describe('the names of meters', () => {
	it('are the catalogue keys, and nothing inherited from objects', () => {
		expect(isMeterKey('api_calls')).toBe(true);
		expect(isMeterKey('storage')).toBe(false);
		expect(isMeterKey('toString')).toBe(false);
		expect(isMeterKey('__proto__')).toBe(false);
	});
});

describe('the fake Polar', () => {
	it('is what the app expects it to be: the same token, secret, product and meter', () => {
		expect(MOCK.accessToken).toBe(MOCK_TOKEN);
		expect(MOCK.webhookSecret).toBe(MOCK_WEBHOOK_SECRET);
		expect(MOCK.productId).toBe(MOCK_PRODUCT.id);
		expect(MOCK.meterIds.api_calls).toBe(MOCK_METER.id);
	});

	it('counts the event the app sends, by its name and the property it adds up', () => {
		expect(METERS.api_calls.eventName).toBe(MOCK_METER.eventName);
		expect(METERS.api_calls.property).toBe(MOCK_METER.property);
	});
});
