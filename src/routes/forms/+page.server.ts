import { error } from '@sveltejs/kit';
import * as z from 'zod';
import { parseNewItem, refusePacking, type Via } from '#lib/demo/forms/packing.js';
import { lists } from '#lib/demo/forms/server/store.js';
import { refuse, saveAction, stopIfAbandoned } from '#lib/forms/server/save-action.js';
import type { PageServerLoad, RequestEvent } from './$types';

const COOKIE = 'packing-list';

/**
 * Each visitor's list is found by an anonymous, random id in a cookie, so nobody sees anyone else's.
 * SvelteKit's cookie defaults are the safe ones (HttpOnly, SameSite=Lax, Secure). Two are changed
 * here. The path narrows from `/` to this page. And Secure follows the protocol the page was asked
 * for: SvelteKit leaves it off only at http://localhost, and WebKit will not keep a Secure cookie
 * that arrives over plain HTTP, so at http://127.0.0.1 every request found a new, empty list.
 */
function listFor({ cookies, url }: Pick<RequestEvent, 'cookies' | 'url'>) {
	let visitor = cookies.get(COOKIE);
	if (!visitor || !/^[0-9a-f-]{36}$/.test(visitor)) {
		visitor = crypto.randomUUID();
		cookies.set(COOKIE, visitor, { path: '/forms', secure: url.protocol === 'https:' });
	}
	return lists.get(visitor);
}

/** Stands in for a real database, slow enough that you can watch the form wait for it. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 600));

/** What every action starts with: the visitor's list, and how the form arrived. */
async function open(event: RequestEvent) {
	const { request } = event;
	const list = listFor(event);
	await pause();

	// A form sent in place by script is marked with this header. A plain HTML form post has no
	// way to add one, which is how the log can tell the two apart.
	const via: Via = request.headers.get('x-sveltekit-action') === 'true' ? 'enhanced' : 'plain';

	return { list, via };
}

export const load: PageServerLoad = (event) => listFor(event).snapshot();

// What each form posts. `saveAction` reads the fields against these, and hands the action typed
// values or sends the form back.
const NewItem = z.object({ text: z.string(), quantity: z.string() });
// The form asks for a state rather than a flip, so posting it twice does no harm.
const Tick = z.object({ id: z.coerce.number(), packed: z.enum(['true', 'false']) });
const Removal = z.object({ id: z.coerce.number() });

export const actions = {
	add: saveAction('add', NewItem, async (typed, event) => {
		const { list, via } = await open(event);

		// The list's own rules, which no schema can know: they depend on what is already there.
		const item = parseNewItem(typed, list.items);
		if (!item.ok) {
			list.record({ action: 'add', via, outcome: 'invalid', subject: typed.text });
			// The messages and everything the visitor typed go back to the same page.
			refuse(item.errors);
		}

		// The last moment to find out that nobody is waiting for the answer any more.
		stopIfAbandoned(event);
		list.add(item.text, item.quantity);
		list.record({ action: 'add', via, outcome: 'saved', subject: item.text });
	}),

	toggle: saveAction('toggle', Tick, async ({ id, packed }, event) => {
		const { list, via } = await open(event);

		const item = list.find(id);
		if (!item) error(404, 'That item is no longer on the list.');

		const action = packed === 'true' ? 'pack' : 'unpack';
		const refusal = action === 'pack' ? refusePacking(item) : undefined;
		if (refusal) {
			list.record({ action, via, outcome: 'refused', subject: item.text });
			error(422, refusal);
		}

		// A tick can be pressed again before the first press is answered. The browser abandons
		// the earlier request, and this keeps it from landing on top of the later one.
		stopIfAbandoned(event);
		item.packed = action === 'pack';
		list.record({ action, via, outcome: 'saved', subject: item.text });
	}),

	delete: saveAction('delete', Removal, async ({ id }, event) => {
		const { list, via } = await open(event);

		const item = list.find(id);
		// Already gone counts as done: removing something twice is not an error.
		if (!item) return;

		stopIfAbandoned(event);
		list.remove(item.id);
		list.record({ action: 'remove', via, outcome: 'saved', subject: item.text });
	})
};
