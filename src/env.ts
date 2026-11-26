import { defineEnvVars } from '@sveltejs/kit/env';

/** A value as a URL, or undefined if it is missing or is not one. */
function parsed(value: string | undefined): URL | undefined {
	return value !== undefined && URL.canParse(value) ? new URL(value) : undefined;
}

/** A variable that may be left out. Left empty counts as left out, as .env.example leaves them. */
const optional = (value: string | undefined): string | undefined => value || undefined;

/**
 * A value copied out of a dashboard, which may be left out. A space or a line break that came
 * with the copy is not part of it: left on a token, every call it signed was refused, and nothing
 * said why until somebody tried to pay.
 */
const pasted = (value: string | undefined): string | undefined => value?.trim() || undefined;

/**
 * The environment variables this app reads, each with its type and its rule. SvelteKit checks them
 * when the server starts, so a missing or mistyped value stops the deployment instead of
 * surfacing later as odd behaviour. Server code imports them, typed, from `$app/env/private`.
 *
 * The variables the Node adapter reads for itself (PORT, HOST, ORIGIN and the rest) are not
 * declared here. It validates its own, and its documentation lists them. What this site does
 * about ORIGIN on a developer's machine is told in server.js.
 *
 * .env.example has a value for each of these that works with compose.yaml.
 */
export const variables = defineEnvVars({
	LOG_LEVEL: {
		description:
			'The least serious kind of event the server writes to its log: "info" (the default) or "error".',
		schema: (value): 'info' | 'error' => {
			if (value === undefined || value === '' || value === 'info') return 'info';
			if (value === 'error') return 'error';
			throw new Error(`LOG_LEVEL must be "info" or "error", and is "${value}".`);
		}
	},
	STRESS_PAGES: {
		description:
			'Whether the pages under /stress are served outside development: "on", or "off" (the default). They are test rigs that anyone could use to load the server, so leave this off wherever visitors can reach.',
		schema: (value): boolean => {
			if (value === undefined || value === '' || value === 'off') return false;
			if (value === 'on') return true;
			throw new Error(`STRESS_PAGES must be "on" or "off", and is "${value}".`);
		}
	},
	DATABASE_URL: {
		description:
			'The Postgres database the accounts are kept in, as a URL: postgres://user:password@host:5432/database.',
		schema: (value): string => {
			const url = parsed(value);
			if (url?.protocol !== 'postgres:' && url?.protocol !== 'postgresql:') {
				// The value is not repeated in the message: it has a password in it.
				throw new Error('DATABASE_URL must be a URL that starts postgres:// or postgresql://.');
			}
			return value as string;
		}
	},
	BETTER_AUTH_SECRET: {
		description:
			'Signs session cookies and the links sent by email. At least 32 characters, and different on every deployment. Changing it signs everybody out.',
		schema: (value): string => {
			if (value === undefined || value.length < 32) {
				throw new Error('BETTER_AUTH_SECRET must be at least 32 characters long.');
			}
			// The value .env.example ships with is long enough to pass, and known to everyone.
			if (value.startsWith('replace-me')) {
				throw new Error(
					'BETTER_AUTH_SECRET is still the placeholder from .env.example. Give it a value of its own.'
				);
			}
			return value;
		}
	},
	SMTP_URL: {
		description:
			'The mail server the app sends through, as a URL: smtp://user:password@host:587, or smtps:// for a server that speaks TLS from the start.',
		schema: (value): string => {
			const url = parsed(value);
			if (url?.protocol !== 'smtp:' && url?.protocol !== 'smtps:') {
				throw new Error('SMTP_URL must be a URL that starts smtp:// or smtps://.');
			}
			return value as string;
		}
	},
	MAIL_FROM: {
		description:
			'Who the app sends email as: an address, or a name and an address as "Name <address>".',
		schema: (value): string => value || 'Team Collaborator <no-reply@team-collaborator.localhost>'
	},
	OAUTH_MOCK_URL: {
		description:
			'Development only: the address of the fake Google, GitHub and Facebook in compose.yaml. While it is set, signing in with a provider goes there instead of to the real one. It must name this machine.',
		schema: (value): string | undefined => {
			if (value === undefined || value === '') return undefined;
			const url = parsed(value);
			// The mock signs in whoever asks, as a fixed person. Set by mistake on a real
			// deployment, whatever answered at the address would be believed, so only this
			// machine's own names are taken. Not [::1], its third name: the content security
			// policy has to name the mock too (vite.config.ts), and a policy has no way to
			// write an IPv6 address, so a browser would refuse to go there.
			if (
				(url?.protocol !== 'http:' && url?.protocol !== 'https:') ||
				!['localhost', '127.0.0.1'].includes(url.hostname)
			) {
				throw new Error(
					`OAUTH_MOCK_URL must be an http or https address on localhost or 127.0.0.1, and is "${value}".`
				);
			}
			return url.origin;
		}
	},
	SERVICE_COUNT: {
		description:
			'How many services compose.yaml defines. The health page under /admin draws that many rows while it waits for Docker to list them, and says so when Docker lists a different number. Left out, it draws none. Update it when a service is added or removed.',
		schema: (value): number | undefined => {
			if (value === undefined || value === '') return undefined;
			const count = Number(value);
			if (!Number.isInteger(count) || count < 1 || count > 50) {
				throw new Error(`SERVICE_COUNT must be a whole number from 1 to 50, and is "${value}".`);
			}
			return count;
		}
	},
	REDIS_URL: {
		description:
			'The Redis server that billing keeps its counters in, as a URL: redis://host:6379, or rediss:// for TLS. The server does not start without it, whether or not billing is set up: it is part of the site, as the database is.',
		schema: (value): string => {
			const url = parsed(value);
			if (url?.protocol !== 'redis:' && url?.protocol !== 'rediss:') {
				// The value is not repeated in the message: it may have a password in it.
				throw new Error('REDIS_URL must be a URL that starts redis:// or rediss://.');
			}
			return value as string;
		}
	},
	POLAR_MOCK_URL: {
		description:
			'Development only: the address the fake Polar is served at (scripts/mock-polar/server.js), which `pnpm billing:worker` starts while this is set. Checkout, the customer portal and every billing call go there instead of to Polar. It must name this machine.',
		schema: (value): string | undefined => {
			if (value === undefined || value === '') return undefined;
			const url = parsed(value);
			// The fake gives a subscription to whoever presses its Pay button. Set by mistake on a
			// real deployment, whatever answered at the address would be believed, so only this
			// machine's own names are taken, as for OAUTH_MOCK_URL above and for the same reason
			// about [::1].
			if (
				(url?.protocol !== 'http:' && url?.protocol !== 'https:') ||
				!['localhost', '127.0.0.1'].includes(url.hostname)
			) {
				throw new Error(
					`POLAR_MOCK_URL must be an http or https address on localhost or 127.0.0.1, and is "${value}".`
				);
			}
			return url.origin;
		}
	},
	POLAR_SERVER: {
		description:
			'Which Polar the real one is: "sandbox" (the default) or "production". Each has its own access tokens. Ignored while POLAR_MOCK_URL is set.',
		schema: (value): 'sandbox' | 'production' => {
			if (value === undefined || value === '' || value === 'sandbox') return 'sandbox';
			if (value === 'production') return 'production';
			throw new Error(`POLAR_SERVER must be "sandbox" or "production", and is "${value}".`);
		}
	},
	POLAR_ACCESS_TOKEN: {
		description:
			'The organization access token Polar gave this site. Server only. It and the three values below are needed together: billing does nothing until all four are set. Ignored while POLAR_MOCK_URL is set.',
		schema: pasted
	},
	POLAR_WEBHOOK_SECRET: {
		description:
			"The secret Polar signs its webhooks with, from the endpoint registered for <the site's origin>/api/webhooks/polar. Ignored while POLAR_MOCK_URL is set.",
		schema: pasted
	},
	POLAR_PRODUCT_ID: {
		description:
			'The id of the product in Polar that the Upgrade button sells. Ignored while POLAR_MOCK_URL is set.',
		schema: pasted
	},
	POLAR_METER_ID: {
		description:
			'The id of the meter in Polar that counts API calls. Ignored while POLAR_MOCK_URL is set.',
		schema: pasted
	},
	GOOGLE_CLIENT_ID: {
		description: 'The client id Google gave this site, for "Continue with Google".',
		schema: optional
	},
	GOOGLE_CLIENT_SECRET: {
		description: 'The secret that goes with GOOGLE_CLIENT_ID.',
		schema: optional
	},
	GITHUB_CLIENT_ID: {
		description: 'The client id GitHub gave this site, for "Continue with GitHub".',
		schema: optional
	},
	GITHUB_CLIENT_SECRET: {
		description: 'The secret that goes with GITHUB_CLIENT_ID.',
		schema: optional
	},
	FACEBOOK_CLIENT_ID: {
		description: 'The app id Facebook gave this site, for "Continue with Facebook".',
		schema: optional
	},
	FACEBOOK_CLIENT_SECRET: {
		description: 'The secret that goes with FACEBOOK_CLIENT_ID.',
		schema: optional
	}
});
