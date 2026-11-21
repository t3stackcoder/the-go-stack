import { fail, type Cookies } from '@sveltejs/kit';
import {
	parseNewItem,
	refusePacking,
	type PackingForm,
	type Via
} from '#lib/demo/forms/packing.js';
import { lists } from '#lib/demo/forms/server/store.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

// A page with form actions answers each request itself, so it cannot be prerendered.
export const prerender = false;

const COOKIE = 'packing-list';

/**
 * Each visitor's list is found by an anonymous, random id in a cookie, so nobody sees anyone else's.
 * SvelteKit's cookie defaults are already the safe ones (HttpOnly, SameSite=Lax, and Secure except
 * on http://localhost), so the only option set here narrows the path from `/` to this page.
 */
function listFor(cookies: Cookies) {
	let visitor = cookies.get(COOKIE);
	if (!visitor || !/^[0-9a-f-]{36}$/.test(visitor)) {
		visitor = crypto.randomUUID();
		cookies.set(COOKIE, visitor, { path: '/forms' });
	}
	return lists.get(visitor);
}

/** Stands in for a real database write, slow enough that you can watch the form wait for it. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 600));

/** What every action starts with: the visitor's list, the submitted fields, and how they arrived. */
async function receive({ request, cookies }: RequestEvent) {
	const list = listFor(cookies);
	const form = await request.formData();
	await pause();

	// `use:enhance` marks the requests it sends with this header. A plain HTML form post has no way
	// to, which is how the log can tell the two apart.
	const via: Via = request.headers.get('x-sveltekit-action') === 'true' ? 'enhanced' : 'plain';

	return { list, form, via };
}

export const load: PageServerLoad = ({ cookies }) => listFor(cookies).snapshot();

export const actions = {
	add: async (event) => {
		const { list, form, via } = await receive(event);

		const item = parseNewItem(form, list.items);
		if (!item.ok) {
			list.record({ action: 'add', via, outcome: 'invalid', subject: item.values.text });
			// The status, the messages and everything the visitor typed go back to the same page.
			return fail(400, { values: item.values, errors: item.errors } satisfies PackingForm);
		}

		list.add(item.text, item.quantity);
		list.record({ action: 'add', via, outcome: 'saved', subject: item.text });
	},

	toggle: async (event) => {
		const { list, form, via } = await receive(event);

		const id = Number(form.get('id'));
		// The form asks for a state rather than a flip, so posting it twice does no harm.
		const packed = form.get('packed') === 'true';
		const item = list.find(id);
		if (!item) {
			return fail(404, {
				refused: { id, message: 'That item is no longer on the list.' }
			} satisfies PackingForm);
		}

		const action = packed ? 'pack' : 'unpack';
		const refusal = packed ? refusePacking(item) : undefined;
		if (refusal) {
			list.record({ action, via, outcome: 'refused', subject: item.text });
			return fail(422, { refused: { id, message: refusal } } satisfies PackingForm);
		}

		item.packed = packed;
		list.record({ action, via, outcome: 'saved', subject: item.text });
	},

	delete: async (event) => {
		const { list, form, via } = await receive(event);

		const item = list.find(Number(form.get('id')));
		// Already gone counts as done: removing something twice is not an error.
		if (!item) return;

		list.remove(item.id);
		list.record({ action: 'remove', via, outcome: 'saved', subject: item.text });
	}
} satisfies Actions;
