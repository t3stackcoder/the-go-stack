/**
 * The account page: who the visitor is, and every change they can make to that. One form and one
 * action for each thing: the name, the address, the password, the providers that sign them in,
 * the sessions they have open, and the account itself.
 *
 * Everything that changes anything goes to Better Auth through `callAuth`, inside `saveAction`,
 * so that the rate limiter and the origin check run and every refusal ends on the form. The
 * page's own reads go to `auth.api` directly, and only after `locals.session()` has been asked:
 * by then a read has nothing left to set (src/lib/server/auth/call.ts).
 *
 * The page is sent what it shows and nothing more. In particular no session's token, which is
 * the session: the forms name a session by its id, and the action looks the token up here.
 */
import { error, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { FIELD, NOTICES, SAID, sentenceFor } from '#lib/auth/messages.js';
import { nextQuery } from '#lib/auth/next.js';
import { PROVIDERS } from '#lib/auth/providers.js';
import { refuse, saveAction } from '#lib/forms/server/save-action.js';
import { callAuth } from '#lib/server/auth/call.js';
import { describeAddress, describeDevice } from '#lib/server/auth/device.js';
import { Email, Name, NewPassword, Password } from '#lib/server/auth/fields.js';
import { auth } from '#lib/server/auth/index.js';
import { enabledProviders, providerOrigins } from '#lib/server/auth/providers.js';
import { turnDown } from '#lib/server/auth/refuse.js';
import type { PageServerLoad, RequestEvent } from './$types';

/**
 * When a session began, as it is printed. In UTC, and saying so: the server does not know the
 * visitor's time zone, and a time put into local time by the browser would differ from the one
 * in the server's HTML, so the page would change under the visitor as it hydrated.
 */
const UTC = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'UTC',
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/** Where a change of address leads back to, from both its links: here, naming the new address. */
const afterEmailChange = (newEmail: string) => `/account?changing=${encodeURIComponent(newEmail)}`;

/** The session, for an action that needs to know whose account it is acting on. */
async function signedIn(event: Pick<RequestEvent, 'locals'>) {
	const session = await event.locals.session();
	if (!session) error(401, sentenceFor('UNAUTHORIZED'));
	return session;
}

export const load: PageServerLoad = async ({ locals, request, url }) => {
	const session = await locals.session();
	if (!session) redirect(303, `/sign-in${nextQuery(url.pathname + url.search)}`);

	const { headers } = request;
	const [accounts, sessions] = await Promise.all([
		auth.api.listUserAccounts({ headers }),
		auth.api.listSessions({ headers })
	]);
	const { user } = session;

	// What the visitor arrives to be told. Both links of a change of address come back here
	// naming the new address, as `?changing=`; a provider that was being connected comes back
	// with `?notice=connected`, or with `?error=` when it was turned down. The address is
	// anybody's to write, so a code is only looked up among sentences written here, and the
	// new address is only shown once it has been read as an address, and then as text.
	const failed = url.searchParams.get('error');
	const changingAsked = url.searchParams.get('changing');
	const changing = changingAsked === null ? undefined : Email.safeParse(changingAsked);

	let emailArrival: { words: string; bad: boolean } | undefined;
	let pending: string | undefined;
	if (changing !== undefined && failed !== null) {
		emailArrival = { words: sentenceFor(failed), bad: true };
	} else if (changing?.success) {
		// The second link has been opened when the account already has the new address. Until
		// then the first has, and the second is waiting in the new inbox.
		if (changing.data.toLowerCase() === user.email.toLowerCase()) {
			emailArrival = { words: SAID.emailChanged, bad: false };
		} else {
			emailArrival = { words: SAID.emailHalfway, bad: false };
			pending = changing.data;
		}
	}

	const notice = url.searchParams.get('notice');
	const connectionsArrival =
		changing !== undefined
			? undefined
			: failed !== null
				? { words: sentenceFor(failed), bad: true }
				: notice === 'connected'
					? { words: NOTICES.connected, bad: false }
					: undefined;
	const passwordArrival =
		notice === 'password-updated' ? { words: NOTICES['password-updated'], bad: false } : undefined;

	return {
		user: { name: user.name, email: user.email },
		hasPassword: accounts.some((account) => account.providerId === 'credential'),
		// One for each provider that is switched on, linked or not. `accountId` is Better Auth's
		// own id for the link, which is what unlinking asks for, and not the provider's id for
		// the person. `last` is the only way in, which Better Auth will not remove: the page
		// says so in place of offering a button that would be refused.
		connections: enabledProviders.map((provider) => {
			const linked = accounts.find((account) => account.providerId === provider);
			return {
				provider,
				accountId: linked?.id ?? null,
				last: linked !== undefined && accounts.length === 1
			};
		}),
		// This one first, then the newest.
		sessions: sessions
			.map((open) => {
				const began = new Date(open.createdAt);
				return {
					id: open.id,
					current: open.id === session.session.id,
					device: describeDevice(open.userAgent),
					address: describeAddress(open.ipAddress),
					began: { iso: began.toISOString(), text: `${UTC.format(began)} UTC` }
				};
			})
			// Times in ISO form sort as text.
			.sort(
				(a, b) => Number(b.current) - Number(a.current) || (a.began.iso < b.began.iso ? 1 : -1)
			),
		arrival: { email: emailArrival, password: passwordArrival, connections: connectionsArrival },
		pending
	};
};

const Rename = z.object({ name: Name });
const ChangeEmail = z.object({ email: Email });
const ChangePassword = z.object({ currentPassword: Password, newPassword: NewPassword });
const Unlink = z.object({ accountId: z.string().min(1) });
const Link = z.object({ provider: z.enum(PROVIDERS.map((provider) => provider.id)) });
const Revoke = z.object({ sessionId: z.string().min(1) });
const Nothing = z.object({});

export const actions = {
	/**
	 * Saves the name the team sees. Better Auth sets the session cookie again with its answer,
	 * with the same token in it, so a repeat answered from memory without the cookie loses
	 * nothing.
	 */
	rename: saveAction('rename', Rename, async ({ name }, event) => {
		const answer = await callAuth(event, '/update-user', { name });
		if (!answer.ok) turnDown(answer);

		return { action: 'rename' as const };
	}),

	/**
	 * Starts a change of address. A link goes to the address the account has now, and opening it
	 * sends a second to the new one, which makes the change (src/lib/server/auth/index.ts).
	 *
	 * The account's own address is turned down here, under the field: Better Auth answers it
	 * with words and no code, which would reach the visitor as the general sentence.
	 */
	changeEmail: saveAction('changeEmail', ChangeEmail, async ({ email }, event) => {
		const { user } = await signedIn(event);
		if (email.toLowerCase() === user.email.toLowerCase()) refuse({ email: FIELD.emailSame });

		const answer = await callAuth(event, '/change-email', {
			newEmail: email,
			callbackURL: afterEmailChange(email)
		});
		if (!answer.ok) turnDown(answer, { INVALID_EMAIL: 'email' });

		return { action: 'changeEmail' as const };
	}),

	/**
	 * Changes the password, and signs the account out everywhere else: whoever else is signed in
	 * may be who the password is being changed against.
	 *
	 * That makes a new session for this browser, whose cookie comes with the answer, so this
	 * cannot be answered from memory. It is safe to run twice: a repeat is turned down, as the
	 * current password it carries is no longer the current one.
	 */
	changePassword: saveAction(
		'changePassword',
		ChangePassword,
		async ({ currentPassword, newPassword }, event) => {
			const answer = await callAuth(event, '/change-password', {
				currentPassword,
				newPassword,
				revokeOtherSessions: true
			});
			if (!answer.ok) {
				turnDown(answer, {
					INVALID_PASSWORD: 'currentPassword',
					PASSWORD_TOO_SHORT: 'newPassword',
					PASSWORD_TOO_LONG: 'newPassword'
				});
			}

			// The answer holds the new session's token, which goes no further than this, and the
			// session this request came with is gone. The page cannot be drawn in answer to it:
			// sent without JavaScript, the page is drawn by the same request, which would find
			// itself signed out and be sent to sign in. So the browser is sent to load it again,
			// with the new cookie, and the page says what was done when it arrives.
			redirect(303, '/account?notice=password-updated');
		},
		{ secret: ['currentPassword', 'newPassword'], remember: false }
	),

	/**
	 * Gives a password to an account that has none, because it was made by signing in with a
	 * provider: a link to choose one, sent to the account's own address. It is the same link as
	 * a forgotten password's, which sets one where there was none.
	 */
	setPassword: saveAction('setPassword', Nothing, async (_, event) => {
		const { user } = await signedIn(event);
		const answer = await callAuth(event, '/request-password-reset', {
			email: user.email,
			redirectTo: '/reset-password'
		});
		if (!answer.ok) turnDown(answer);

		return { action: 'setPassword' as const };
	}),

	/** Takes a provider off the account. Better Auth refuses to take the last way in. */
	unlink: saveAction('unlink', Unlink, async ({ accountId }, event) => {
		const answer = await callAuth(event, '/unlink-account', { accountId });
		if (!answer.ok) turnDown(answer);

		return { action: 'unlink' as const };
	}),

	/**
	 * Starts connecting a provider: asks Better Auth for the provider's address and sends the
	 * visitor there. As on the sign-in page, the form is sent the browser's own way, because the
	 * visitor is leaving the site whichever way it is sent, and the answer is a cookie that ties
	 * the provider's answer to this browser, so it cannot be given from memory.
	 *
	 * The provider's account must have the account's own address, or Better Auth sends the
	 * visitor back with `?error=email_does_not_match` (see src/lib/server/auth/index.ts for why).
	 */
	link: saveAction(
		'link',
		Link,
		async ({ provider }, event) => {
			if (!enabledProviders.includes(provider)) error(404, sentenceFor('PROVIDER_NOT_FOUND'));

			const answer = await callAuth(event, '/link-social', {
				provider,
				callbackURL: '/account?notice=connected',
				errorCallbackURL: '/account',
				disableRedirect: true
			});
			const address = answer.data?.url;
			if (!answer.ok || typeof address !== 'string') turnDown(answer);

			// To the provider and nowhere else: SvelteKit makes no redirect off the site that it
			// has not been told to expect.
			redirect(303, address, { external: providerOrigins });
		},
		{ remember: false }
	),

	/**
	 * Signs one other session out. The form names it by its id, and its token, which Better Auth
	 * asks for, is looked up here among the account's own sessions: the token is the session, and
	 * is never sent to the page. A session that is not among them has already ended, which is
	 * what was asked for. This browser's own is ended by signing out, which says so.
	 */
	revoke: saveAction('revoke', Revoke, async ({ sessionId }, event) => {
		const session = await signedIn(event);
		if (sessionId === session.session.id) error(400, SAID.thisSession);

		const open = await auth.api.listSessions({ headers: event.request.headers });
		const found = open.find((other) => other.id === sessionId);
		if (found) {
			const answer = await callAuth(event, '/revoke-session', { token: found.token });
			if (!answer.ok) turnDown(answer);
		}

		return { action: 'revoke' as const };
	}),

	/** Signs every session out but this browser's. */
	revokeOthers: saveAction('revokeOthers', Nothing, async (_, event) => {
		const answer = await callAuth(event, '/revoke-other-sessions');
		if (!answer.ok) turnDown(answer);

		return { action: 'revokeOthers' as const };
	}),

	/**
	 * Asks to delete the account. Nothing is deleted yet: a link goes to the account's address,
	 * and leads to /account/delete, which has the last button on it.
	 */
	deleteAccount: saveAction('deleteAccount', Nothing, async (_, event) => {
		const answer = await callAuth(event, '/delete-user', { callbackURL: '/' });
		if (!answer.ok) turnDown(answer);

		return { action: 'deleteAccount' as const };
	})
};
