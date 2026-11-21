import { createCatalog } from '#lib/demo/catalog.js';

// Rendered on the server for each request, then hydrated in the browser. This is the default.
export const prerender = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stands in for a slow dependency: an inventory service that takes a while to answer. */
async function loadStock(ids: number[]): Promise<Record<number, number>> {
	await wait(600);
	return Object.fromEntries(ids.map((id) => [id, (id * 37) % 23]));
}

export function load() {
	const products = createCatalog();

	return {
		products,
		// Not awaited: the page is sent now, and this is streamed into the same response later.
		stock: loadStock(products.map((product) => product.id))
	};
}
