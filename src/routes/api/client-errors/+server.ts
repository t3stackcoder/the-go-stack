import { error } from '@sveltejs/kit';
import { record } from '#lib/server/log.js';
import type { RequestHandler } from './$types';

/** Far more than a stack trace needs, and little enough that nobody can use this to fill a disk. */
const MAX_LENGTH = 8 * 1024;

const FIELDS = ['reference', 'source', 'path', 'route', 'name', 'message', 'stack'] as const;

/**
 * Receives the errors that src/lib/browser-errors.ts reports, and records them beside the server's
 * own.
 *
 * Anyone can post here, so nothing in the body is trusted: it is capped in size, only the known
 * fields are kept, and only as text. The app's own code stops after a few reports from one page,
 * but limiting how often a client may post is left to the proxy in front of the server, which is
 * where a rate limit belongs.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.text();
	if (body.length > MAX_LENGTH) error(413, 'The report is too large.');

	let report: unknown;
	try {
		report = JSON.parse(body);
	} catch {
		error(400, 'The report is not JSON.');
	}
	if (typeof report !== 'object' || report === null) error(400, 'The report is not an object.');

	const fields = report as Record<string, unknown>;
	record('error', 'unexpected error in the browser', {
		...Object.fromEntries(
			FIELDS.filter((name) => typeof fields[name] === 'string').map((name) => [name, fields[name]])
		),
		userAgent: request.headers.get('user-agent')
	});

	return new Response(null, { status: 204 });
};
