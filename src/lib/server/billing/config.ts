/**
 * Which Polar billing talks to, decided once from the environment (src/env.ts):
 *
 * - With POLAR_MOCK_URL set, it is the fake (scripts/mock-polar/server.js), which the worker
 *   starts at that address. Its token, its secret and its product are its own, fixed in its
 *   script, and the real ones are ignored.
 * - Without it, it is the real Polar that POLAR_SERVER names, and the four values Polar gave
 *   this site are needed, all of them together. The server starts without them, because most
 *   of the site has nothing to do with billing, and the first thing that needs one says which
 *   are missing.
 *
 * All four are asked for whichever of them is wanted. Each was once asked for only where it was
 * used, so a site with the token and the product and no webhook secret sold subscriptions it
 * could never hear about: the checkout worked, the buyer paid, and every webhook was refused.
 * Now such a site cannot start a checkout, and says why.
 *
 * Either way the calls, the webhooks and the pages are the same. Moving from the fake to the
 * real one is a change to the environment and to nothing else.
 */
import {
	POLAR_ACCESS_TOKEN,
	POLAR_METER_ID,
	POLAR_MOCK_URL,
	POLAR_PRODUCT_ID,
	POLAR_SERVER,
	POLAR_WEBHOOK_SECRET
} from '$app/env/private';
import { type Catalogue, MOCK } from './catalogue.js';
import type { PolarConnection } from './polar/client.js';

/** Whether billing goes to the fake. */
export const mocked = POLAR_MOCK_URL !== undefined;

/** The four values Polar gave this site, or an error that names every one that is missing. */
function given() {
	const values = {
		POLAR_ACCESS_TOKEN,
		POLAR_WEBHOOK_SECRET,
		POLAR_PRODUCT_ID,
		POLAR_METER_ID
	};
	const missing = Object.entries(values)
		.filter(([, value]) => value === undefined)
		.map(([name]) => name);
	if (missing.length > 0) {
		throw new Error(
			`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set, and billing needs all four of Polar's values. Set them, or set POLAR_MOCK_URL to use the fake Polar (see .env.example).`
		);
	}
	return values as Record<keyof typeof values, string>;
}

export function polarConnection(): PolarConnection {
	return mocked
		? { accessToken: MOCK.accessToken, baseUrl: POLAR_MOCK_URL }
		: { accessToken: given().POLAR_ACCESS_TOKEN, server: POLAR_SERVER };
}

export function catalogue(): Catalogue {
	if (mocked) return { productId: MOCK.productId, meterIds: { ...MOCK.meterIds } };
	const { POLAR_PRODUCT_ID: productId, POLAR_METER_ID: meterId } = given();
	return { productId, meterIds: { api_calls: meterId } };
}

export function webhookSecret(): string {
	return mocked ? MOCK.webhookSecret : given().POLAR_WEBHOOK_SECRET;
}

/** Which of Polar's rate limits applies (./worker/budget.ts). */
export const polarKind = mocked ? 'mock' : POLAR_SERVER;

/** Where the fake is served, for the worker that starts it. Undefined for the real Polar. */
export const mockUrl = POLAR_MOCK_URL;
