// Question: does a form keep what a visitor entered before the page had hydrated, in a field of
// every kind? And does all of it reach the server as the right kind of value, and come back after
// a refusal, with JavaScript and without?
//
//   /stress/forms/early-input             the server takes what it is sent, and says what that was
//   /stress/forms/early-input?as=refused  the server turns the form down, and every field must
//                                         come back holding what was entered
//
// To ask the first part, hold the page's scripts back, change every field, then let them run.
// Each field starts from a value the server rendered, so one that hydration set back is plain to
// see.
import { error } from '@sveltejs/kit';
import * as z from 'zod';
import { saveAction } from '#lib/forms/server/save-action.js';
import type { PageServerLoad } from './$types';

/** What a real app would have read from its database: where every field starts. */
const HELD = {
	text: 'server',
	count: '3',
	notes: 'server',
	agree: false,
	size: 'medium',
	extras: ['card'],
	colour: 'green',
	days: ['tue']
};

export const load: PageServerLoad = ({ url }) => ({
	held: HELD,
	refuses: url.searchParams.get('as') === 'refused'
});

// One field of every kind. A boolean is a checkbox, and a list is every field of that name.
const Order = z.object({
	text: z.string().max(40, 'Keep it to 40 characters.'),
	count: z.coerce.number('A number is needed.').int('A whole number.').min(0).max(99),
	notes: z.string().max(200, 'Keep it to 200 characters.'),
	agree: z.boolean(),
	size: z.enum(['small', 'medium', 'large']),
	extras: z.array(z.enum(['wrap', 'card', 'rush'])),
	colour: z.enum(['red', 'green', 'blue']),
	days: z.array(z.enum(['mon', 'tue', 'wed']))
});

export const actions = {
	save: saveAction('save', Order, (order, { url }) => {
		if (url.searchParams.get('as') === 'refused') {
			error(409, 'stress: the server turned the form down.');
		}

		// Sent back as the action was given it, to show what kind of value each field became.
		return { message: 'Saved.', saved: order };
	})
};
