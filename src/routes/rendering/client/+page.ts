import type { Product } from '#lib/demo/catalog.js';
import type { PageLoad } from './$types';

// Client-rendered only: the server sends an empty shell and the browser does everything.
export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/catalog');
	if (!response.ok) throw new Error(`Catalog request failed with status ${response.status}`);
	return { products: (await response.json()) as Product[] };
};
