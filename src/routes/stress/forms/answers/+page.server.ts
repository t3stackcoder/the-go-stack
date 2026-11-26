// Question: when an action answers a form in each of the ways an action can, what does the
// visitor see, is what they typed still there, and is a failure recorded? `?as=` chooses the
// answer, and each is worth asking with JavaScript, without it, and before the page has hydrated:
//
//   (nothing)  the form is saved
//   invalid    the server turns down one field
//   refused    the server turns down the whole form
//   forbidden  an expected error, raised with `error()`
//   throw      a fault in the action's own code
//   redirect   the action sends the visitor on
//   never      the action never answers
//
// The form is built on src/lib/forms/save-form.svelte.ts and its action on `saveAction`, so
// every answer but the redirect should end on the form with the text still in it. Two more
// answers come from outside the action, and can only be asked for by hand: stop the server and
// send the form, or send it from another origin (see server.js).
import { error, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { refuse, saveAction } from '#lib/forms/server/save-action.js';
import type { PageServerLoad } from './$types';

const ANSWERS = ['invalid', 'refused', 'forbidden', 'throw', 'redirect', 'never'] as const;

const answerFor = (url: URL) => ANSWERS.find((answer) => answer === url.searchParams.get('as'));

/**
 * `?limit=`, in milliseconds: how long the form waits for an answer before it gives up. Left
 * out, the form waits as long as any other, which makes `?as=never` an eight-second check.
 */
const limitFor = (url: URL) => {
	const limit = Number(url.searchParams.get('limit'));
	return limit >= 100 && limit <= 60_000 ? limit : undefined;
};

export const load: PageServerLoad = ({ url }) => ({
	as: answerFor(url),
	limit: limitFor(url),
	arrived: url.searchParams.has('arrived')
});

const Note = z.object({
	title: z.string().trim().min(1, 'A title is needed.').max(40, 'Keep the title to 40 characters.'),
	note: z.string().max(200, 'Keep the note to 200 characters.')
});

export const actions = {
	send: saveAction('send', Note, async (_note, { url }) => {
		const as = answerFor(url);

		if (as === 'invalid') refuse({ title: 'stress: the server turned this field down.' });
		if (as === 'refused') error(409, 'stress: the server turned the form down.');
		if (as === 'forbidden') error(403, 'stress: an expected error, written for the visitor.');
		if (as === 'throw') {
			throw new Error('stress: thrown in an action. No visitor should ever read this sentence.');
		}
		if (as === 'redirect') redirect(303, `${url.pathname}?arrived`);
		if (as === 'never') await new Promise(() => {});

		return { message: 'Saved.' };
	})
};
