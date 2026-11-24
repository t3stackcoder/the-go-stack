import { error, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { noticeFor, sentenceFor } from '#lib/auth/messages.js';
import { nextQuery, safeNext } from '#lib/auth/next.js';
import { PROVIDERS } from '#lib/auth/providers.js';
import { saveAction } from '#lib/forms/server/save-action.js';
import { callAuth } from '#lib/server/auth/call.js';
import { Email, Name, NewPassword, Password } from '#lib/server/auth/fields.js';
import { enabledProviders, providerOrigins } from '#lib/server/auth/providers.js';
import { turnDown } from '#lib/server/auth/refuse.js';
import type { PageServerLoad, RequestEvent } from './$types';

/** Where the visitor set out from, and goes back to once they are signed in. */
const nextOf = ({ url }: Pick<RequestEvent, 'url'>) => safeNext(url.searchParams.get('next'));

/**
 * Where a link in an email leads once Better Auth has acted on it: the sign-in page. A visitor
 * the link has signed in is sent straight on from there, and one whose link was no good is told
 * so, on a page that can send another.
 */
const afterEmail = (next: string) => `/sign-in${nextQuery(next)}`;

export const load: PageServerLoad = async ({ locals, params, untrack, url }) => {
	const next = nextOf({ url });

	// Nothing to do here for a visitor who is signed in. That is also the end of a link from an
	// email: it signs the visitor in and sends them to this page, which sends them on.
	//
	// Asking for a new password is the exception. A signed-in visitor may have forgotten theirs,
	// or hold a link that has expired, and the page that says so sends them here for another.
	//
	// The address is read without being watched. Watched, every move between the three would
	// ask the server for this again, and the slide would wait for the answer.
	const forgot = untrack(() => params.mode === 'forgot-password');
	if (!forgot && (await locals.session())) redirect(303, next);

	// What the visitor arrives to be told: that a provider turned them down, or that something
	// begun on another page is done. Both are named in the address, which anybody can write, so
	// each is only looked up among sentences written here.
	const failed = url.searchParams.get('error');
	const notice = noticeFor(url.searchParams.get('notice'));

	return {
		// The page to go back to, as the query every address on the page carries it in.
		query: nextQuery(next),
		providers: enabledProviders,
		arrival:
			failed !== null
				? { words: sentenceFor(failed), bad: true }
				: notice
					? { words: notice, bad: false }
					: undefined
	};
};

const SignIn = z.object({ email: Email, password: Password });
const SignUp = z.object({ name: Name, email: Email, password: NewPassword });

const Social = z.object({ provider: z.enum(PROVIDERS.map((provider) => provider.id)) });

const Resend = z.object({ email: Email });

const Forgot = z.object({ email: Email });

export const actions = {
	/**
	 * Signs in with an email address and a password, and sends the visitor on.
	 *
	 * The answer is the session cookie, so it cannot be given from memory: a repeat of the press
	 * is signed in again. That is safe. Each sign-in is a session of its own, and the one the
	 * browser ends up holding is the one it uses.
	 */
	signIn: saveAction(
		'signIn',
		SignIn,
		async ({ email, password }, event) => {
			const next = nextOf(event);
			const answer = await callAuth(event, '/sign-in/email', {
				email,
				password,
				// For the link that is sent again when the address was never verified.
				callbackURL: afterEmail(next)
			});
			if (!answer.ok) turnDown(answer, { INVALID_EMAIL: 'email', PASSWORD_TOO_LONG: 'password' });

			redirect(303, next);
		},
		{ secret: ['password'], remember: false }
	),

	/**
	 * Creates an account, which does not sign in until its address is verified. The answer is the
	 * same whether or not the address already had an account: the page says to check the inbox,
	 * and the inbox says which it was.
	 */
	signUp: saveAction(
		'signUp',
		SignUp,
		async ({ name, email, password }, event) => {
			const answer = await callAuth(event, '/sign-up/email', {
				name,
				email,
				password,
				callbackURL: afterEmail(nextOf(event))
			});
			if (!answer.ok) {
				turnDown(answer, {
					INVALID_EMAIL: 'email',
					PASSWORD_TOO_SHORT: 'password',
					PASSWORD_TOO_LONG: 'password'
				});
			}

			return { action: 'signUp' as const, sent: email };
		},
		{ secret: ['password'] }
	),

	/** Sends the verification link again, to the address the sign-up was for. */
	resend: saveAction('resend', Resend, async ({ email }, event) => {
		const answer = await callAuth(event, '/send-verification-email', {
			email,
			callbackURL: afterEmail(nextOf(event))
		});
		if (!answer.ok) turnDown(answer);

		return { action: 'resend' as const, sent: email };
	}),

	/**
	 * Sends a link to choose a new password, to an address that has an account. The answer is the
	 * same when it has none, and comes as quickly (the email is not waited for: see
	 * src/lib/server/mail.ts), so this cannot be used to find out who has an account here.
	 *
	 * It is also how an account that was made by signing in with a provider is given a password:
	 * the link sets one where there was none.
	 */
	forgot: saveAction('forgot', Forgot, async ({ email }, event) => {
		const answer = await callAuth(event, '/request-password-reset', {
			email,
			// Where the link in the email leads, with the token it was sent with.
			redirectTo: '/reset-password'
		});
		if (!answer.ok) turnDown(answer, { INVALID_EMAIL: 'email' });

		return { action: 'forgot' as const };
	}),

	/**
	 * Starts a sign-in with a provider: asks Better Auth for the provider's address and sends the
	 * visitor there. The form that posts here is sent the browser's own way, with no helper
	 * attached, because the visitor is leaving the site whichever way it is sent.
	 *
	 * What comes back with the address is a cookie that ties the provider's answer to this
	 * browser, so this cannot be answered from memory either.
	 */
	social: saveAction(
		'social',
		Social,
		async ({ provider }, event) => {
			if (!enabledProviders.includes(provider)) error(404, sentenceFor('PROVIDER_NOT_FOUND'));

			const next = nextOf(event);
			const answer = await callAuth(event, '/sign-in/social', {
				provider,
				callbackURL: next,
				// Back to the page the visitor pressed the button on, which says what went wrong.
				errorCallbackURL: `/${event.params.mode}${nextQuery(next)}`,
				disableRedirect: true
			});
			const address = answer.data?.url;
			if (!answer.ok || typeof address !== 'string') turnDown(answer);

			// To the provider and nowhere else: SvelteKit makes no redirect off the site that it
			// has not been told to expect.
			redirect(303, address, { external: providerOrigins });
		},
		{ remember: false }
	)
};
