// Question: when a plain enhanced form is sent again before the first answer is back, what
// reaches the server, what does the server end up holding, and what is the page left showing?
//
// The action is slower the lower the number it is given, so three quick submissions of 1, 2 and 3
// are answered in the opposite order: 3 first, 1 last. A form that has just saved 3 can find the
// server holding 1.
//
//   /stress/forms/burst              every submission is sent, and every answer applied
//   /stress/forms/burst?multi=abort  a new submission abandons the one before, as the packing
//                                    list on the Forms page does
//
// Abandoning a request in the browser does not stop the action that is answering it. The action
// below finds out from the request's signal, and leaves what is held alone.
//
// What is held is shared by everyone using this page, and starts again when the form is reset.
// Its twin, /stress/superforms/burst, asks the same of a form built with Superforms.
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/** What a real app would keep in its database: the value of the last submission to finish. */
let held = 0;
/** Each submission that reached the action, in the order it arrived. */
let arrivals: { value: number; finished: boolean; abandoned: boolean }[] = [];

const MAX_ARRIVALS = 20;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const load: PageServerLoad = ({ url }) => ({
	multi: url.searchParams.get('multi') === 'abort' ? ('abort' as const) : ('allow' as const),
	held,
	arrivals
});

export const actions = {
	save: async ({ request }) => {
		const fields = await request.formData();
		const value = Math.min(9, Math.max(1, Math.trunc(Number(fields.get('value'))) || 1));

		const arrival = { value, finished: false, abandoned: false };
		arrivals = [...arrivals, arrival].slice(-MAX_ARRIVALS);

		await wait(900 - 250 * Math.min(value, 3));

		arrival.finished = true;

		// The browser has stopped waiting for this answer, because a newer submission took its
		// place, and the server is told so through the request's signal. Applied now, an older value
		// would be written over a newer one. Measured before this check: the page said "saved 3"
		// and the server held 1.
		if (request.signal.aborted) {
			arrival.abandoned = true;
			return { saved: 0 };
		}

		held = value;

		return { saved: value };
	},

	reset: ({ url }) => {
		held = 0;
		arrivals = [];

		// Back to the page itself, in the mode it was in. Left at `?/reset`, a reload would offer to
		// send the reset again.
		redirect(
			303,
			`${url.pathname}?${new URLSearchParams({ multi: url.searchParams.get('multi') ?? '' })}`
		);
	}
} satisfies Actions;
