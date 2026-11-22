/**
 * Keeps an action from saving twice for one press.
 *
 * A post can arrive more than once. A browser sends one again by itself when the connection
 * fails before any answer has come, and by then the server may have acted on the first.
 * Measured with a connection dropped after the action had run and before its answer left:
 * Chromium and Firefox sent the post seven times for one press, and the action ran seven times.
 * A visitor does it too, and is right to: told that no answer came back and to send it again,
 * they send again something that may already be saved.
 *
 * So a press is known by more than its arrival:
 *
 * - A form the helper sends carries a key (../send-key.ts). A repeat of the same press, by the
 *   browser, by the helper, or by the visitor sending again what they were told might be lost,
 *   carries the same key, and for ten minutes is given the answer the first one was given.
 * - A form the browser sends by itself, without JavaScript, has no key. It is known by what it
 *   is: who sent it, where to, and every field. A second one the same that arrives while the
 *   first is being acted on, or within a second of it, is the same press. A person cannot load
 *   the page that answers a form and press again inside a second. A browser's own resend is
 *   there in a few milliseconds.
 *
 * A repeat is answered from memory only if the first one saved. If it was turned down, or given
 * up on, the repeat is acted on in its own right: it may be the one somebody is waiting for.
 *
 * The memory is this process's own, which is its limit. A repeat that reaches another server,
 * or this one after a restart, is not known for one, and an action still has to be safe against
 * that where it matters: by writing a state and not a change, or by a key of its own in
 * whatever keeps the data.
 */
import { createHash } from 'node:crypto';
import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { SEND_KEY } from '../send-key.js';

/** How a save ended: with what it returned, or by sending the visitor on. */
type Outcome = { returned: unknown } | { redirected: unknown };

const KEYED_FOR = 10 * 60_000;
const UNKEYED_FOR = 1000;
/** The most saves remembered. Each is what an action returned, which is small. */
const MOST = 2000;

/** The presses being acted on, each with a promise that settles when it is over. */
const running = new Map<string, Promise<void>>();
/** The presses that saved, oldest first, each until it is forgotten. */
const saved = new Map<string, { until: number; outcome: Outcome }>();

/**
 * Runs `save` for this request, unless it is a repeat of a press that has already saved, which
 * is given that one's answer. `save` is the action's own work: it returns when it has saved, and
 * throws to turn the form down.
 */
export async function saveOnce<Saved>(
	event: RequestEvent,
	fields: FormData,
	save: () => Saved | Promise<Saved>
): Promise<Saved> {
	const given = fields.get(SEND_KEY);
	const key = typeof given === 'string' && given !== '' ? given : undefined;
	const press = identify(event, fields, key);

	// A repeat that arrives while the first is being acted on waits for it. Asked again each
	// time round, because another repeat may have got in ahead.
	for (let earlier = running.get(press); earlier; earlier = running.get(press)) await earlier;

	const before = saved.get(press);
	if (before && before.until > Date.now()) {
		if ('redirected' in before.outcome) throw before.outcome.redirected;
		return before.outcome.returned as Saved;
	}

	let over!: () => void;
	running.set(press, new Promise<void>((resolve) => (over = resolve)));

	const remember = (outcome: Outcome) => {
		saved.set(press, { until: Date.now() + (key ? KEYED_FOR : UNKEYED_FOR), outcome });
		// Oldest first, so the ones past their time are at the front, with any there is no room for.
		for (const [old, { until }] of saved) {
			if (saved.size <= MOST && until > Date.now()) break;
			saved.delete(old);
		}
	};

	try {
		const returned = await save();
		remember({ returned });
		return returned;
	} catch (thrown) {
		// A save that ends by sending the visitor on is a save, and its repeat is sent on too.
		if (isRedirect(thrown)) remember({ redirected: thrown });
		throw thrown;
	} finally {
		running.delete(press);
		over();
	}
}

/**
 * What makes two requests one press: where they were sent and whose they are, and then the key
 * they carry, or failing that everything they hold.
 */
function identify(event: RequestEvent, fields: FormData, key: string | undefined): string {
	const press = createHash('sha256');
	const add = (...parts: string[]) => press.update(`${parts.join('\0')}\0`);

	add(event.url.pathname, event.url.search, event.request.headers.get('cookie') ?? '');

	if (key !== undefined) {
		add('key', key);
	} else {
		add('post', sender(event), event.request.headers.get('user-agent') ?? '');
		for (const [name, value] of fields) {
			// A file is told by its facts: reading it through would cost more than it is worth.
			add(name, typeof value === 'string' ? value : `${value.name} ${value.size} ${value.type}`);
		}
	}

	return press.digest('base64');
}

/** The address a request came from, where the server can tell. */
function sender(event: RequestEvent): string {
	try {
		return event.getClientAddress();
	} catch {
		// Not every way of running the server knows. The rest of what identifies a press still does.
		return '';
	}
}
