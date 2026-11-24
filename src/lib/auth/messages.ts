/**
 * Every sentence the account pages can say, in one place, so that each can be held to the room
 * the page has reserved for it.
 *
 * A message never moves the page: the line it appears in is there before it, at a fixed height.
 * That only works if the sentence fits the line on the narrowest window the site supports,
 * 320px. A field's message has one line under the field, and the form's has two. The limits
 * below are those lines counted in characters, and src/lib/auth/messages.test.ts holds every
 * sentence here to them. Write a new one and it is checked. A count of characters is only a
 * stand-in for a width, so the widths were measured too, and the figures are beside the limits.
 *
 * Better Auth answers a refusal with a code, such as `INVALID_EMAIL_OR_PASSWORD`, and words of
 * its own, which are written for developers and are not shown. A provider's refusal comes back
 * as a code in the address (`?error=account_not_linked`), which anybody can write, so that is
 * only ever looked up here and never shown as it came. A code with no sentence of its own gets
 * the general one. The test fails for a code Better Auth has that this file has not decided
 * about, so an upgrade that adds one is noticed.
 */

/**
 * The most characters in a message under a field: one line of small text. At a 320px window the
 * line is 272px wide, and 257px in a browser that keeps room for a scrollbar. Measured in
 * Chromium, Firefox and WebKit, with Inter and with the fallback font, the widest sentence here
 * takes 227px, and none is cut short.
 */
export const FIELD_MAX = 34;

/**
 * The most characters in a message about the form as a whole: two such lines. The form helper's
 * own sentences (src/lib/forms/save-form.svelte.ts) run to 68 and share the space. Measured the
 * same way, every sentence a form here can say fits its two lines, at 257px as at 272px.
 */
export const FORM_MAX = 68;

/** What is said under a field. The schemas of the actions use these, and so do the codes below. */
export const FIELD = {
	name: 'Enter your name.',
	nameLong: 'Keep it to 60 characters or fewer.',
	email: 'That is not an email address.',
	emailMissing: 'Enter your email address.',
	emailLong: 'That address is too long.',
	emailSame: 'That is your address already.',
	password: 'Enter your password.',
	passwordShort: 'Use at least 8 characters.',
	passwordLong: 'Use 128 characters or fewer.',
	passwordWrong: 'That is not your current password.'
} as const;

/**
 * What each kind of field says when the browser turns it down before the form is sent, in the
 * tooltip of src/lib/forms/Field.svelte. They are the sentences the server says for the same
 * faults (src/lib/server/auth/fields.ts), so the visitor is told one thing whoever catches it.
 * A new password left empty is too short, there as here.
 */
export const FAULTS = {
	name: { missing: FIELD.name },
	email: { missing: FIELD.emailMissing, mismatch: FIELD.email },
	password: { missing: FIELD.password },
	newPassword: { missing: FIELD.passwordShort, short: FIELD.passwordShort }
} as const;

/** The limits the sentences above speak of, for the schemas that enforce them. */
export const LIMITS = { name: 60, email: 254, passwordMin: 8, passwordMax: 128 } as const;

/** Said for a code that has no sentence of its own. */
export const GENERIC = 'That did not work. Try again in a moment.';

/** Better Auth's codes that are about one field, each with what is said under it. */
export const FIELD_CODES: Readonly<Record<string, string>> = {
	INVALID_EMAIL: FIELD.email,
	PASSWORD_TOO_SHORT: FIELD.passwordShort,
	PASSWORD_TOO_LONG: FIELD.passwordLong,
	INVALID_PASSWORD: FIELD.passwordWrong
};

/** Better Auth's codes that are about the form as a whole, and a provider's, which are lower case. */
export const FORM_CODES: Readonly<Record<string, string>> = {
	INVALID_EMAIL_OR_PASSWORD: 'That email and password do not match an account.',
	EMAIL_NOT_VERIFIED: 'Not verified yet. We sent the link again: check your inbox.',
	EMAIL_ALREADY_VERIFIED: 'That address is already verified. Sign in.',
	INVALID_TOKEN: 'That link is not valid any more. Ask for a new one.',
	TOKEN_EXPIRED: 'That link has expired. Ask for a new one.',
	USER_NOT_FOUND: 'That account no longer exists.',
	USER_ALREADY_EXISTS: 'That address already has an account.',
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'That address already has an account.',
	UNAUTHORIZED: 'You are signed out. Sign in and try again.',
	SESSION_EXPIRED: 'You are signed out. Sign in and try again.',
	FAILED_TO_GET_SESSION: 'You are signed out. Sign in and try again.',
	SESSION_NOT_FRESH: 'Sign out and in again, then try this once more.',
	FAILED_TO_UNLINK_LAST_ACCOUNT: 'That is your only way in. Add another before removing it.',
	ACCOUNT_NOT_FOUND: 'That is no longer connected to your account.',
	CREDENTIAL_ACCOUNT_NOT_FOUND: 'This account has no password. Ask for a link to set one.',
	SOCIAL_ACCOUNT_ALREADY_LINKED: 'That is already connected to your account.',
	LINKED_ACCOUNT_ALREADY_EXISTS: 'That is already connected to your account.',
	PROVIDER_NOT_FOUND: 'That way of signing in is not switched on here.',
	FAILED_TO_GET_USER_INFO: 'The provider did not say who you are. Try again.',
	USER_EMAIL_NOT_FOUND: 'The provider did not share an email address with us.',

	// From a provider's answer, in the address the visitor comes back to.
	access_denied: 'Signing in was cancelled.',
	account_not_linked: 'That address has an unverified account. Verify it first.',
	email_does_not_match: 'That account has a different email address from yours.',
	account_already_linked_to_different_user: 'That is already connected to another account.',
	unable_to_link_account: 'That could not be connected. Try again.',
	email_not_found: 'The provider did not share an email address with us.',
	email_not_verified: 'The provider says that address is not verified.',
	oauth_provider_not_found: 'That way of signing in is not switched on here.',
	unable_to_get_user_info: 'The provider did not say who you are. Try again.'
};

/**
 * The codes that are answered with the general sentence, on purpose. Each is one of three
 * things: a fault of this site's and not the visitor's (and Better Auth has logged it), a
 * refusal no form here can provoke, or a feature that is switched off. None has anything a
 * visitor could act on beyond trying again.
 */
export const GENERIC_CODES: ReadonlySet<string> = new Set([
	'FAILED_TO_CREATE_USER',
	'FAILED_TO_CREATE_SESSION',
	'FAILED_TO_UPDATE_USER',
	'FAILED_TO_CREATE_VERIFICATION',
	'INVALID_USER',
	'ID_TOKEN_NOT_SUPPORTED',
	'EMAIL_CAN_NOT_BE_UPDATED',
	'CHANGE_EMAIL_DISABLED',
	'USER_ALREADY_HAS_PASSWORD',
	'PASSWORD_ALREADY_SET',
	'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
	'VERIFICATION_EMAIL_NOT_ENABLED',
	'EMAIL_MISMATCH',
	'INVALID_ORIGIN',
	'INVALID_CALLBACK_URL',
	'INVALID_REDIRECT_URL',
	'INVALID_ERROR_CALLBACK_URL',
	'INVALID_NEW_USER_CALLBACK_URL',
	'MISSING_OR_NULL_ORIGIN',
	'CALLBACK_URL_REQUIRED',
	'FIELD_NOT_ALLOWED',
	'ASYNC_VALIDATION_NOT_SUPPORTED',
	'VALIDATION_ERROR',
	'MISSING_FIELD',
	'METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED',
	'BODY_MUST_BE_AN_OBJECT',
	'INVALID_OAUTH_CONFIGURATION',
	'TOKEN_URL_NOT_FOUND',

	// A provider's answer that could not be matched to a sign-in, or that broke on the way.
	'no_code',
	'invalid_code',
	'no_callback_url',
	'issuer_missing',
	'issuer_mismatch',
	'nonce_binding_missing',
	'state_not_found',
	'state_mismatch',
	'state_invalid',
	'state_generation_error',
	'invalid_callback_request',
	'internal_server_error',
	'signup_disabled',
	'unable_to_create_user',
	'unable_to_create_session',
	'unable_to_update_account'
]);

/** What is said when the rate limiter has turned a request away, with how long it asked for. */
export function tooMany(seconds: number | undefined): string {
	if (seconds === undefined) return 'Too many tries. Wait a little and try again.';
	return `Too many tries. Wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} and try again.`;
}

/**
 * The sentence for a code, whatever sent it. Looked up among this file's own keys only, so a
 * code somebody wrote into an address can at most choose between sentences written here.
 */
export function sentenceFor(code: string | null | undefined): string {
	if (!code) return GENERIC;
	if (Object.hasOwn(FIELD_CODES, code)) return FIELD_CODES[code];
	if (Object.hasOwn(FORM_CODES, code)) return FORM_CODES[code];
	return GENERIC;
}

/**
 * What a refusal is called on a form that does something other than save, for the form helper's
 * `refusal`: it is what is said when fields were turned down and the server had no sentence for
 * the form as a whole, and is then followed by "See what is marked."
 */
export const REFUSAL = {
	signIn: 'Not signed in.',
	signUp: 'No account was created.',
	sent: 'Not sent.',
	changed: 'Not changed.'
} as const;

/** What a form says about itself once it has been taken, where that is more than nothing. */
export const SAID = {
	sentAgain: 'Sent again. Give it a minute to arrive.',
	resetAsked: 'If that address has an account, a link is on its way to it.',

	// The account page (src/routes/account/).
	nameSaved: 'Saved. This is the name your team sees.',
	// Better Auth sends nothing when the new address already has an account, and answers the
	// same as when it does, so that this form cannot be used to find out who has one. What
	// was done depends on which it was, and this says so without saying which.
	emailAsked: 'If no account has that address, a link went to your current one.',
	emailHalfway: 'Confirmed. Now open the link we sent to the new address.',
	emailChanged: 'Done. Your address is changed.',
	passwordLinkSent: 'A link was sent to your address. Open it to set a password.',
	disconnected: 'Disconnected. It no longer signs you in.',
	sessionEnded: 'That session is signed out.',
	othersEnded: 'Every other session is signed out.',
	sessionsNewer: 'Something signed in since this page loaded. Reload to see it.',
	thisSession: 'That is this browser. Use Sign out to end it.',
	deleteAsked: 'A link was sent to your address. Open it to delete the account.'
} as const;

/**
 * What a page says on arrival, when the address asks it to: the end of something that was done
 * on another page, or by a link in an email. Each is named in the address as `?notice=name`.
 */
export const NOTICES: Readonly<Record<string, string>> = {
	'password-changed': 'Your password is changed. Sign in with the new one.',
	deleted: 'Your account has been deleted.',
	connected: 'Connected. You can now sign in that way too.',
	// The account page sends itself here after a new password: see its `changePassword`.
	'password-updated': 'Changed. Every other session is signed out.'
};

/** The notice an address asks for, if it is one of the above. */
export function noticeFor(name: string | null | undefined): string | undefined {
	return name && Object.hasOwn(NOTICES, name) ? NOTICES[name] : undefined;
}
