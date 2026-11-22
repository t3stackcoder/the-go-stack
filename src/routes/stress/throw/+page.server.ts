// Question: when a component throws, what does the visitor see, does the rest of the page
// survive, and is the error recorded? `?when=` chooses the moment:
//
//   server    while the page is rendered on the server
//   hydrate   while the browser hydrates the server's HTML
//   update    while the page re-renders after a click
//   effect    in an effect, just after the page has hydrated
//   handler   in the click handler itself
//   streamed  while rendering a streamed value that arrived after the page
import { streaming } from '#lib/server/streaming.js';
import type { PageServerLoad } from './$types';

const MOMENTS = ['server', 'hydrate', 'update', 'effect', 'handler', 'streamed'] as const;
export type Moment = (typeof MOMENTS)[number];

export const load: PageServerLoad = (event) => {
	const when = MOMENTS.find((moment) => moment === event.url.searchParams.get('when'));

	return streaming(event, 5000, {
		when,
		late: new Promise<string>((resolve) => setTimeout(() => resolve('late value'), 300))
	});
};
