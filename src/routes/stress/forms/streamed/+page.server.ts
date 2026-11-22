// Question: when a form is submitted on a page that also streams a value, what happens to the
// streamed box: while the action runs, and once its answer is in?
//
// The streamed value takes 800 ms and says which load it came from. The action only adds one to a
// count, which has nothing to do with it. The link under the box goes to the same page at another
// address, where the value is no longer a fresh copy of the one on show.
//
// Both numbers are shared by everyone using this page, and start again when the server does.
import type { Actions, PageServerLoad } from './$types';

let count = 0;
let loads = 0;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const load: PageServerLoad = ({ url }) => {
	const loaded = ++loads;

	return {
		count,
		elsewhere: url.searchParams.has('elsewhere'),
		slow: wait(800).then(() => `Took 800 ms. Load ${loaded}.`)
	};
};

export const actions = {
	add: async () => {
		await wait(200);
		count += 1;
	}
} satisfies Actions;
