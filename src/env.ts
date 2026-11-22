import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * The environment variables this app reads, each with its type and its rule. SvelteKit checks them
 * when the server starts, so a missing or mistyped value stops the deployment instead of
 * surfacing later as odd behaviour. Server code imports them, typed, from `$app/env/private`.
 *
 * The variables the Node adapter reads for itself (PORT, HOST, ORIGIN and the rest) are not
 * declared here. It validates its own, and its documentation lists them. What this site does
 * about ORIGIN on a developer's machine is told in server.js.
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
	}
});
