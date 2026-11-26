// What the billing page is sent: only what it shows, written as it shows it, and small. The page
// data is written into the HTML of every load of the page, so its size is held to a bound here,
// for the largest summary there can be.

import { describe, expect, it } from 'vitest';
import { summarize } from './summary.js';

const LABELS = { api_calls: { label: 'API calls' } };

const active = {
	status: 'active' as const,
	productId: '7c1e2d90-41b7-4f0a-8a2e-5b9f6c3d0b02',
	periodStart: new Date('2026-11-01T00:00:00Z'),
	periodEnd: new Date('2026-12-01T00:00:00Z'),
	meters: { api_calls: { consumed: 1234, limit: 1200 } }
};

describe('the billing page summary', () => {
	it('says only that somebody does not subscribe', () => {
		const none = {
			status: 'none' as const,
			productId: null,
			periodStart: null,
			periodEnd: null,
			meters: { api_calls: { consumed: 0, limit: null } }
		};
		expect(summarize(none, LABELS)).toEqual({ subscribed: false });
	});

	it('writes out the period and each meter, and carries no ids', () => {
		const summary = summarize(active, LABELS);
		expect(summary).toEqual({
			subscribed: true,
			periodEnd: { iso: '2026-12-01T00:00:00.000Z', text: '1 Dec 2026, 00:00 UTC' },
			meters: [{ key: 'api_calls', label: 'API calls', used: '1,234', limit: '1,200', share: 1 }]
		});
		expect(JSON.stringify(summary)).not.toContain(active.productId);
	});

	it('gives the share of the limit used, and none where nothing limits a meter', () => {
		const share = (consumed: number, limit: number | null) => {
			const summary = summarize({ ...active, meters: { api_calls: { consumed, limit } } }, LABELS);
			return summary.subscribed ? summary.meters[0].share : undefined;
		};
		expect(share(0, 1100)).toBe(0);
		expect(share(1, 3)).toBe(0.333);
		expect(share(1100, 1100)).toBe(1);
		// Used past its limit, which Redis does not allow, the bar is still only full.
		expect(share(1500, 1100)).toBe(1);
		// A limit of none at all: anything used is all of it.
		expect(share(0, 0)).toBe(0);
		expect(share(5, 0)).toBe(1);
		expect(share(5, null)).toBeNull();
	});

	it('says when the period ends is not known, if it is not', () => {
		const summary = summarize({ ...active, periodEnd: null }, LABELS);
		expect(summary.subscribed && summary.periodEnd).toBeNull();
	});

	it('is under a kilobyte, at its largest', () => {
		const largest = summarize(
			{
				...active,
				periodEnd: new Date('2026-12-31T23:59:59.999Z'),
				meters: {
					api_calls: { consumed: Number.MAX_SAFE_INTEGER, limit: Number.MAX_SAFE_INTEGER }
				}
			},
			LABELS
		);
		expect(new TextEncoder().encode(JSON.stringify(largest)).length).toBeLessThan(1024);
	});
});
