import { createCatalog } from '#lib/demo/catalog.js';

// Rendered on the server for each request, rather than once at build time.
export const prerender = false;

// Server-rendered only: this page ships no JavaScript at all.
export const csr = false;

export function load() {
	return { products: createCatalog() };
}
