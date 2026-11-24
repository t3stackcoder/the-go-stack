/**
 * Accounts: the Better Auth instance, and every decision about how it is set up.
 *
 * Nothing outside this directory talks to it directly but two things. A form's action reaches it
 * through `callAuth` (./call.ts), which goes in by its HTTP handler so that its rate limiter and
 * its origin check run. And a page that needs to know who is signed in asks `locals.session()`,
 * set up in src/hooks.server.ts. The browser loads no auth library at all: every form is a plain
 * POST to an action, which is what lets all of this work before the page has hydrated, and
 * without JavaScript.
 *
 * What is switched on is the core: email and password with a verified address, the three
 * providers with account linking, a change of address or password, a list of sessions, and
 * deleting the account. Two-factor, passkeys, magic links, organisations and administration are
 * not: they are plugins to add when they are wanted.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { PROVIDERS } from '#lib/auth/providers.js';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { CLIENT_ADDRESS_HEADER } from './address.js';
import {
	alreadyRegistered,
	confirmDeletion,
	confirmEmailChange,
	resetPassword,
	verifyEmail
} from './emails.js';
import { mockProviders, socialProviders } from './providers.js';

/**
 * The site's own address, for a link in an email: the one the request that asked for the email
 * was sent to. Every email here is asked for by a request that came in through the handler.
 */
function siteOf(request: Request | undefined): string {
	if (!request) {
		throw new Error(
			'An account email was asked for outside a request, so it has no site to link to.'
		);
	}
	return new URL(request.url).origin;
}

export const auth = betterAuth({
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg', schema }),

	// No `baseURL`, on purpose. Without one Better Auth takes the site's address from each
	// request, which is the address SvelteKit worked out: ORIGIN in production (the Node adapter
	// pins every request's URL to it), and whatever port the developer's server is on otherwise.
	// One setting, read in one place, and `pnpm dev`, `pnpm preview` and `pnpm start` all work
	// where they stand. BETTER_AUTH_URL must not be set either: Better Auth reads it from the
	// environment by itself, and it would then disagree with SvelteKit.
	//
	// Better Auth warns about this once, as it starts ("Base URL is not set"). The warning is for
	// a server that cannot trust the address a request arrived at. This one can, for the reason
	// above, so it is expected.

	emailAndPassword: {
		enabled: true,
		// An address is not somebody's until they have opened a link sent to it. Until then the
		// password does not sign in, and a sign-up says the same thing whether or not the address
		// already had an account.
		requireEmailVerification: true,
		// A new password is chosen by someone who may have lost the old one to somebody else.
		revokeSessionsOnPasswordReset: true,
		sendResetPassword: async ({ user, url }) => resetPassword(user.email, url),
		onExistingUserSignUp: async ({ user }, request) =>
			alreadyRegistered(user.email, `${siteOf(request)}/sign-in`)
	},

	emailVerification: {
		sendOnSignUp: true,
		// Signing in with the right password and an unverified address sends the link again,
		// which is the visitor's way out of having lost the first one.
		sendOnSignIn: true,
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user, url }) => verifyEmail(user.email, url)
	},

	user: {
		changeEmail: {
			enabled: true,
			// The address an account has now is asked first, and the new one after it. A session
			// left open on a shared machine cannot move the account to somebody else's address.
			sendChangeEmailConfirmation: async ({ user, newEmail, url }) =>
				confirmEmailChange(user.email, newEmail, url)
		},
		deleteUser: {
			enabled: true,
			// The link leads to a page of this site, with one last button on it, and not to Better
			// Auth's own address for it, which deletes on a GET and answers a browser that is not
			// signed in with a line of JSON.
			sendDeleteAccountVerification: async ({ user, token }, request) =>
				confirmDeletion(
					user.email,
					`${siteOf(request)}/account/delete?token=${encodeURIComponent(token)}`
				)
		}
	},

	account: {
		accountLinking: {
			enabled: true,
			// Signing in with one of these, at an address that already has an account here, is
			// taken to be the same person: all three verify the addresses they report. Better
			// Auth still refuses while the account's own address is unverified, so an account
			// somebody else created in a person's name is not handed to them, password and all.
			// And a provider is linked by hand, from the account page, only at the account's own
			// address (`allowDifferentEmails` stays off): a stolen session cannot add a way in.
			trustedProviders: PROVIDERS.map((provider) => provider.id)
		}
	},

	session: {
		// Better Auth asks for a session less than a day old before it will list sessions or
		// unlink a provider, and there is nothing here yet to ask a visitor to sign in again
		// with. Left on, the account page would fail for anyone who signed in yesterday. What is
		// destructive is confirmed another way: the current password, or a link sent by email.
		freshAge: 0
		// No cookie cache: a session that has been revoked must stop working at once, and a
		// copy of it kept in a cookie would go on being believed until it expired.
	},

	socialProviders,

	// On in development too, so that it can be seen working, and kept in the database, so that
	// it holds across restarts and across more than one server. It runs for requests that come
	// in through the HTTP handler, which is why actions go in that way (./call.ts).
	rateLimit: { enabled: true, storage: 'database' },

	advanced: {
		// The visitor's address, for the rate limiter and for the list of sessions. It is read
		// from a header only this server's own code sets (./address.ts), and from no other.
		ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
		// Marked Secure a request at a time, by the protocol it came by: see ./cookies.ts.
		useSecureCookies: false
	},

	// The addresses of Better Auth's that are switched off, because nothing here asks them
	// over HTTP and each would hand a browser something it should not have. (The pages ask the
	// same things with `auth.api`, on the server, which these do not affect.)
	//
	// The first five answer with tokens: the session's own, every session's, or a provider's.
	// A session's token is kept in a cookie that script cannot read, so that a script which
	// should not be on the page cannot carry it off; an address that gives it to any script
	// that asks would undo that. The last deletes the account on a GET, by a link: the email
	// leads to a page of this site instead, with a button on it (see `deleteUser` above).
	disabledPaths: [
		'/get-session',
		'/list-sessions',
		'/get-access-token',
		'/refresh-token',
		'/account-info',
		'/delete-user/callback'
	],

	// Where a provider's answer that cannot be matched to a sign-in is sent. The ones that can
	// go back to the page the sign-in was started from, which says so itself.
	onAPIError: { errorURL: '/sign-in' },

	plugins: [...mockProviders]
});

export type Session = typeof auth.$Infer.Session;

/** The name of the session cookie, which the marker follows (./cookies.ts). */
export const sessionCookieName = async () => (await auth.$context).authCookies.sessionToken.name;
