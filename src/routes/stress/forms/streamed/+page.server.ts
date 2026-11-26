// Question: when a form is submitted on a page that also streams a value, what happens to the
// streamed box: while the action runs, and once its answer is in?
//
// The streamed value takes 800 ms and says which load it came from. The action only adds one to a
// count, which has nothing to do with it. The link under the box goes to the same page at another
// address, where the value is no longer a fresh copy of the one on show.
//
// Without JavaScript the form's answer is a page of its own, and the server waits for the value
// before sending it: the count and the value arrive together.
//
// Both numbers are shared by everyone using this page, and start again when the server does.
import * as z from 'zod';
import { saveAction, stopIfAbandoned } from '#lib/forms/server/save-action.js';
import { streaming } from '#lib/server/streaming.js';
import type { PageServerLoad } from './$types';

let count = 0;
let loads = 0;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const load: PageServerLoad = (event) => {
	const loaded = ++loads;

	return streaming(event, 5000, {
		count,
		elsewhere: event.url.searchParams.has('elsewhere'),
		slow: wait(800).then(() => `Took 800 ms. Load ${loaded}.`)
	});
};

export const actions = {
	// A form with a button and no fields.
	add: saveAction('add', z.object({}), async (_nothing, event) => {
		await wait(200);
		stopIfAbandoned(event);
		count += 1;
	})
};
