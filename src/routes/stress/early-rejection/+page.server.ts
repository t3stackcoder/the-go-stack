// Question: what happens to the server when a streamed promise rejects before the page has
// started rendering, and the load function did not attach a `catch` to it?
//
// The promise below rejects after 20 ms. The load function is still busy for another 100 ms, so
// nothing is listening to the promise when it fails.
import type { PageServerLoad } from './$types';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const load: PageServerLoad = async () => {
	const late = wait(20).then(() => {
		throw new Error('stress: a streamed promise rejected before rendering started');
	});

	await wait(100);

	return { late };
};
