// Two promises src/lib/auth/messages.ts makes that nothing on a page would show to be broken
// until a visitor met the case: that every refusal Better Auth can give has been decided about,
// and that every sentence fits the line reserved for it.

import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { describe, expect, it } from 'vitest';
import {
	FIELD,
	FIELD_CODES,
	FIELD_MAX,
	FORM_CODES,
	FORM_MAX,
	GENERIC,
	GENERIC_CODES,
	NOTICES,
	noticeFor,
	REFUSAL,
	SAID,
	sentenceFor,
	tooMany
} from './messages.js';

/**
 * Every code the installed Better Auth can answer with, read from an instance set up as the
 * site's is where codes are concerned: the core's, and the generic OAuth plugin's. It is never
 * asked anything, so it needs no database.
 */
const apiCodes = Object.keys(
	betterAuth({
		secret: crypto.randomUUID() + crypto.randomUUID(),
		baseURL: 'http://localhost',
		plugins: [genericOAuth({ config: [] })]
	}).$ERROR_CODES
);

/**
 * The codes a provider's answer can come back with, in the address. Better Auth does not export
 * these, so they are copied from its source (1.7.27: `oauth2/errors.mjs`, `state.mjs`, and what
 * `oauth2/link-account.mjs` returns, written as the callback writes it, with underscores). Read
 * those three again when Better Auth is upgraded.
 */
const callbackCodes = [
	'no_code',
	'oauth_provider_not_found',
	'issuer_missing',
	'issuer_mismatch',
	'invalid_code',
	'nonce_binding_missing',
	'unable_to_get_user_info',
	'no_callback_url',
	'unable_to_link_account',
	'email_does_not_match',
	'account_already_linked_to_different_user',
	'email_not_found',
	'email_not_verified',
	'state_not_found',
	'state_mismatch',
	'state_invalid',
	'state_generation_error',
	'invalid_callback_request',
	'internal_server_error',
	'account_not_linked',
	'signup_disabled',
	'unable_to_create_user',
	'unable_to_create_session',
	'unable_to_update_account'
];

describe('the codes Better Auth can answer with', () => {
	it('are found', () => {
		expect(apiCodes.length).toBeGreaterThan(40);
	});

	it.each([...apiCodes, ...callbackCodes])('%s has been decided about', (code) => {
		const said = Object.hasOwn(FIELD_CODES, code) || Object.hasOwn(FORM_CODES, code);
		expect(
			said || GENERIC_CODES.has(code),
			`Give ${code} a sentence in src/lib/auth/messages.ts, or list it among the codes that are answered with the general one.`
		).toBe(true);
	});

	it('are each decided one way', () => {
		const both = [...Object.keys(FIELD_CODES), ...Object.keys(FORM_CODES)].filter((code) =>
			GENERIC_CODES.has(code)
		);
		expect(both).toEqual([]);
	});

	it('get the general sentence when they are not known, whoever wrote them', () => {
		expect(sentenceFor('NOT_A_CODE')).toBe(GENERIC);
		expect(sentenceFor(undefined)).toBe(GENERIC);
		expect(sentenceFor('')).toBe(GENERIC);
		// A name every object has is not one of this file's keys.
		expect(sentenceFor('constructor')).toBe(GENERIC);
		expect(sentenceFor('__proto__')).toBe(GENERIC);
	});
});

describe('the room each sentence has', () => {
	const underAField = [...Object.values(FIELD), ...Object.values(FIELD_CODES)];
	const aboutTheForm = [
		GENERIC,
		...Object.values(FORM_CODES),
		...Object.values(NOTICES),
		...Object.values(SAID),
		// As the form helper says them, with what follows when fields were turned down.
		...Object.values(REFUSAL).map((refusal) => `${refusal} See what is marked.`),
		tooMany(undefined),
		tooMany(1),
		// The longest the limiter's longest window, a minute, can make it.
		tooMany(60)
	];

	it.each(underAField)(`fits the line under a field: %s`, (sentence) => {
		expect(sentence.length).toBeLessThanOrEqual(FIELD_MAX);
	});

	it.each(aboutTheForm)(`fits the two lines about the form: %s`, (sentence) => {
		expect(sentence.length).toBeLessThanOrEqual(FORM_MAX);
	});

	it('is used by a sentence that ends', () => {
		for (const sentence of [...underAField, ...aboutTheForm]) expect(sentence).toMatch(/[.]$/);
	});
});

describe('what a page says on arrival', () => {
	it('is one of the notices, or nothing', () => {
		expect(noticeFor('deleted')).toBe(NOTICES.deleted);
		expect(noticeFor('constructor')).toBeUndefined();
		expect(noticeFor('<script>')).toBeUndefined();
		expect(noticeFor(null)).toBeUndefined();
	});

	it('counts seconds as they are said', () => {
		expect(tooMany(1)).toContain('1 second ');
		expect(tooMany(9)).toContain('9 seconds ');
	});
});
