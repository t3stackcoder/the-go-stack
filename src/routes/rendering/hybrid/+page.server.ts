import { createCatalog } from '#lib/demo/catalog.js';
import { streaming } from '#lib/server/streaming.js';
import type { PageServerLoad } from './$types';

// Rendered on the server for each request, then hydrated in the browser. That is the default,
// so there is no setting here to make it so.

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stands in for a slow dependency: an inventory service that takes a while to answer. */
async function loadStock(ids: number[]): Promise<Record<number, number>> {
	await wait(600);
	return Object.fromEntries(ids.map((id) => [id, (id * 37) % 23]));
}

export const load: PageServerLoad = (event) => {
	const products = createCatalog();

	return streaming(event, 5000, {
		products,
		// Not awaited: the page is sent now, and this is streamed into the same response later.
		stock: loadStock(products.map((product) => product.id))
	});
};
