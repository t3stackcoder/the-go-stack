/**
 * A small, deterministic product catalog used by the rendering demos.
 *
 * It is generated from a fixed seed, so the server and the browser produce the same items without
 * sharing any state. That lets the same data be rendered on the server, in the browser, or both,
 * which is the point of the demos.
 */
export interface Product {
	id: number;
	name: string;
	category: string;
	price: number;
	/** OKLCH hue for the product's swatch, 0 to 359. */
	hue: number;
}

const ADJECTIVES = ['Quiet', 'Brisk', 'Amber', 'Lunar', 'Hollow', 'Vivid', 'Northern', 'Plain'];
const NOUNS = ['Kettle', 'Lamp', 'Satchel', 'Notebook', 'Stool', 'Planter', 'Carafe', 'Blanket'];
const CATEGORIES = ['Kitchen', 'Lighting', 'Carry', 'Desk', 'Living'];

/** mulberry32: a tiny seeded generator. Deterministic output matters here; quality does not. */
function seeded(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function createCatalog(count = 12): Product[] {
	const random = seeded(2026);
	const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];

	return Array.from({ length: count }, (_, index) => ({
		id: index + 1,
		name: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
		category: pick(CATEGORIES),
		price: 12 + Math.floor(random() * 180),
		hue: Math.floor(random() * 360)
	}));
}
