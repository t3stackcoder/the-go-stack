import { LOG_LEVEL } from '$app/env/private';

/**
 * Writes one event as one line of JSON: to standard error for errors, to standard output for the
 * rest. That is the form a container's log collector expects, and each line can be searched by
 * field. Sending events to an error tracker instead would be a change to this function alone.
 *
 * With LOG_LEVEL set to "error" (see src/env.ts), only errors are written.
 */
export function record(level: 'info' | 'error', event: string, details: Record<string, unknown>) {
	if (level === 'info' && LOG_LEVEL === 'error') return;

	const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...details });

	if (level === 'error') console.error(line);
	else console.log(line);
}
