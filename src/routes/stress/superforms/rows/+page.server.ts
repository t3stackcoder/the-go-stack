// Question: what does a form of hundreds of fields cost to send, to hydrate and to type into, when
// a Superforms store holds every value? Its twin, /stress/forms/rows, is the same table with the
// values left to the browser.
//
//   /stress/superforms/rows?n=500    five hundred rows of three fields each
//
// The rows are nested data, which Superforms posts as JSON (`dataType: 'json'` in the page). That
// needs JavaScript. Without it, or sent before the page has hydrated, the form posts no fields at
// all, and the schema's own default stands in for them. Measured: the action answered "Saved 0
// rows." and the table came back empty. An action that replaces what it is sent would have
// emptied the real thing.
import { fail, message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const MAX = 2000;

const schema = z.object({
	rows: z
		.array(
			z.object({
				name: z.string().trim().min(1, 'A name is needed.').max(60),
				price: z.number('The price must be a number.').min(0, 'The price must be a number.'),
				stock: z
					.int('The stock must be a whole number.')
					.min(0, 'The stock must be a whole number.')
			})
		)
		.max(MAX)
});

export const load: PageServerLoad = async ({ url }) => {
	const count = Math.min(MAX, Math.max(0, Number(url.searchParams.get('n') ?? 100) || 0));

	const rows = Array.from({ length: count }, (_, index) => {
		const id = index + 1;
		return { name: `Item ${id}`, price: 12 + ((id * 7919) % 180), stock: (id * 37) % 23 };
	});

	return { form: await superValidate({ rows }, zod4(schema)) };
};

export const actions = {
	save: async ({ request }) => {
		const form = await superValidate(request, zod4(schema));

		if (!form.valid) {
			const refused = Object.keys(form.errors.rows ?? {}).length;
			return fail(400, {
				form: { ...form, message: `${refused} of ${form.data.rows.length} rows refused.` }
			});
		}

		return message(form, `Saved ${form.data.rows.length} rows.`);
	}
} satisfies Actions;
