import * as z from 'zod';
import { saveAction } from '#lib/forms/server/save-action.js';
import { callAuth } from '#lib/server/auth/call.js';
import { Email } from '#lib/server/auth/fields.js';
import { turnDown } from '#lib/server/auth/refuse.js';

const Forgot = z.object({ email: Email });

export const actions = {
	/**
	 * Sends a link to choose a new password, to an address that has an account. The answer is the
	 * same when it has none, and comes as quickly (the email is not waited for: see
	 * src/lib/server/mail.ts), so this cannot be used to find out who has an account here.
	 *
	 * It is also how an account that was made by signing in with a provider is given a password:
	 * the link sets one where there was none.
	 */
	send: saveAction('send', Forgot, async ({ email }, event) => {
		const answer = await callAuth(event, '/request-password-reset', {
			email,
			// Where the link in the email leads, with the token it was sent with.
			redirectTo: '/reset-password'
		});
		if (!answer.ok) turnDown(answer, { INVALID_EMAIL: 'email' });

		return { action: 'send' as const };
	})
};
