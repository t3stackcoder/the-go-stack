import { decide, readAnswers } from '#lib/demo/verdict/decide.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const answers = readAnswers(url.searchParams);
	return { answers, verdict: decide(answers) };
};
