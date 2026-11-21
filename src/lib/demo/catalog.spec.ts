import { describe, expect, it } from 'vitest';
import { createCatalog } from './catalog.js';

describe('createCatalog', () => {
	// The rendering demos build the catalog separately on the server and in the browser. If the two
	// could differ, the client-rendered and server-rendered pages would not show the same thing.
	it('produces the same catalog every time it is called', () => {
		expect(createCatalog()).toEqual(createCatalog());
	});

	it('produces the requested number of products with unique ids', () => {
		const catalog = createCatalog(30);

		expect(catalog).toHaveLength(30);
		expect(new Set(catalog.map((product) => product.id)).size).toBe(30);
	});

	it('keeps every hue in the range CSS expects', () => {
		for (const product of createCatalog(100)) {
			expect(product.hue).toBeGreaterThanOrEqual(0);
			expect(product.hue).toBeLessThan(360);
		}
	});
});
