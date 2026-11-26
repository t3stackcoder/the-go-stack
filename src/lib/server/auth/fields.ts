/**
 * The fields the account forms share, as the schemas `saveAction` reads them against. Each
 * carries the sentence that is shown under the field when it is turned down, from
 * src/lib/auth/messages.ts, where they are held to the length of the line they are shown in.
 *
 * Better Auth checks most of this again and is the authority. Checking here first means the
 * visitor is answered in this site's words, under the field in question, and without a request
 * to the rate limiter spent on a password that was always going to be too short.
 */
import * as z from 'zod';
import { FIELD, LIMITS } from '#lib/auth/messages.js';

/**
 * An email address. Trimmed first: a phone's keyboard leaves a space after an address it
 * completes, and an address with a space on the end is otherwise not one.
 */
export const Email = z
	.string()
	.trim()
	.min(1, FIELD.emailMissing)
	.max(LIMITS.email, FIELD.emailLong)
	.pipe(z.email(FIELD.email));

/** A person's name, as they would like to be called. */
export const Name = z.string().trim().min(1, FIELD.name).max(LIMITS.name, FIELD.nameLong);

/** A password being chosen. Not trimmed: a space is a character like any other in one. */
export const NewPassword = z
	.string()
	.min(LIMITS.passwordMin, FIELD.passwordShort)
	.max(LIMITS.passwordMax, FIELD.passwordLong);

/**
 * A password being given, to sign in or to prove who is asking. It is not held to the rules for
 * a new one, which it may predate: only to being there, and to the length Better Auth will read.
 */
export const Password = z
	.string()
	.min(1, FIELD.password)
	.max(LIMITS.passwordMax, FIELD.passwordLong);
