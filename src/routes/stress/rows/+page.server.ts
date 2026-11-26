// Question: what does a page of thousands of server-rendered rows cost to send and to hydrate,
// and does it matter whether the numbers in it reach the template as numbers or as text?
//
//   /stress/rows?n=5000&kind=numbers
//   /stress/rows?n=5000&kind=strings
import type { PageServerLoad } from './$types';

const MAX = 20_000;

export const load: PageServerLoad = ({ url }) => {
	const count = Math.min(MAX, Math.max(0, Number(url.searchParams.get('n') ?? 1000) || 0));
	const asText = url.searchParams.get('kind') === 'strings';

	const rows = Array.from({ length: count }, (_, index) => {
		const id = index + 1;
		const price = 12 + ((id * 7919) % 180);
		const stock = (id * 37) % 23;
		return {
			id,
			name: `Item ${id}`,
			price: asText ? String(price) : price,
			stock: asText ? String(stock) : stock
		};
	});

	return { kind: asText ? 'strings' : 'numbers', rows };
};
