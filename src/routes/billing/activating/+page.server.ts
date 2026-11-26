/**
 * Where Polar sends a buyer back to once they have paid. Coming back proves nothing: anybody can
 * open this address, and the subscription is not this site's until Polar has said so by a webhook
 * and the worker has written it to Redis (src/lib/server/billing/webhook.ts). So this page only
 * looks, in `entitlements`, which is Redis and never Polar, and sends the visitor on to the
 * billing page the moment the subscription is there. Until then it says that it is waiting.
 *
 * And it asks for the worker to ask Polar (`requestSync`), which is what covers a webhook that
 * never arrives: a buyer who is back here has, most likely, paid. That is one statement to
 * Postgres on a page that is otherwise Redis alone, and it marks a row at most once in a few
 * seconds however often the page looks (src/lib/server/billing/service.ts).
 *
 * The page looks again by loading this again, about once a second, for half a minute
 * (#lib/billing/activation.ts). A visitor who is not signed in, because their session ended
 * while they were on Polar's page, is sent to sign in and brought back.
 */
import { redirect } from '@sveltejs/kit';
import { nextQuery } from '#lib/auth/next.js';
import { LOOKS, looksSoFar } from '#lib/billing/activation.js';
import { entitlements, requestSync } from '#lib/server/billing/index.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const session = await locals.session();
	if (!session) redirect(303, `/sign-in${nextQuery(url.pathname + url.search)}`);

	const { status } = await entitlements(session.user.id);
	if (status === 'active') redirect(303, '/billing');

	// Only for somebody still waiting: asked for a subscriber, it would be a question to Polar
	// about nothing.
	await requestSync(session.user.id);

	const looked = looksSoFar(url);
	return {
		// Whether the looks a page without JavaScript is allowed have all been had.
		late: looked >= LOOKS,
		// Where such a page refreshes itself to next, with one more look counted.
		next: `/billing/activating?looked=${looked + 1}`
	};
};
