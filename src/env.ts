import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * The environment variables this app reads, each with its type and its rule. SvelteKit checks them
 * when the server starts, so a missing or mistyped value stops the deployment instead of
 * surfacing later as odd behaviour. Server code imports them, typed, from `$app/env/private`.
 *
 * The variables the Node adapter reads for itself (PORT, HOST, ORIGIN and the rest) are not
 * declared here. It validates its own, and they are listed in the README.
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
	}
});
