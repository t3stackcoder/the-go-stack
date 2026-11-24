/**
 * The last step of deleting an account, where the link in the email leads. The link only brings
 * the visitor here: nothing is deleted until the button on this page is pressed, by somebody
 * signed in to the account the link was sent for.
 *
 * The link goes here and not to Better Auth's own address for it, which deletes on a GET, so
 * anything that follows links on the visitor's behalf (a mail scanner, a preview) would delete
 * the account (src/lib/server/auth/index.ts).
 */
import { error, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { sentenceFor } from '#lib/auth/messages.js';
import { nextQuery } from '#lib/auth/next.js';
import { saveAction } from '#lib/forms/server/save-action.js';
import { callAuth } from '#lib/server/auth/call.js';
import { turnDown } from '#lib/server/auth/refuse.js';
import type { PageServerLoad } from './$types';

/**
 * A visitor who is not signed in is sent to sign in and brought back here, to this address with
 * its query, so that the token in it survives the trip.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!(await locals.session())) redirect(303, `/sign-in${nextQuery(url.pathname + url.search)}`);

	const token = url.searchParams.get('token');
	return {
		token,
		// Whether it was never a link, or is one that has been used: the cure is a new one.
		problem: token === null ? sentenceFor('INVALID_TOKEN') : undefined
	};
};

export const actions = {
	/**
	 * Deletes the account, signs it out everywhere, and sends the visitor to the sign-in page,
	 * which says it is done.
	 *
	 * The token stays in the address the form posts to, where the link put it, and is not a
	 * field: what a refusal sends back is the fields, and a token must not be among them. A
	 * token that has been used, or was sent for another account, is `INVALID_TOKEN`.
	 *
	 * A repeat of the press is answered from memory, with the same redirect. The cookies the
	 * first answer cleared are not cleared again by it, and need not be: the session they name
	 * is gone, and the next page that asks finds no one and clears them.
	 */
	confirm: saveAction('confirm', z.object({}), async (_, event) => {
		// Turned down here, and not left to Better Auth: asked to delete with no token, it does
		// not refuse but sends another link, which is not what this button says it does.
		const token = event.url.searchParams.get('token');
		if (!token) error(400, sentenceFor('INVALID_TOKEN'));

		const answer = await callAuth(event, '/delete-user', { token });
		if (!answer.ok) turnDown(answer);

		redirect(303, '/sign-in?notice=deleted');
	})
};
