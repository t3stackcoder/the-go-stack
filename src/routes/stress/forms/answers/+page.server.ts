// Question: when an action answers a plain enhanced form in each of the ways an action can, what
// does the visitor see, is what they typed still there, and is a failure recorded? `?as=` chooses
// the answer, and each is worth asking with JavaScript and without:
//
//   (nothing)  the form is saved
//   invalid    the server turns down one field
//   refused    the server turns down the whole form
//   forbidden  an expected error, raised with `error()`
//   throw      a fault in the action's own code
//   redirect   the action sends the visitor on
//   never      the action never answers
//
// Its twin, /stress/superforms/answers, asks the same of a form built with Superforms.
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const ANSWERS = ['invalid', 'refused', 'forbidden', 'throw', 'redirect', 'never'] as const;

const answerFor = (url: URL) => ANSWERS.find((answer) => answer === url.searchParams.get('as'));

/** A field as text, clipped, so an oversized post is not sent straight back into the page. */
const text = (value: FormDataEntryValue | null, limit: number) =>
	(typeof value === 'string' ? value : '').slice(0, limit);

export const load: PageServerLoad = ({ url }) => ({
	as: answerFor(url),
	arrived: url.searchParams.has('arrived')
});

export const actions = {
	send: async ({ request, url }) => {
		const fields = await request.formData();
		const values = { title: text(fields.get('title'), 40), note: text(fields.get('note'), 200) };

		if (values.title.trim() === '') {
			return fail(400, { values, errors: { title: 'A title is needed.' } });
		}

		const as = answerFor(url);
		if (as === 'invalid') {
			return fail(400, { values, errors: { title: 'stress: the server turned this field down.' } });
		}
		if (as === 'refused') {
			return fail(409, { values, message: 'stress: the server turned the form down.' });
		}
		if (as === 'forbidden') error(403, 'stress: an expected error, written for the visitor.');
		if (as === 'throw') {
			throw new Error('stress: thrown in an action. No visitor should ever read this sentence.');
		}
		if (as === 'redirect') redirect(303, `${url.pathname}?arrived`);
		if (as === 'never') await new Promise(() => {});

		return { message: 'Saved.' };
	}
} satisfies Actions;
