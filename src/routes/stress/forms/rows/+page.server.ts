// Question: what does a form of hundreds of fields cost to send, to hydrate and to type into, when
// the browser holds every value? Its twin, /stress/superforms/rows, is the same table with every
// value held in a Superforms store.
//
//   /stress/forms/rows?n=500    five hundred rows of three fields each
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const MAX = 2000;
/** Echoed values are clipped, so an oversized post is not sent straight back into the page. */
const ECHO_LIMIT = 60;

export const load: PageServerLoad = ({ url }) => {
	const count = Math.min(MAX, Math.max(0, Number(url.searchParams.get('n') ?? 100) || 0));

	return {
		rows: Array.from({ length: count }, (_, index) => {
			const id = index + 1;
			return {
				name: `Item ${id}`,
				price: String(12 + ((id * 7919) % 180)),
				stock: String((id * 37) % 23)
			};
		})
	};
};

const texts = (fields: FormData, name: string) =>
	fields
		.getAll(name)
		.slice(0, MAX)
		.map((value) => (typeof value === 'string' ? value : '').slice(0, ECHO_LIMIT));

const isAmount = (text: string) => /^\d+(\.\d+)?$/.test(text.trim());
const isCount = (text: string) => /^\d+$/.test(text.trim());

export const actions = {
	save: async ({ request }) => {
		const fields = await request.formData();
		const names = texts(fields, 'name');
		const prices = texts(fields, 'price');
		const stocks = texts(fields, 'stock');

		const rows = names.map((name, index) => ({
			name,
			price: prices[index] ?? '',
			stock: stocks[index] ?? ''
		}));

		// One message a row, under the row's position, and only for the rows that have one.
		const errors: Record<number, string> = {};
		rows.forEach((row, index) => {
			if (row.name.trim() === '') errors[index] = 'A name is needed.';
			else if (!isAmount(row.price)) errors[index] = 'The price must be a number.';
			else if (!isCount(row.stock)) errors[index] = 'The stock must be a whole number.';
		});

		const refused = Object.keys(errors).length;
		if (refused) {
			// Everything typed goes back, so a page with no JavaScript can show it again.
			return fail(400, { rows, errors, message: `${refused} of ${rows.length} rows refused.` });
		}

		return { message: `Saved ${rows.length} rows.` };
	}
} satisfies Actions;
