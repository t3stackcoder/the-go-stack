import { STATUS_CODES, searchStatusCodes } from '#lib/demo/data/server/status-codes.js';
import type { PageServerLoadEvent } from './$types';

// Reading `url.searchParams` tells SvelteKit this load depends on the query, so it re-runs
// whenever `?q=` changes, and only then.
export function load({ url }: PageServerLoadEvent) {
	const query = url.searchParams.get('q') ?? '';

	return {
		query,
		results: searchStatusCodes(query),
		total: STATUS_CODES.length
	};
}
