import { createCatalog } from '#lib/demo/catalog.js';

// Server-rendered only: this page ships no JavaScript at all.
export const csr = false;

export function load() {
	return { products: createCatalog() };
}
