// Which Polar billing talks to, and with what. Broken in the way it once was, a site that had
// been given some of Polar's values and not others took a buyer's money and could never hear that
// it had: the checkout needed only the token and the product, and the webhook that starts the
// subscription needed the secret that was missing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK } from './catalogue.js';

const ALL = {
	POLAR_ACCESS_TOKEN: 'polar_oat_token',
	POLAR_WEBHOOK_SECRET: 'whsec_secret',
	POLAR_PRODUCT_ID: 'product-id',
	POLAR_METER_ID: 'meter-id'
};

/** The configuration, as it comes out for a server started with these variables. */
async function configuredWith(variables: Record<string, string | undefined>) {
	vi.resetModules();
	vi.doMock('$app/env/private', () => ({
		POLAR_MOCK_URL: undefined,
		POLAR_SERVER: 'sandbox',
		POLAR_ACCESS_TOKEN: undefined,
		POLAR_WEBHOOK_SECRET: undefined,
		POLAR_PRODUCT_ID: undefined,
		POLAR_METER_ID: undefined,
		...variables
	}));
	return import('./config.js');
}

afterEach(() => vi.doUnmock('$app/env/private'));

describe('with the real Polar', () => {
	it('uses the four values Polar gave this site', async () => {
		const config = await configuredWith(ALL);

		expect(config.polarConnection()).toEqual({ accessToken: 'polar_oat_token', server: 'sandbox' });
		expect(config.catalogue()).toEqual({
			productId: 'product-id',
			meterIds: { api_calls: 'meter-id' }
		});
		expect(config.webhookSecret()).toBe('whsec_secret');
	});

	it.each(Object.keys(ALL))(
		'cannot start a checkout while %s is missing, and names it',
		async (missing) => {
			const config = await configuredWith({ ...ALL, [missing]: undefined });

			// Everything a checkout is made from, and everything a webhook is checked with.
			for (const needed of [config.polarConnection, config.catalogue, config.webhookSecret]) {
				expect(needed).toThrow(`${missing} is not set`);
			}
		}
	);

	it('names every value that is missing, and not only the first', async () => {
		const config = await configuredWith({ POLAR_ACCESS_TOKEN: 'polar_oat_token' });

		expect(config.polarConnection).toThrow(
			'POLAR_WEBHOOK_SECRET, POLAR_PRODUCT_ID, POLAR_METER_ID are not set'
		);
	});
});

describe('with the fake Polar', () => {
	it("uses the fake's own values, and needs none of the real ones", async () => {
		const config = await configuredWith({ POLAR_MOCK_URL: 'http://127.0.0.1:4100' });

		expect(config.polarConnection()).toEqual({
			accessToken: MOCK.accessToken,
			baseUrl: 'http://127.0.0.1:4100'
		});
		expect(config.catalogue().productId).toBe(MOCK.productId);
		expect(config.webhookSecret()).toBe(MOCK.webhookSecret);
	});
});
