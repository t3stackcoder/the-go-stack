// Question: when an action answers a Superforms form in each of the ways an action can, what does
// the visitor see, is what they typed still there, and is a failure recorded? `?as=` chooses the
// answer, and each is worth asking with JavaScript and without:
//
//   (nothing)  the form is saved
//   invalid    the server turns down one field
//   refused    the server turns down the whole form
//   forbidden  an expected error, raised with `error()`
//   throw      a fault in the action's own code
//   redirect   the action sends the visitor on
//   never      the action never answers
//
// Its twin, /stress/forms/answers, asks the same of a form with no library around it.
import { error, redirect } from '@sveltejs/kit';
import { fail, message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const ANSWERS = ['invalid', 'refused', 'forbidden', 'throw', 'redirect', 'never'] as const;

const answerFor = (url: URL) => ANSWERS.find((answer) => answer === url.searchParams.get('as'));

const schema = z.object({
	title: z.string().trim().min(1, 'A title is needed.').max(40),
	note: z.string().max(200)
});

export const load: PageServerLoad = async ({ url }) => ({
	as: answerFor(url),
	arrived: url.searchParams.has('arrived'),
	form: await superValidate(zod4(schema))
});

export const actions = {
	send: async ({ request, url }) => {
		const form = await superValidate(request, zod4(schema));
		if (!form.valid) return fail(400, { form });

		const as = answerFor(url);
		if (as === 'invalid') {
			return setError(form, 'title', 'stress: the server turned this field down.');
		}
		if (as === 'refused') {
			return message(form, 'stress: the server turned the form down.', { status: 409 });
		}
		if (as === 'forbidden') error(403, 'stress: an expected error, written for the visitor.');
		if (as === 'throw') {
			throw new Error('stress: thrown in an action. No visitor should ever read this sentence.');
		}
		if (as === 'redirect') redirect(303, `${url.pathname}?arrived`);
		if (as === 'never') await new Promise(() => {});

		return message(form, 'Saved.');
	}
} satisfies Actions;
