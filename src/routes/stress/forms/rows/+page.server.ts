// Question: what does a form of hundreds of fields cost to send, to hydrate and to type into, when
// the browser holds every value? And is every row saved, and every row kept through a refusal,
// with JavaScript and without?
//
//   /stress/forms/rows?n=500    five hundred rows of three fields each
//
// The rows are posted as repeated field names, never as JSON: JSON needs JavaScript to be sent
// at all. Measured on a form that posted its rows as JSON: without JavaScript nothing arrived,
// and the server answered "Saved 0 rows."
import * as z from 'zod';
import { saveAction } from '#lib/forms/server/save-action.js';
import type { PageServerLoad } from './$types';

const MAX = 2000;

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

// A list for each column. A message for the fourth price is filed under `price.3`.
const Rows = z.object({
	name: z.array(z.string().trim().min(1, 'A name is needed.')).max(MAX),
	price: z
		.array(
			z
				.string()
				.trim()
				.regex(/^\d+(\.\d+)?$/, 'The price must be a number.')
		)
		.max(MAX),
	stock: z.array(z.string().trim().regex(/^\d+$/, 'The stock must be a whole number.')).max(MAX)
});

export const actions = {
	// Everything typed goes back after a refusal, so a page with no JavaScript can show it again:
	// every row, and each value up to the length a field of this table can reasonably hold.
	save: saveAction('save', Rows, ({ name }) => ({ message: `Saved ${name.length} rows.` }), {
		text: 60,
		list: MAX
	})
};
