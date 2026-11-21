import { decide, readAnswers } from '#lib/demo/verdict/decide.js';
import type { PageServerLoad } from './$types';

// The answer depends on the query string, so it is worked out per request.
export const prerender = false;

export const load: PageServerLoad = ({ url }) => {
	const answers = readAnswers(url.searchParams);
	return { answers, verdict: decide(answers) };
};
