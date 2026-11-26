/**
 * What is sold and what is metered: the one product, and the one meter.
 *
 * A meter here is this site's name for something Polar counts. Polar's own meter decides what an
 * event is worth: it picks out events by name and adds up one of their properties. So the name
 * and the property below have to be the ones the meter in Polar was set up with, and the fake's
 * are the same (scripts/mock-polar/server.js).
 *
 * `overage` is this site's decision and not Polar's. Polar never stops anyone using more than
 * they have credit for. It only counts, and bills the excess if the product has a metered price.
 * Stopping is done here (./redis.ts), at the period's credits plus this many units: 0 stops at
 * the credits exactly, and null never stops.
 */
export const METERS = {
	api_calls: { label: 'API calls', eventName: 'api_call', property: 'units', overage: 100 }
} as const satisfies Record<
	string,
	{ label: string; eventName: string; property: string; overage: number | null }
>;

export type MeterKey = keyof typeof METERS;

export const METER_KEYS = Object.keys(METERS) as MeterKey[];

export const isMeterKey = (value: string): value is MeterKey => Object.hasOwn(METERS, value);

/**
 * What the fake Polar goes by. They are the fake's own, fixed in its script, and secret from
 * nobody. src/lib/server/billing/catalogue.test.ts checks that the two agree.
 */
export const MOCK = {
	accessToken: 'mock-polar-token',
	webhookSecret: 'whsec_bW9jay1wb2xhci13ZWJob29rLXNlY3JldC0zMmJ5dGU=',
	productId: '7c1e2d90-41b7-4f0a-8a2e-5b9f6c3d0b02',
	meterIds: { api_calls: '0b6f1a52-6d0e-4c53-9d53-3d4a8c1f0a01' }
} as const;

/** The ids Polar knows the product and each meter by, which differ from one Polar to the next. */
export interface Catalogue {
	productId: string;
	meterIds: Record<MeterKey, string>;
}

/**
 * The most of each meter that may be used in a period that credited `credits`. A meter that is
 * never stopped has no entry.
 */
export function limitsFor(credits: Record<string, number>): Record<string, number> {
	const limits: Record<string, number> = {};
	for (const key of METER_KEYS) {
		const { overage } = METERS[key];
		if (overage !== null) limits[key] = (credits[key] ?? 0) + overage;
	}
	return limits;
}
