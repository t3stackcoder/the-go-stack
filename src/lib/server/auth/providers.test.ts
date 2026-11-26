// Which providers are offered, and whether they are the real ones or the fake, is decided from
// the environment as the server starts. Two things here would otherwise only be found out by
// pressing a button: that the client the app presents to the fake is the one the fake knows
// (they are written in two files that cannot share code: the fake runs alone in a container),
// and that nothing of the fake is in play unless OAUTH_MOCK_URL says so.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENTS, PROVIDERS as MOCKED } from '../../../../docker/mock-oauth/server.js';
import { PROVIDERS } from '../../auth/providers.js';

/** The module, loaded afresh with this environment. Every variable it reads is given. */
async function providersWith(env: Record<string, string | undefined>) {
	vi.resetModules();
	vi.doMock('$app/env/private', () => ({
		OAUTH_MOCK_URL: undefined,
		GOOGLE_CLIENT_ID: undefined,
		GOOGLE_CLIENT_SECRET: undefined,
		GITHUB_CLIENT_ID: undefined,
		GITHUB_CLIENT_SECRET: undefined,
		FACEBOOK_CLIENT_ID: undefined,
		FACEBOOK_CLIENT_SECRET: undefined,
		...env
	}));
	return import('./providers.js');
}

afterEach(() => {
	vi.doUnmock('$app/env/private');
});

describe('the fake providers', () => {
	it('are the providers the site offers, by the same ids', () => {
		expect([...MOCKED].sort()).toEqual(PROVIDERS.map((provider) => provider.id).sort());
	});

	it('are presented with the client each one knows', async () => {
		const { mockClient } = await providersWith({});
		for (const { id } of PROVIDERS) expect(mockClient(id)).toEqual(CLIENTS[id]);
	});

	it('stand in for all three while OAUTH_MOCK_URL is set, whatever else is', async () => {
		const { enabledProviders, mocked, mockProviders, socialProviders } = await providersWith({
			OAUTH_MOCK_URL: 'http://127.0.0.1:4000',
			GOOGLE_CLIENT_ID: 'real-id',
			GOOGLE_CLIENT_SECRET: 'real-secret'
		});

		expect(mocked).toBe(true);
		expect(enabledProviders).toEqual(['google', 'github', 'facebook']);
		expect(mockProviders).toHaveLength(1);
		// The real client is not handed to anything while the fake stands in.
		expect(socialProviders).toEqual({});
	});

	it('are not there at all without OAUTH_MOCK_URL', async () => {
		const { enabledProviders, mocked, mockProviders, socialProviders } = await providersWith({});

		expect(mocked).toBe(false);
		expect(mockProviders).toEqual([]);
		expect(enabledProviders).toEqual([]);
		expect(socialProviders).toEqual({});
	});
});

describe('the real providers', () => {
	it('are each offered only with both a client id and a secret', async () => {
		const { enabledProviders, socialProviders } = await providersWith({
			GOOGLE_CLIENT_ID: 'google-id',
			GOOGLE_CLIENT_SECRET: 'google-secret',
			// Half of what GitHub needs.
			GITHUB_CLIENT_ID: 'github-id',
			FACEBOOK_CLIENT_SECRET: 'facebook-secret'
		});

		expect(enabledProviders).toEqual(['google']);
		expect(socialProviders).toEqual({
			google: { clientId: 'google-id', clientSecret: 'google-secret' }
		});
	});

	it('are offered in the order their buttons stand', async () => {
		const { enabledProviders } = await providersWith({
			FACEBOOK_CLIENT_ID: 'f',
			FACEBOOK_CLIENT_SECRET: 'f',
			GITHUB_CLIENT_ID: 'h',
			GITHUB_CLIENT_SECRET: 'h'
		});
		expect(enabledProviders).toEqual(['github', 'facebook']);
	});
});
