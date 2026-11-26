/**
 * The billing page: what the visitor subscribes to, how much of it they have used, and the way to
 * Polar, to pay or to manage what they pay for. And a way to try the meter by hand.
 *
 * What the page shows comes from `entitlements`, which is one look in Redis and never a call to
 * Polar (src/lib/server/billing/service.ts). Polar is called only by the Upgrade and Manage
 * billing buttons, each somebody asking to be sent there and waiting to be. When Polar cannot be
 * reached, or billing is not set up, those buttons end on the form, saying so, and the fault is
 * recorded with what went wrong: a variable that is not set is named in the log.
 *
 * Paying does not make anybody a subscriber here. Polar tells this site by a webhook, and the
 * worker writes the subscription to Redis, about a second later (src/lib/server/billing/
 * webhook.ts). Until `entitlements` says so, whatever Polar's page said, the visitor has not
 * subscribed.
 */
import { error, type RequestEvent, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { sentenceFor } from '#lib/auth/messages.js';
import { nextQuery } from '#lib/auth/next.js';
import {
	counted,
	NOTHING_TO_MANAGE,
	notCounted,
	UNCOUNTABLE,
	UNITS,
	UNREACHABLE
} from '#lib/billing/messages.js';
import { summarize } from '#lib/billing/summary.js';
import { saveAction, stopIfAbandoned } from '#lib/forms/server/save-action.js';
import {
	entitlements,
	METERS,
	openPortal,
	recordUsage,
	startCheckout
} from '#lib/server/billing/index.js';
import { recordFault } from '#lib/server/faults.js';
import type { PageServerLoad } from './$types';

/** The session, for an action that needs to know whose billing it is acting on. */
async function signedIn(event: Pick<RequestEvent, 'locals'>) {
	const session = await event.locals.session();
	if (!session) error(401, sentenceFor('UNAUTHORIZED'));
	return session;
}

/**
 * Ends the action with `sentence`, on the form, for a call to billing that failed. The failure
 * is a fault, and recorded as one, under a reference, with what went wrong. The visitor is told
 * what it means for them and not what it was: that is for whoever reads the log.
 */
function unreachable(failure: unknown, event: RequestEvent, sentence: string): never {
	recordFault(failure, event);
	error(503, sentence);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const session = await locals.session();
	if (!session) redirect(303, `/sign-in${nextQuery(url.pathname + url.search)}`);

	return summarize(await entitlements(session.user.id), METERS);
};

const Nothing = z.object({});
/** The amounts the form offers. Text, as posted, and counted as a number once it is one of them. */
const Use = z.object({ units: z.enum(['1', '10', '100'], { error: UNITS }) });

export const actions = {
	/**
	 * Sends the visitor to Polar's checkout. Polar sends them back to /billing/activating when
	 * they have paid, and to /billing if they give up (src/lib/server/billing/index.ts).
	 *
	 * Sent the browser's own way, as the buttons that connect a provider are on the account page:
	 * the visitor leaves the site whichever way it is sent. A repeat of the press is answered from
	 * memory (save-action.ts), so it is sent to the same checkout and not to a second one.
	 *
	 * Somebody who subscribes already is sent back to the page, which says so. The page offers
	 * them no Upgrade, but one open in another tab since before they paid still would, and a
	 * second checkout would be a second subscription.
	 */
	upgrade: saveAction('upgrade', Nothing, async (_, event) => {
		const { user } = await signedIn(event);
		if ((await entitlements(user.id)).status === 'active') redirect(303, '/billing');

		let checkout: string;
		try {
			checkout = await startCheckout({
				subjectId: user.id,
				email: user.email,
				name: user.name || null,
				origin: event.url.origin
			});
		} catch (failure) {
			unreachable(failure, event, UNREACHABLE);
		}

		// Off the site, to wherever Polar's answer says its checkout is. The address is Polar's,
		// given to this server, and nothing the visitor sent. The content security policy's
		// `form-action` is what holds the browser to Polar's own origins (vite.config.ts).
		redirect(303, checkout, { external: true });
	}),

	/**
	 * Sends the visitor to Polar's own pages for them, where they see their invoices and cancel.
	 * Sent the browser's own way, as Upgrade is. Somebody Polar has never sold anything to has
	 * nothing there, and is told so on the form.
	 */
	manage: saveAction('manage', Nothing, async (_, event) => {
		const { user } = await signedIn(event);

		let portal: string | null;
		try {
			portal = await openPortal({ subjectId: user.id, origin: event.url.origin });
		} catch (failure) {
			unreachable(failure, event, UNREACHABLE);
		}
		if (portal === null) return { action: 'manage' as const, message: NOTHING_TO_MANAGE };

		// As for Upgrade: the address is the one Polar gave this server.
		redirect(303, portal, { external: true });
	}),

	/**
	 * Counts a use against the meter, as a product's own endpoint would before doing its work,
	 * and says what came of it.
	 *
	 * Each press is a use of its own: no `eventId` is given, so billing makes one. A press that
	 * arrives twice is still counted once, on this server, because `saveAction` answers the
	 * repeat from memory: by the key the form helper sends, or without JavaScript by the post
	 * itself, within a second (src/lib/forms/server/once.ts). The helper's key is not a UUID, which
	 * an `eventId` has to be, so it is not passed on.
	 *
	 * A use that is not allowed is turned down on the form, and counts nothing. So does one that
	 * cannot be counted at all, because Redis cannot be reached: allowing what cannot be counted
	 * is how a limit stops being one.
	 */
	use: saveAction('use', Use, async ({ units: chosen }, event) => {
		const { user } = await signedIn(event);
		const units = Number(chosen);

		stopIfAbandoned(event);
		let use: Awaited<ReturnType<typeof recordUsage>>;
		try {
			use = await recordUsage({ subjectId: user.id, meter: 'api_calls', units });
		} catch (failure) {
			unreachable(failure, event, UNCOUNTABLE);
		}

		if (!use.allowed) {
			// 402 for somebody with nothing to count against, 409 for a limit it would pass.
			error(use.reason === 'inactive' ? 402 : 409, notCounted(units, use.reason, use.remaining));
		}
		return { action: 'use' as const, units: chosen, message: counted(units, use.remaining) };
	})
};
