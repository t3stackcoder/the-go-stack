// Question: what does a response do with many streamed values that settle in no particular order,
// and with one that never settles?
//
//   /stress/streams?n=40        forty values, settling at scattered times up to 1.5 s
//   /stress/streams?n=4&hang=1  four values, and a fifth that never settles
import type { PageServerLoad } from './$types';

const MAX = 200;

export const load: PageServerLoad = ({ url }) => {
	const count = Math.min(MAX, Math.max(0, Number(url.searchParams.get('n') ?? 40) || 0));

	const values = Array.from({ length: count }, (_, index) => {
		// Scattered but repeatable, so two runs can be compared.
		const delay = 50 + ((index * 337) % 1450);
		return new Promise<{ index: number; delay: number }>((resolve) =>
			setTimeout(() => resolve({ index, delay }), delay)
		);
	});

	return {
		values,
		// Stands in for a dependency that has stopped answering.
		hung: url.searchParams.has('hang') ? new Promise<never>(() => {}) : undefined
	};
};
