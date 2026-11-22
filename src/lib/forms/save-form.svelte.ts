/**
 * For a form that saves data: one that POSTs to an action. Call `saveForm` while the component is
 * being set up, and attach what it returns to an ordinary <form>:
 *
 *     const save = saveForm({ answer: () => form });
 *
 *     <form method="POST" action="?/save" {@attach save.attach}>
 *         <input name="title" defaultValue={save.answer?.values?.title ?? data.title} />
 *         <p>{save.answer?.errors?.title ?? ''}</p>
 *         <button aria-disabled={save.busy}>Save</button>
 *         <p role="status">{save.message}</p>
 *     </form>
 *
 * One call can serve a set of like forms, such as the tick beside every row of a list: attach it
 * to each. Each form is then sent and answered on its own, and what is shown (`status`,
 * `answer`, `message`) speaks for the set: whether any of them is on its way, and the latest
 * answer among them, with a refusal kept ahead of the saves around it.
 *
 * The form is plain HTML, and without JavaScript, or before the page has hydrated, it is sent the
 * browser's own way: a full page load, with the action's answer in the page's `form` prop. This
 * only adds to that. Once it is attached the form is sent in place, and the visitor is told what
 * a page load could not have told them: that it is on its way, that it is slow, that no answer
 * came. The server's half is ./server/save-action.ts, and the two are meant to be used together.
 *
 * The fields are left to the browser. Each takes what the server sent as its default
 * (`defaultValue`, `defaultChecked`), and nothing here holds a copy of what is typed: a copy is
 * one more thing to keep in step, and what it costs is the input given before hydration and the
 * speed of typing into a long form. A <textarea> has to be the Textarea component beside this
 * file, and a <select> must not use `bind:value`.
 *
 * What this settles, each of them something that was measured going wrong without it:
 *
 * - Every answer ends on the form, with what was typed still in it. Only a redirect leaves the
 *   page. A bare `use:enhance` replaces the page with the error page when an action fails.
 * - The address stays where it is. By default SvelteKit moves it to the action's address, which
 *   drops the page's own query string.
 * - A second send before the first is answered follows one rule, and an older answer is never
 *   applied over a newer one. Nor is an older write: one form's requests reach the server one
 *   at a time, in the order they were pressed.
 * - An answer never undoes what was typed after the form was sent, and never takes the keyboard
 *   away from a visitor who has moved on. Nor does it take the visitor: a redirect is followed
 *   only while they are still on the page they sent the form from.
 * - A request that is never answered is given up after a time limit, and the form can be sent
 *   again. On the server, `stopIfAbandoned` keeps a request that was given up from writing.
 * - A reload of the page's data that never ends is given up too, and one that fails costs the
 *   visitor neither the form nor the page. The answer goes on the page without the data, the
 *   visitor is told the page is behind, and no later reload waits for it.
 * - After a refusal, focus goes to the first field that was turned down, and `message` has
 *   something to say, so the refusal is heard as well as seen. In a set of forms it is said at
 *   once, and stays said while the others of the set are answered.
 *
 * What it leaves to the page: tying each message to its field (`aria-invalid`,
 * `aria-describedby`), and keeping the lines that show messages in space reserved for them, so
 * that a message arriving moves nothing. The line that shows `message` must have
 * `role="status"`: that is what announces whatever happens to the form.
 *
 * And three things that go wrong beyond the form, each met half way:
 *
 * - A press can reach the server more than once: a browser sends a post again by itself when
 *   the connection fails before any answer has come. Every send carries a key, and the server
 *   saves once for a key (./server/once.ts). That is what makes it safe for this to do the
 *   same, and it does: a send that no answer could be read for is sent once more before the
 *   visitor is told anything. Sent again by the visitor, unchanged, it goes under its old key,
 *   so "send it again" cannot save twice.
 * - What was typed survives leaving the page and coming back, as it does in a browser left to
 *   itself (./typed.ts). So a redirect that leads off the page leaves the fields as they are.
 * - A redirect is followed whoever sent it. Whatever stands in front of the server and turns a
 *   form away, to make the visitor sign in again for one, does better to answer with a status:
 *   a status ends on the form, and a redirect takes the visitor off the page.
 */
import { onDestroy, tick } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { type ActionResult, applyAction, enhance, type SubmitFunction } from '$app/forms';
import { afterNavigate } from '$app/navigation';
import { resolve } from '$app/paths';
import { reloadData, reloads } from './reload.svelte.js';
import { SEND_KEY } from './send-key.js';
import { answered, sentOff } from './wire.js';

/**
 * Where a form is between being sent and being answered:
 *
 * - `idle`        nothing is on its way;
 * - `sending`     sent, and not yet answered;
 * - `slow`        still not answered after half a second, which is when to say so;
 * - `unanswered`  given up at the time limit. It stays so until a form is sent again.
 */
export type SaveStatus = 'idle' | 'sending' | 'slow' | 'unanswered';

export interface SaveFormOptions<Answer> {
	/**
	 * The server's answer to this form, from the page's `form` prop: `() => form`. On a page with
	 * several forms, only the answers that are this form's. A `Refusal` names the action it came
	 * from, so that is `() => (form?.action === 'add' ? form : undefined)`.
	 */
	answer: () => Answer | null | undefined;
	/**
	 * What a second send means while the first is unanswered. `ignore` drops it, which suits a
	 * form that is filled in and sent. `replace` suits a control that can be pressed again and
	 * again: the newest press takes the place of any before it. The one already on its way is
	 * left to finish, what it is answered is not shown, and the newest goes when it has. Such a
	 * control must post the state it wants and not a flip, because a press made in between is
	 * never sent at all.
	 */
	again?: 'ignore' | 'replace';
	/**
	 * What happens to the fields after a save. `reset` empties them for the next entry. `keep`
	 * leaves them as they are, as a form that edits something must.
	 */
	after?: 'reset' | 'keep';
	/**
	 * When the page's data is loaded again. After a save it always is. `always` reloads after a
	 * refusal too, for a page that shows something a refused attempt changes, such as a log of
	 * every attempt.
	 */
	reload?: 'saved' | 'always';
	/** How long to wait for an answer before giving up, in milliseconds. */
	limit?: number;
	/**
	 * Called as a form is sent, with its fields, to show the change at once on the assumption
	 * that the server will agree. It returns a function that takes the change back, which is
	 * called once the answer and the reloaded data are on the page, or the send has failed. The
	 * server's version is then what remains, so a refusal rolls itself back.
	 */
	sending?: (fields: FormData, form: HTMLFormElement) => (() => void) | void;
	/**
	 * Called with the form once a save is on the page and its fields have been reset or kept.
	 * `stayed` says whether the visitor is where they were when the form was sent: their focus
	 * has not moved, and they have typed nothing since. If it is false they have moved on, and
	 * focus must not be pulled back.
	 */
	saved?: (form: HTMLFormElement, stayed: boolean) => void;
}

const SLOW_AFTER = 500;
const DEFAULT_LIMIT = 8000;
/** The least time a reload of the page's data is waited for, however late the answer came. */
const RELOAD_GRACE = 1000;

// Short enough to fit the two lines a page reserves for them.
const SLOW = 'Still sending. The server is slow to answer.';
const UNANSWERED = 'No answer came back. It may not have been saved: send it again.';
const OFFLINE = 'There is no connection. Send it again when there is one.';
const UNREADABLE = 'No answer could be read. It may not have been saved: send it again.';
const REFUSED = 'Not saved.';
const REFUSED_FIELDS = 'Not saved. See what is marked.';
const BEHIND = 'Saved, but this page has not caught up. Reload it to see the change.';

/** The page's address without its fragment: a move within the page is not a move away from it. */
const address = () => location.pathname + location.search;

/** Whether an address a form is redirected to is the page the form is on. */
function leadsHere(to: string): boolean {
	const { origin, pathname } = new URL(to, location.href);
	return origin === location.origin && pathname === location.pathname;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** As many connections as a browser keeps open to one server. */
const CONNECTIONS = 6;

/**
 * Whether the server can be reached, asked in a way that clears the way to it.
 *
 * A browser keeps its connections to a server open to use again, and one can be dead without
 * the browser knowing: the server was restarted, or something between the two let the
 * connection go. A form sent down a dead one gets no answer. Measured in WebKit against a
 * server restarted under an open page: the next form failed in 4 tries of 7. Sent once more by
 * this helper it still failed in 2 of 10, because the second try went down a second dead
 * connection.
 *
 * So before a form is sent again, six small requests are made at once, one for every
 * connection a browser keeps. Each either finds its connection dead, which rids the browser of
 * it, or is answered. They ask for the head of a file SvelteKit publishes with every build,
 * which costs the server nothing. If none is answered there is no server to send the form to,
 * and the visitor is told so without a second try.
 */
async function reachable(): Promise<boolean> {
	const asked = Array.from({ length: CONNECTIONS }, () =>
		fetch(`${resolve('/')}_app/version.json`, { method: 'HEAD', cache: 'no-store' })
	);
	const answers = await Promise.allSettled(asked);
	return answers.some((answer) => answer.status === 'fulfilled' && answer.value.ok);
}

/**
 * A key for one press, that nobody could guess and no two presses share. Not `randomUUID`,
 * which a browser provides only on a secure origin.
 */
function newKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** One send of a form, from the moment it is pressed until its answer has been dealt with. */
interface Sent {
	form: HTMLFormElement;
	controller: AbortController;
	/** The address the form was sent from, to tell whether the visitor has left it since. */
	from: string;
	/** The fields as they were sent, to tell whether anything has been typed since. */
	fields: string;
	/** Where the visitor's focus was as the form left, to tell whether they have moved on. */
	focus: Element | null;
	/** Whether the server has answered. From then on there is nothing left to abandon. */
	answered: boolean;
	/** Whether it has been waiting long enough to say so. */
	lagging: boolean;
	/** Whether it is over, however it ended. */
	done: boolean;
	/** Whether a newer send of the same form has taken its place. Its answer is then not shown. */
	replaced: boolean;
	/** Whether another form of the set ended badly while this was on its way. See `troubled`. */
	passed: boolean;
	/** Settles once the server has done with it: it has answered, or been given up on. */
	landed: Promise<void>;
	land: () => void;
	/** Takes back what `sending` showed. */
	undo: (() => void) | void;
	/** The key it travels under. A repeat of the same press carries the same one. */
	key: string;
	/** The button it was sent by, if any, to send it by again. */
	submitter: HTMLElement | null;
	/** Whether it is the helper's own second try, and not the visitor's press. */
	again: boolean;
	/** While it is held back behind another: keeps it from ever being sent. */
	cancel?: () => void;
	slow?: ReturnType<typeof setTimeout>;
	limit?: ReturnType<typeof setTimeout>;
}

/** What `use:enhance` calls with a form's answer. */
type Answered = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;

export function saveForm<Answer extends object>(options: SaveFormOptions<Answer>) {
	const { again = 'ignore', after = 'reset', reload = 'saved', limit = DEFAULT_LIMIT } = options;

	/** How many sends are waiting for an answer, and how many of those have waited long. */
	let flying = $state(0);
	let lagging = $state(0);
	/** Whether the last send to end was given up at the time limit. */
	let gaveUp = $state(false);
	/** What the browser found out for itself about the last send, when the server said nothing. */
	let problem = $state<string>();
	/**
	 * The server's answer to the last send from this page. Until there is one, the answer is the
	 * one the page arrived with: the form was sent the browser's own way, and the page is the
	 * answer.
	 */
	let latest = $state.raw<{ answer: Answer | undefined; refused: boolean }>();
	/**
	 * The form whose send last ended badly: refused, unanswered, or answered with something
	 * unreadable. In a set of forms its trouble is said at once, whatever else is on its way,
	 * and a save has the last word over it only if it was sent after the trouble was on the
	 * page. `passing` counts the sends still out that were not.
	 *
	 * Measured without this, with one row of a list refused and another ticked within a third
	 * of a second: the refusal was rolled back in silence, because the other row's save was the
	 * last answer, and a save has nothing to say.
	 */
	let troubled = $state.raw<HTMLFormElement>();
	let passing = $state(0);
	/**
	 * Set when an answer goes on the page ahead of the page's data, which was not reloaded in
	 * time: the count of reloads that had landed by then. The page is behind until the next one
	 * lands, and until then it shows what the server held before the save.
	 */
	let behindAt = $state<number>();
	const behind = $derived(behindAt === reloads.landed);
	/** Whether the component is gone: the visitor has moved to another page. */
	let gone = false;

	const status = $derived<SaveStatus>(
		flying > 0 ? (lagging > 0 ? 'slow' : 'sending') : gaveUp ? 'unanswered' : 'idle'
	);
	const answer = $derived(latest ? latest.answer : (options.answer() ?? undefined));
	const refused = $derived(latest ? latest.refused : isRefusal(answer));
	/** What there is to say about the form, and whether it is that something was not saved. */
	const said = $derived.by(() => {
		// While a form is on its way there is nothing to say but that it is slow. The last
		// answer's words are about the last send, and cleared now, the same words coming back
		// are a change, which is what gets them announced. Trouble with another form of the set
		// is the exception: it stays, and it comes first if it arrived while these were out.
		if (flying > 0 && passing === 0) {
			if (lagging > 0) return { words: SLOW, bad: false };
			if (!troubled) return { words: '', bad: false };
		}
		if (problem !== undefined) return { words: problem, bad: true };
		// A refusal always has something to say, whether or not the server sent a sentence.
		if (refused) {
			const fallback = Object.keys(errorsOf(answer)).length ? REFUSED_FIELDS : REFUSED;
			return { words: messageOf(answer) || fallback, bad: true };
		}
		// Said in place of the server's own words for the save: the page beside them does not
		// show it yet, and without this a tick that was saved looks like one that was undone.
		return { words: behind ? BEHIND : messageOf(answer), bad: false };
	});

	// The component outlives a move to another address of the same page, and what it holds is
	// about the address that was left. SvelteKit empties the page's `form` prop then, and this
	// does the same with its own.
	afterNavigate(({ type }) => {
		if (type === 'enter') return;
		latest = undefined;
		problem = undefined;
		gaveUp = false;
		troubled = undefined;
		behindAt = undefined;
	});

	onDestroy(() => {
		gone = true;
	});

	/**
	 * The forms whose last send ended with no answer from the action, each with the fields it
	 * held and the key it went under. Sent again unchanged, it goes under the same key: the
	 * first may have been saved, and the server gives a key it has saved for the same answer.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping: nothing on the page is drawn from it
	const unsettled = new Map<HTMLFormElement, { fields: string; key: string }>();
	/** The forms being sent a second time by this, and not by the visitor. */
	const resending = new WeakSet<HTMLFormElement>();

	/** The send of each form that is on its way, and the one held back behind it, if any. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping: nothing on the page is drawn from it
	const flights = new Map<HTMLFormElement, Sent>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping: nothing on the page is drawn from it
	const held = new Map<HTMLFormElement, Sent>();

	/** Ends a send, once: its timers, its place as its form's send, and what it showed in advance. */
	function finish(sent: Sent) {
		if (sent.done) return;
		sent.done = true;

		clearTimeout(sent.slow);
		clearTimeout(sent.limit);
		answered(sent);
		if (flights.get(sent.form) === sent) flights.delete(sent.form);
		if (held.get(sent.form) === sent) held.delete(sent.form);
		flying -= 1;
		if (sent.lagging) lagging -= 1;
		if (sent.passed) passing -= 1;
		sent.undo?.();
		// A newer send of the same form, held back until this one was over, can go.
		sent.land();
	}

	/**
	 * Records that a send ended badly. The sends of other forms that are still out were made
	 * before anyone could have read of it, so their saves will not speak over it.
	 */
	function trouble(sent: Sent) {
		troubled = sent.form;

		for (const other of [...flights.values(), ...held.values()]) {
			if (other === sent || other.done || other.passed) continue;
			other.passed = true;
			passing += 1;
		}
	}

	/** Says that a send ended with no answer from the action, in the browser's words for it. */
	function unanswered(sent: Sent, words: string) {
		problem = words;
		unsettled.set(sent.form, { fields: sent.fields, key: sent.key });
		trouble(sent);
	}

	/**
	 * Sends a form once more, as it was, when no answer to it could be read and the server can
	 * be reached (see `reachable`). Chromium and Firefox do as much by themselves when a
	 * connection fails under a post. WebKit does not.
	 *
	 * It is safe because the second try goes under the first one's key: if the first was saved
	 * after all, the server answers the second from memory.
	 */
	function resend(sent: Sent) {
		unsettled.set(sent.form, { fields: sent.fields, key: sent.key });
		resending.add(sent.form);

		try {
			// From the prototype. Called on the form itself, a field named `requestSubmit` would
			// be found in place of the method.
			HTMLFormElement.prototype.requestSubmit.call(
				sent.form,
				sent.submitter?.isConnected ? sent.submitter : undefined
			);
		} catch {
			// The button is no longer one of the form's. The visitor is told, below.
		}

		// Still marked, so it was not sent: the form would not go. The visitor has to be told.
		if (resending.delete(sent.form)) unanswered(sent, UNREADABLE);
	}

	/** Resets the form, unless it is one that keeps its fields, or was typed in after it left. */
	function clear(sent: Sent, untouched: boolean) {
		if (after !== 'reset' || !untouched || !sent.form.isConnected) return;
		// From the prototype. Called on the form itself, a field named `reset` would be found in
		// place of the method.
		HTMLFormElement.prototype.reset.call(sent.form);
	}

	/**
	 * Deals with a send's answer. It is over when this returns, or throws. Returns whether the
	 * form is to be sent once more, because no answer to it could be read.
	 */
	async function settle(
		sent: Sent,
		result: ActionResult | null,
		deadline: Promise<void>
	): Promise<boolean> {
		// Whether anything has been typed since the form left: that is the start of the next
		// entry, and a reset would erase it. Asked before the answer is on the page, because the
		// answer changes the fields' defaults, and an untouched field follows its default.
		const untouched = () => sent.form.isConnected && snapshot(sent.form) === sent.fields;

		// No answer from the action: none that could be read, or an error in its place. It gets
		// one more try, if there is any point in one: nothing was read at all, there is a
		// connection, this is the first try, and the form still holds what was sent.
		const noAnswer = async (words: string) => {
			const worthTrying = words === UNREADABLE && !sent.again && navigator.onLine && untouched();
			if (worthTrying && (await reachable())) return true;
			unanswered(sent, words);
			return false;
		};
		if (!readable(result)) return noAnswer(UNREADABLE);
		if (result.type === 'error') return noAnswer(explain(result));

		// The action has answered, so whatever it said, this press is settled.
		unsettled.delete(sent.form);

		if (result.type === 'redirect') {
			// Not followed once the visitor has gone elsewhere: to another page, or to another
			// address of this one. Measured before this check: a visitor who sent a form and
			// then followed a link was taken off the page they had chosen when the answer came.
			if (gone || address() !== sent.from) return false;

			// The visitor is sent on, as after a plain post. Where that leads to this same page,
			// the form must not still hold what was just sent. Where it leads away, the fields
			// are left as they are, for the visitor may come back to them. Measured with a proxy
			// that answered a form with a redirect to its sign-in page: the form was emptied on
			// the way out, and was still empty when the visitor pressed Back.
			if (leadsHere(result.location)) clear(sent, untouched());
			await applyAction(result);
			return false;
		}

		// What the page shows may be out of date now. It is reloaded where the visitor stands:
		// nothing here navigates, so the address and its query string stay as they are. The wait
		// is bounded by the same limit as the answer was, so a reload that hangs cannot hold the
		// form. If the limit ends it, the answer goes on the page ahead of the data.
		//
		// An answer that only just made the limit still gets its reload a second. Measured
		// without that, with an answer 10 ms inside the limit: the form said the page was behind,
		// and then that it was saved, a blink apart.
		let current = true;
		if (result.type === 'success' || reload === 'always') {
			const patience = Promise.all([deadline, pause(RELOAD_GRACE)]);
			current = await Promise.race([reloadData(), patience.then(() => false)]);
			// Replaced by a newer send in the meantime, whose answer is the one that counts.
			if (sent.done || sent.replaced) return false;
		}

		const fresh = untouched();
		const given = (result.data as Answer | undefined) ?? undefined;

		if (result.type === 'failure') {
			latest = { answer: given, refused: true };
			problem = undefined;
			gaveUp = false;
			behindAt = undefined;
			trouble(sent);
		} else if (!sent.passed) {
			// A save has the last word, unless another form of the set ended badly while this
			// one was on its way: that is still what the visitor has to be told.
			latest = { answer: given, refused: false };
			problem = undefined;
			gaveUp = false;
			troubled = undefined;
			// A reload that was only slow still lands, and the page has caught up when it does.
			behindAt = current ? undefined : reloads.landed;
		}
		// The server's version is on the page from here, so what was shown in advance can go.
		finish(sent);

		// A reset shows each field's default, and until now the defaults were whatever the server
		// had last sent back: reset any earlier and a refused entry would reappear.
		await tick();
		if (!sent.form.isConnected) return false;

		// Whether the visitor is where they were as the form left. Focus anywhere in the form
		// once counted as that. Measured then, with a second field typed into while the send
		// was on its way: the answer moved focus to the first field, and the rest of what was
		// being typed went into the wrong box.
		const stayed = fresh && document.activeElement === sent.focus;

		if (result.type === 'failure') {
			if (stayed) focusFirstRefused(sent.form, errorsOf(given));
			return false;
		}

		clear(sent, fresh);
		options.saved?.(sent.form, stayed);
		return false;
	}

	/** Puts a send on the wire, and returns what deals with its answer. */
	function launch(sent: Sent): Answered {
		held.delete(sent.form);
		flights.set(sent.form, sent);
		sentOff(sent);

		// The limit covers the whole exchange: the answer, and then the reload of the page's data
		// that may follow it.
		const deadline = new Promise<void>((resolve) => {
			sent.limit = setTimeout(() => {
				resolve();
				if (sent.done || sent.answered) return;

				// The page stops waiting. The request is abandoned, which tells the server
				// not to write (see `stopIfAbandoned`), and the form can be sent again.
				sent.controller.abort();
				if (!sent.replaced) {
					unanswered(sent, UNANSWERED);
					gaveUp = true;
				}
				finish(sent);
			}, limit);
		});

		return async ({ result }) => {
			if (sent.done) return;
			sent.answered = true;
			answered(sent);
			// The server has done with it, so a newer send of the same form need wait no longer.
			sent.land();

			let again = false;
			try {
				// With a newer send in its place, this answer is not the page's to show.
				if (!sent.replaced) again = await settle(sent, result, deadline);
			} finally {
				// Whatever became of the answer, the send is over. Left in flight by an error
				// here, a form that ignores a second send could never be sent again.
				finish(sent);
			}
			// Only now that the first is over: a form that ignores a second send would ignore this.
			if (again) resend(sent);
		};
	}

	const submit: SubmitFunction = ({ formElement, formData, controller, cancel, submitter }) => {
		const ahead = flights.get(formElement);
		if (ahead && again === 'ignore') {
			cancel();
			return;
		}

		// The newest press takes the place of any before it. One that was held back is never
		// sent, and the one on its way is no longer the page's: what it showed in advance goes
		// now, before this one shows its own.
		const waiting = held.get(formElement);
		if (waiting) {
			waiting.cancel?.();
			finish(waiting);
		}
		if (ahead && !ahead.replaced) {
			ahead.replaced = true;
			ahead.undo?.();
			ahead.undo = undefined;
		}

		// The key the server knows this press by. A form sent again as it stood, after a send
		// that nothing came of, is the same press, and goes under the same key.
		const fields = snapshot(formElement);
		const last = unsettled.get(formElement);
		const key = last?.fields === fields ? last.key : newKey();
		formData.set(SEND_KEY, key);

		// Before this send is recorded, so that if it throws nothing is left half begun.
		const undo = options.sending?.(formData, formElement);

		let land!: () => void;
		const landed = new Promise<void>((resolve) => (land = resolve));
		const sent: Sent = {
			form: formElement,
			controller,
			from: address(),
			fields,
			// After `sending`, which may have moved focus on purpose.
			focus: document.activeElement,
			answered: false,
			lagging: false,
			done: false,
			replaced: false,
			passed: false,
			landed,
			land,
			undo,
			key,
			submitter,
			again: resending.delete(formElement)
		};

		// Sent again, the form's own trouble is no longer the news. Another form's stays said
		// until this one is answered.
		if (!troubled || troubled === formElement) {
			troubled = undefined;
			problem = undefined;
			gaveUp = false;
		}
		behindAt = undefined;
		flying += 1;

		// Counted from the press and not from when the request leaves, because that is how long
		// the visitor has been waiting.
		sent.slow = setTimeout(() => {
			sent.lagging = true;
			lagging += 1;
		}, SLOW_AFTER);

		if (!ahead || ahead.answered) return launch(sent);

		// One at a time. A form's requests reach the server in the order they were pressed, and
		// none leaves until the one before it has been answered, so the last press is the last
		// write whatever stands between the browser and the server.
		//
		// The one before used to be abandoned in flight instead, with the server left to notice
		// (`stopIfAbandoned`). That holds only where a browser's hanging up reaches the server.
		// Measured behind a proxy that does not pass it on, saving 1 and then 3: the page said
		// "saved 3" and the server held 1.
		held.set(formElement, sent);
		sent.cancel = cancel;
		return ahead.landed.then(() => (sent.done ? undefined : launch(sent)));
	};

	const attach: Attachment<HTMLFormElement> = (formElement) => {
		const enhanced = enhance(formElement, submit);

		// A send in flight is left alone when its form goes, and its answer is still dealt with.
		// The form may be a row that was taken off the page as it was sent, with the rest of the
		// set still there to show what the server said.
		return () => enhanced.destroy();
	};

	return {
		/** Attach to the form, or to each of a set of like forms: `{@attach save.attach}`. */
		attach,
		get status() {
			return status;
		},
		/** Whether a form is on its way: the time to show the button waiting. */
		get busy() {
			return flying > 0;
		},
		/**
		 * The server's last answer, however the form was sent. After a refusal it holds `values`,
		 * what was typed, for the fields to take as their defaults, and `errors`, a message for
		 * each field turned down. In a set of forms a refusal stays the answer while others of
		 * the set are saved around it.
		 */
		get answer() {
			return answer;
		},
		/**
		 * One line about the form as a whole, or an empty string: that it is slow, that it could
		 * not be sent or was not answered, or what the server had to say about it. After a
		 * refusal it is never empty.
		 */
		get message() {
			return said.words;
		},
		/** Whether what `message` says is that something was not saved, for the colour of the line. */
		get failed() {
			return said.bad;
		}
	};
}

/** Whether an answer is a refusal, by the mark `saveAction` puts on every one. */
function isRefusal(answer: object | undefined): boolean {
	return answer !== undefined && 'refused' in answer && answer.refused === true;
}

/** An answer's message for the form as a whole, if it has one. */
function messageOf(answer: object | undefined): string {
	return answer && 'message' in answer && typeof answer.message === 'string' ? answer.message : '';
}

/** An answer's messages for its fields, if it has any. */
function errorsOf(answer: object | undefined): object {
	return answer && 'errors' in answer && typeof answer.errors === 'object' && answer.errors
		? answer.errors
		: {};
}

/**
 * Whether an answer is a result an action could have given. `use:enhance` takes anything in the
 * shape of one for one, whoever sent it, and an error some proxy wrote as JSON can have the
 * shape and not the parts. Measured with such answers: `{"type":"error"}` threw where its
 * message was read and left the form saying nothing, a redirect with no address sent the
 * visitor to a page called "undefined", and a number where an answer's data belongs put the
 * error page in place of the form.
 */
function readable(result: ActionResult | null): result is ActionResult {
	switch (result?.type) {
		case 'redirect':
			return typeof result.location === 'string';
		case 'error':
			return typeof result.error === 'object' && result.error !== null;
		case 'success':
		case 'failure':
			return result.data === undefined || typeof result.data === 'object';
		default:
			return false;
	}
}

/**
 * What to say when the post ended in an error and not in the action's answer.
 *
 * An error with a status of its own came from the server's handling of the action: the action
 * threw outside `saveAction`, or there is no such action. Its message has been through the
 * server's error hook and is safe to show.
 *
 * The rest was made in the browser, by `use:enhance`, in one of two ways. Something answered the
 * post with an HTTP error and no result. Below 500 it turned the post away before the action
 * ran: the server's check that a form comes from its own site, or a proxy asking the visitor to
 * sign in. From 500 up nobody can say how far the post got, a proxy's "gateway timeout"
 * included, so the visitor is not told that nothing was saved. Or no answer could be read at
 * all (no connection, the server down, a page that is not the server's in its place), and that
 * reaches the browser's error hook as an error of unknown kind. The hook in src/hooks.client.ts
 * gives such an error a reference, which is how it is told apart here. The reference is not
 * shown: what it was recorded under is the browser's failure to read an answer, which the
 * visitor has just been told.
 */
function explain(result: Extract<ActionResult, { type: 'error' }>): string {
	const { message, status, reference } = result.error;

	if (result.status !== undefined) {
		const said = message || `Error ${result.status}.`;
		return reference ? `${said} Reference ${reference}.` : said;
	}
	if (reference) return navigator.onLine ? UNREADABLE : OFFLINE;
	if (status >= 500) {
		return `No answer came back (error ${status}). It may not have been saved: send it again.`;
	}
	return `Turned away before it was read (error ${message ? `${status}: ${message}` : status}).`;
}

/** The form's fields as one piece of text, to compare two moments. A file is told by its facts. */
function snapshot(form: HTMLFormElement): string {
	return JSON.stringify(
		Array.from(new FormData(form), ([name, value]) => [
			name,
			typeof value === 'string' ? value : [value.name, value.size, value.lastModified]
		])
	);
}

/**
 * Moves focus to the first field that was turned down, in the order they stand in the form, and
 * brings it into view. A message is under its field's name, or for one value of a repeated name
 * under the name and the value's position among those that were sent (`price.3`). A box that is
 * not ticked sends nothing, so it has no position, and a list to choose several from has one for
 * each choice made.
 */
function focusFirstRefused(form: HTMLFormElement, errors: object) {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call, and read by nothing else
	const positions = new Map<string, number>();
	// Found by tag and attribute. `form.elements` could be a field of that name.
	const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
		'input[name], select[name], textarea[name]'
	);

	for (const field of fields) {
		if (field.matches(':disabled')) continue;

		const sends =
			field instanceof HTMLSelectElement && field.multiple
				? field.selectedOptions.length
				: field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')
					? Number(field.checked)
					: 1;
		const first = positions.get(field.name) ?? 0;
		positions.set(field.name, first + sends);

		// Own keys only: a field could be named `constructor`.
		let refused = Object.hasOwn(errors, field.name);
		for (let position = first; !refused && position < first + sends; position += 1) {
			refused = Object.hasOwn(errors, `${field.name}.${position}`);
		}

		// A hidden field cannot take focus. The next one that was turned down can.
		if (refused && field.type !== 'hidden') {
			field.focus();
			return;
		}
	}
}
