/**
 * Which providers a visitor can sign in with, and where each one really is. Decided once, as the
 * server starts, from the environment (src/env.ts):
 *
 * - With OAUTH_MOCK_URL set, all three are the fake in compose.yaml (docker/mock-oauth/server.js),
 *   which signs in a fixed person without showing a page.
 * - Without it, each provider that has been given a client id and a secret is the real one, and
 *   one that has not is not offered.
 *
 * Either way a provider goes by the same id, so the buttons, the action they post to, the
 * address the provider sends the visitor back to (`/api/auth/callback/<id>`) and the `providerId`
 * written to the database are the same for the fake as for the real one. Moving from one to the
 * other is a change to the environment and to nothing else.
 *
 * The fake needs its own way in because Better Auth's built-in Google, GitHub and Facebook have
 * the addresses they exchange codes at written into them: only the address the visitor is sent
 * to can be changed. So the fake is three providers of the generic kind, under the built-ins'
 * ids, where every address is the configuration's to give.
 */
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { PROVIDERS, type ProviderId } from '#lib/auth/providers.js';
import {
	FACEBOOK_CLIENT_ID,
	FACEBOOK_CLIENT_SECRET,
	GITHUB_CLIENT_ID,
	GITHUB_CLIENT_SECRET,
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	OAUTH_MOCK_URL
} from '$app/env/private';

/**
 * The client the fake knows each provider's app by. They are the fake's own, fixed in its script,
 * and secret from nobody. src/lib/server/auth/providers.test.ts checks that the two agree.
 */
export const mockClient = (id: ProviderId) => ({
	clientId: `mock-${id}-client`,
	clientSecret: `mock-${id}-secret`
});

const real: Record<ProviderId, { clientId?: string; clientSecret?: string }> = {
	google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
	github: { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET },
	facebook: { clientId: FACEBOOK_CLIENT_ID, clientSecret: FACEBOOK_CLIENT_SECRET }
};

/** Whether sign-in with a provider goes to the fake. */
export const mocked = OAUTH_MOCK_URL !== undefined;

/** The providers that are switched on, in the order their buttons stand. */
export const enabledProviders: ProviderId[] = PROVIDERS.map((provider) => provider.id).filter(
	(id) => mocked || (real[id].clientId !== undefined && real[id].clientSecret !== undefined)
);

/**
 * Where pressing a provider's button may send the visitor: the fake, or the real providers' own
 * sign-in pages. An action that starts a sign-in redirects there, and to nowhere else, whatever
 * address it was handed.
 */
export const providerOrigins: string[] =
	OAUTH_MOCK_URL !== undefined ? [OAUTH_MOCK_URL] : PROVIDERS.map((provider) => provider.origin);

/** The real providers, for Better Auth's `socialProviders`. Empty while the fake stands in. */
export const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = mocked
	? {}
	: Object.fromEntries(
			enabledProviders.map((id) => [
				id,
				{ clientId: real[id].clientId as string, clientSecret: real[id].clientSecret as string }
			])
		);

/** The fake providers, as the plugin that registers them. None unless OAUTH_MOCK_URL is set. */
export const mockProviders: BetterAuthPlugin[] = mocked
	? [
			genericOAuth({
				config: enabledProviders.map((id) => ({
					providerId: id,
					...mockClient(id),
					authorizationUrl: `${OAUTH_MOCK_URL}/${id}/authorize`,
					tokenUrl: `${OAUTH_MOCK_URL}/${id}/token`,
					userInfoUrl: `${OAUTH_MOCK_URL}/${id}/userinfo`
				}))
			})
		]
	: [];
