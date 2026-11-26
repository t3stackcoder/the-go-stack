import { takeWebhook } from '#lib/server/billing/index.js';
import type { RequestHandler } from './$types.js';

/**
 * Where Polar sends its webhooks. Register this exact address with Polar: it counts a redirect
 * as a failure, and stops sending to an address that fails ten times running.
 *
 * The body is read as text and handed on untouched, because the signature is over the bytes
 * Polar sent and parsing them first would be acting on something not yet known to be Polar's.
 * The answer has no body. What is done with a webhook, and why so little, is in
 * src/lib/server/billing/webhook.ts.
 *
 * SvelteKit lets this through its check that a form was posted from this site, because it is not
 * a form: Polar sends JSON, and says so.
 */
export const POST: RequestHandler = async ({ request }) => {
	const receipt = await takeWebhook(await request.text(), request.headers);
	return new Response(null, { status: receipt.status, headers: { 'cache-control': 'no-store' } });
};
