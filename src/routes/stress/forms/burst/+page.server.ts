// Question: when a form is sent again before the first answer is back, what reaches the server,
// what does the server end up holding, and what is the page left showing?
//
// The action is slower the lower the number it is given, so three quick submissions of 1, 2 and 3
// sent together would be answered in the opposite order: 3 first, 1 last. A form that has just
// saved 3 could find the server holding 1. The form's helper allows two rules, and neither lets
// that happen:
//
//   /stress/forms/burst                a send before the answer is ignored: 1 is saved
//   /stress/forms/burst?again=replace  the newest send takes the place of those before it. 1 is
//                                      let finish, 2 is never sent, and 3 goes when 1 is
//                                      answered: 3 is saved, and is the last thing written
//
// A request is abandoned only when the form gives up on it at its time limit.
// Abandoning one in the browser does not stop the action that is answering it. The action below
// finds out with `stopIfAbandoned`, just before it writes, and leaves what is held alone.
//
// What is held is shared by everyone using this page, and starts again when the form is reset.
import { redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { saveAction, stopIfAbandoned } from '#lib/forms/server/save-action.js';
import type { Actions, PageServerLoad } from './$types';

/** What a real app would keep in its database: the value of the last submission to finish. */
let held = 0;
/** Each submission that reached the action, in the order it arrived. */
let arrivals: { value: number; finished: boolean; abandoned: boolean }[] = [];

const MAX_ARRIVALS = 20;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ruleFor = (url: URL) =>
	url.searchParams.get('again') === 'replace' ? ('replace' as const) : ('ignore' as const);

export const load: PageServerLoad = ({ url }) => ({ again: ruleFor(url), held, arrivals });

const Value = z.object({
	value: z.coerce.number('A number is needed.').int().min(1, '1 to 9.').max(9, '1 to 9.')
});

export const actions = {
	save: saveAction('save', Value, async ({ value }, event) => {
		const arrival = { value, finished: false, abandoned: false };
		arrivals = [...arrivals, arrival].slice(-MAX_ARRIVALS);

		await wait(900 - 250 * Math.min(value, 3));
		arrival.finished = true;

		// The browser has stopped waiting for this answer: the form gave up on it. Written now,
		// it would land after the visitor was told that no answer came, and perhaps on top of
		// what they sent next.
		try {
			stopIfAbandoned(event);
		} catch (stopped) {
			arrival.abandoned = true;
			throw stopped;
		}

		held = value;

		return { saved: value };
	}),

	reset: ({ url }) => {
		held = 0;
		arrivals = [];

		// Back to the page itself, in the mode it was in. Left at `?/reset`, a reload would offer to
		// send the reset again.
		redirect(303, `${url.pathname}?${new URLSearchParams({ again: ruleFor(url) })}`);
	}
} satisfies Actions;
