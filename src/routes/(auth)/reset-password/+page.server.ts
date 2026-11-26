import { redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { sentenceFor } from '#lib/auth/messages.js';
import { saveAction } from '#lib/forms/server/save-action.js';
import { callAuth } from '#lib/server/auth/call.js';
import { NewPassword } from '#lib/server/auth/fields.js';
import { turnDown } from '#lib/server/auth/refuse.js';
import type { PageServerLoad } from './$types';

/**
 * The link in the email goes to Better Auth first, which checks its token and sends the visitor
 * here: with the token in the address if it is good, and with an error in its place if it has
 * expired or been used. The page is asked for directly, with neither, by somebody who has no
 * link at all.
 */
export const load: PageServerLoad = ({ url }) => {
	const token = url.searchParams.get('token');
	const failed = url.searchParams.get('error');

	return {
		token: failed === null ? token : null,
		// Either way the cure is the same, and the sentence says it: ask for a new link.
		problem: failed !== null || token === null ? sentenceFor('INVALID_TOKEN') : undefined
	};
};

const Reset = z.object({ password: NewPassword });

export const actions = {
	/**
	 * Sets the new password, signs the account out everywhere, and sends the visitor to sign in
	 * with it.
	 *
	 * The token stays in the address the form posts to, where the link put it, and is not a
	 * field: what a refusal sends back is the fields, and a token must not be among them.
	 */
	reset: saveAction(
		'reset',
		Reset,
		async ({ password }, event) => {
			const answer = await callAuth(event, '/reset-password', {
				newPassword: password,
				token: event.url.searchParams.get('token') ?? ''
			});
			if (!answer.ok) {
				turnDown(answer, { PASSWORD_TOO_SHORT: 'password', PASSWORD_TOO_LONG: 'password' });
			}

			redirect(303, '/sign-in?notice=password-changed');
		},
		{ secret: ['password'] }
	)
};
