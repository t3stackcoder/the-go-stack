import { error } from '@sveltejs/kit';
import { createCatalog } from '#lib/demo/catalog.js';
import { streaming } from '#lib/server/streaming.js';
import type { PageServerLoad } from './$types';

/** Stands in for a slow service: a timer, then the value. */
function slow<T>(ms: number, value: () => T): Promise<T> {
	return new Promise((resolve) => setTimeout(resolve, ms)).then(value);
}

export const load: PageServerLoad = (event) => {
	const products = createCatalog();
	const prices = products.map((product) => product.price);
	const categories = new Set(products.map((product) => product.category)).size;

	// Any one of the promises below is given five seconds, and then its panel says it failed.
	return streaming(event, 5000, {
		// Not a promise: part of the first chunk of HTML.
		catalog: { value: `${products.length}`, label: `products in ${categories} categories` },

		// Promises, not awaited. Each is streamed into the same response when it settles.
		stock: slow(400, () => ({ value: '184', label: 'units in stock' })),
		prices: slow(900, () => ({
			value: `$${Math.min(...prices)}–${Math.max(...prices)}`,
			label: 'price range'
		})),
		delivery: slow(1600, () => ({ value: '2–3 days', label: 'delivery estimate' })),

		// Fails on purpose. It costs the page one panel, which says why.
		rating: slow(2000, () => error(503, 'Reviews service timed out.'))
	});
};
