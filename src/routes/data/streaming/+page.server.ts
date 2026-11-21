import { error } from '@sveltejs/kit';
import { createCatalog } from '#lib/demo/catalog.js';

// Streaming happens in a live response, so this page is rendered per request.
export const prerender = false;

/** Stands in for a slow service: a timer, then the value. */
function slow<T>(ms: number, value: () => T): Promise<T> {
	return new Promise((resolve) => setTimeout(resolve, ms)).then(value);
}

export function load() {
	const products = createCatalog();
	const prices = products.map((product) => product.price);
	const categories = new Set(products.map((product) => product.category)).size;

	// Fails on purpose. Until the page renders, nothing is listening for this rejection, and by
	// default Node exits on an unhandled one. This marks it handled; the page still gets the error.
	const rating = slow(2000, () => error(503, 'Reviews service timed out.'));
	rating.catch(() => {});

	return {
		// Not a promise: part of the first chunk of HTML.
		catalog: { value: `${products.length}`, label: `products in ${categories} categories` },

		// Promises, not awaited. Each is streamed into the same response when it settles.
		stock: slow(400, () => ({ value: '184', label: 'units in stock' })),
		prices: slow(900, () => ({
			value: `$${Math.min(...prices)}–${Math.max(...prices)}`,
			label: 'price range'
		})),
		delivery: slow(1600, () => ({ value: '2–3 days', label: 'delivery estimate' })),
		rating
	};
}
