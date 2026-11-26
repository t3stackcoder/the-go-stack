/**
 * The preferences page: choices about how the site behaves for the person signed in, kept with
 * their account (`additionalFields` in src/lib/server/auth/index.ts), so that each follows them
 * to every browser they sign in on.
 *
 * A choice that changes what every page shows from its first frame, as the readout does, also
 * travels in the marker cookie (src/lib/auth/marker.ts), since most pages are built once for
 * everybody and cannot ask. Nothing here sets the marker. Better Auth sets the session cookie
 * again with its answer to a change, and the marker goes beside it, saying what the account now
 * holds (`cookiesOf` in src/lib/server/auth/call.ts). Were it ever not to, the next look at the
 * session would put the marker right (`findSession`, in the same file).
 */
import { redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { nextQuery } from '#lib/auth/next.js';
import { saveAction } from '#lib/forms/server/save-action.js';
import { callAuth } from '#lib/server/auth/call.js';
import { turnDown } from '#lib/server/auth/refuse.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const session = await locals.session();
	if (!session) redirect(303, `/sign-in${nextQuery(url.pathname + url.search)}`);

	return { showReadout: session.user.showReadout === true };
};

/** The state the switch asks for, and never a flip: a press can arrive twice (save-action.ts). */
const Readout = z.object({ showReadout: z.enum(['true', 'false']) });

export const actions = {
	/**
	 * Switches the readout on or off. Through Better Auth, so that the rate limiter and the
	 * origin check run, and a visitor whose session has ended is turned down on the form.
	 *
	 * The session is not looked up here. It is looked up once for a request and then kept, and
	 * a page sent without JavaScript has its data loaded in this same request: looked up before
	 * the change, the page that answers the press would show the old choice.
	 */
	readout: saveAction('readout', Readout, async ({ showReadout }, event) => {
		const answer = await callAuth(event, '/update-user', { showReadout: showReadout === 'true' });
		if (!answer.ok) turnDown(answer);

		return { action: 'readout' as const };
	})
};
