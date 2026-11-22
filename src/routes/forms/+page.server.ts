import { error } from '@sveltejs/kit';
import * as z from 'zod';
import {
	type Entry,
	moodOf,
	type Outcome,
	parseParty,
	refuseWithout,
	type Via
} from '#lib/demo/forms/boat.js';
import { boats } from '#lib/demo/forms/server/store.js';
import { refuse, saveAction, stopIfAbandoned } from '#lib/forms/server/save-action.js';
import type { PageServerLoad, RequestEvent } from './$types';

const COOKIE = 'boat';

/**
 * Each visitor's boat is found by an anonymous, random id in a cookie, so nobody sees anyone else's.
 * SvelteKit's cookie defaults are the safe ones (HttpOnly, SameSite=Lax, Secure). Two are changed
 * here. The path narrows from `/` to this page. And Secure follows the protocol the page was asked
 * for: SvelteKit leaves it off only at http://localhost, and WebKit will not keep a Secure cookie
 * that arrives over plain HTTP, so at http://127.0.0.1 every request found a new boat.
 */
function boatFor({ cookies, url }: Pick<RequestEvent, 'cookies' | 'url'>) {
	let visitor = cookies.get(COOKIE);
	if (!visitor || !/^[0-9a-f-]{36}$/.test(visitor)) {
		visitor = crypto.randomUUID();
		cookies.set(COOKIE, visitor, { path: '/forms', secure: url.protocol === 'https:' });
	}
	return boats.get(visitor);
}

/** Stands in for a real database: long enough to watch the form wait for it. */
const PROMPT = 400;
/** Past the half second after which the form says the server is slow. */
const SLOW = 2500;
/**
 * The longest a request is kept waiting on purpose. It is past the eight seconds a form waits
 * before it gives up, and it is an end: nothing here can be held open for good.
 */
const HELD = 12_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when nobody is waiting for the request any more, or after `ms` at the most. */
const untilLeft = (signal: AbortSignal, ms: number) =>
	new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});

export const load: PageServerLoad = async (event) => {
	const boat = boatFor(event);

	// Only a request for the page's data alone is kept waiting: the reload a form asks for once
	// it has its answer. A page load never is, so a visitor can always get back to the list.
	const withheld = boat.withholds && event.isDataRequest;
	boat.withholds = false;
	if (withheld) await untilLeft(event.request.signal, HELD);

	return { mood: moodOf(event.url), ...boat.snapshot() };
};

/**
 * What every action starts with: the visitor's boat, a way to write down what becomes of the
 * request, and the server in the mood the address asks for.
 */
async function reach(
	event: RequestEvent,
	action: Entry['action'],
	subject: (boat: ReturnType<typeof boatFor>) => string
) {
	const boat = boatFor(event);
	const mood = moodOf(event.url);

	// A form sent in place by script is marked with this header. A plain HTML form post has no
	// way to add one, which is how the ledger can tell the two apart.
	const via: Via =
		event.request.headers.get('x-sveltekit-action') === 'true' ? 'enhanced' : 'plain';
	const about = subject(boat);
	const note = (outcome: Outcome) => boat.record({ action, subject: about, via, outcome });

	if (mood === 'broken') {
		note('broke');
		// A real fault, thrown the way a bug would throw it. Its words are for the server's log:
		// `saveAction` records them there, and sends the visitor a fixed sentence and a reference.
		throw new Error('The forms demo was asked to break, and did.');
	}

	await (mood === 'silent'
		? untilLeft(event.request.signal, HELD)
		: pause(mood === 'slow' ? SLOW : PROMPT));

	return { boat, mood, note };
}

/**
 * How every action ends that gets as far as saving: with one last look at whether anyone is still
 * waiting for the answer, and then the change.
 *
 * A form gives up on a server that says nothing, and a visitor without JavaScript can press
 * twice. Either way the browser abandons the request, and this keeps what was abandoned from
 * landing on top of what was sent after it.
 */
function write(
	{ boat, mood, note }: Awaited<ReturnType<typeof reach>>,
	event: RequestEvent,
	change: () => void
) {
	try {
		stopIfAbandoned(event);
	} catch (stopped) {
		note('abandoned');
		throw stopped;
	}

	change();
	note('saved');
	boat.withholds = mood === 'withholding';
}

// What each form posts. `saveAction` reads the fields against these, and hands the action typed
// values or sends the form back.
const NewParty = z.object({ name: z.string(), seats: z.string() });
// The form asks for a state and not a flip, so posting it twice does no harm.
const Boarding = z.object({ id: z.coerce.number(), aboard: z.enum(['true', 'false']) });
const Leaving = z.object({ id: z.coerce.number() });

export const actions = {
	add: saveAction('add', NewParty, async (typed, event) => {
		const visit = await reach(event, 'add', () => typed.name);

		// The boat's own rules, which no schema can know: they depend on who is already listed.
		const party = parseParty(typed, visit.boat.parties);
		if (!party.ok) {
			visit.note('turned-down');
			// The messages and everything the visitor typed go back to the same page.
			refuse(party.errors);
		}

		write(visit, event, () => visit.boat.add(party.name, party.seats));
	}),

	aboard: saveAction('aboard', Boarding, async ({ id, aboard }, event) => {
		const action = aboard === 'true' ? 'aboard' : 'ashore';
		const visit = await reach(event, action, (boat) => boat.find(id)?.name ?? '');

		const party = visit.boat.find(id);
		if (!party) error(404, 'That party is no longer on the list.');

		const refusal = action === 'ashore' ? refuseWithout(party) : undefined;
		if (refusal) {
			visit.note('turned-down');
			error(422, refusal);
		}

		write(visit, event, () => (party.aboard = action === 'aboard'));
	}),

	remove: saveAction('remove', Leaving, async ({ id }, event) => {
		const visit = await reach(event, 'remove', (boat) => boat.find(id)?.name ?? '');

		const party = visit.boat.find(id);
		// Already gone counts as done: taking a party off the list twice is not an error.
		if (!party) return;

		const refusal = refuseWithout(party);
		if (refusal) {
			visit.note('turned-down');
			error(422, refusal);
		}

		write(visit, event, () => visit.boat.remove(party.id));
	})
};
