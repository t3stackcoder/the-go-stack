// Question: does a GET form with one field of every kind stay in step with the address: through
// quick edits against a slow load, a link, Back, and input given before the page had hydrated?
//
// The two pages that mirror their fields in the address (the search box, and the Verdict page's
// radios) use src/lib/forms/address-form.ts with one kind of field each. This one has a text box,
// a group of checkboxes, radios, a select and a lone checkbox.
//
//   /stress/forms/address            every load answers at once
//   /stress/forms/address?slow=300   every load takes 300 ms, so edits overtake their answers
import type { PageServerLoad } from './$types';

const MAX_SLOW = 2000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const oneOf = <const T extends string>(options: readonly T[], value: string | null): T =>
	options.find((option) => option === value) ?? options[0];

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams;
	const slow = Math.min(MAX_SLOW, Math.max(0, Number(query.get('slow')) || 0));

	if (slow) await wait(slow);

	return {
		slow,
		q: (query.get('q') ?? '').slice(0, 40),
		tags: (['a', 'b', 'c'] as const).filter((tag) => query.getAll('tag').includes(tag)),
		sort: oneOf(['new', 'old', 'best'], query.get('sort')),
		per: oneOf(['10', '25', '50'], query.get('per')),
		only: query.has('only')
	};
};
