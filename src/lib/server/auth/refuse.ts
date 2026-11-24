import { error } from '@sveltejs/kit';
import { FIELD_CODES, sentenceFor, tooMany } from '#lib/auth/messages.js';
import { refuse } from '#lib/forms/server/save-action.js';
import type { AuthAnswer } from './call.js';

/**
 * Ends an action that Better Auth has turned down, as the form's refusal: call it inside
 * `saveAction`, with what `callAuth` answered. It does not return.
 *
 * Better Auth says what was wrong with a code. The sentence for it comes from
 * src/lib/auth/messages.ts, never from Better Auth's own words, which are written for
 * developers. A refusal by the rate limiter says how long to wait.
 *
 * Some codes are about one field, and only the action knows what its form calls that field:
 * `INVALID_PASSWORD` is the `currentPassword` of one form and the `password` of another. So the
 * action says, as `{ INVALID_PASSWORD: 'currentPassword' }`, and the sentence is put under that
 * field. A code it does not place is said about the form as a whole.
 */
export function turnDown(answer: AuthAnswer, fields: Record<string, string> = {}): never {
	if (answer.status === 429) error(429, tooMany(answer.retryAfter));

	const { code } = answer;
	if (code !== undefined && Object.hasOwn(fields, code) && Object.hasOwn(FIELD_CODES, code)) {
		refuse({ [fields[code]]: FIELD_CODES[code] });
	}

	// An answer that was not a refusal and still cannot be used is a fault somewhere, and is
	// said as one.
	const refused = answer.status >= 400 && answer.status <= 599;
	error(refused ? answer.status : 502, sentenceFor(code));
}
