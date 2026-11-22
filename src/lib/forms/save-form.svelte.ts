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
 * answer among them.
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
 *   applied over a newer one.
 * - An answer never undoes what was typed after the form was sent, and never takes the keyboard
 *   away from a visitor who has moved on.
 * - A request that is never answered is given up after a time limit, and the form can be sent
 *   again. On the server, `stopIfAbandoned` keeps a request that was given up from writing.
 * - After a refusal, focus goes to the first field that was turned down, and `message` has
 *   something to say, so the refusal is heard as well as seen.
 *
 * What it leaves to the page: tying each message to its field (`aria-invalid`,
 * `aria-describedby`), and keeping the lines that show messages in space reserved for them, so
 * that a message arriving moves nothing. The line that shows `message` must have
 * `role="status"`: that is what announces whatever happens to the form.
 */
import { tick } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { applyAction, enhance, type ActionResult, type SubmitFunction } from '$app/forms';
import { afterNavigate, refreshAll } from '$app/navigation';

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
	 * form that is filled in and sent. `replace` abandons the first for it, which suits a control
	 * that can be pressed again and again, and that must post the state it wants and not a flip.
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
	 * every attempt. That has a price, which is why it is not the rule: a reload that fails puts
	 * the error page in place of the form, and a refusal is when the visitor most needs the form.
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
	 * `stayed` says whether the visitor's focus is still where it was when the form was sent, or
	 * in the form. If it is not, they have moved on, and focus must not be pulled back.
	 */
	saved?: (form: HTMLFormElement, stayed: boolean) => void;
}

const SLOW_AFTER = 500;
const DEFAULT_LIMIT = 8000;

// Short enough to fit the one or two lines a page reserves for them.
const SLOW = 'Still sending. The server is slow to answer.';
const UNANSWERED = 'No answer came back. It may not have been saved: send it again.';
const OFFLINE = 'There is no connection. Send it again when there is one.';
const UNREADABLE = 'No answer could be read from the server. Send it again.';
const REFUSED = 'Not saved.';
const REFUSED_FIELDS = 'Not saved. See what is marked.';

/** One send of a form, from the moment it leaves until its answer has been dealt with. */
interface Sent {
	form: HTMLFormElement;
	controller: AbortController;
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
	/** Takes back what `sending` showed. */
	undo: (() => void) | void;
	slow?: ReturnType<typeof setTimeout>;
	limit?: ReturnType<typeof setTimeout>;
}

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

	const status = $derived<SaveStatus>(
		flying > 0 ? (lagging > 0 ? 'slow' : 'sending') : gaveUp ? 'unanswered' : 'idle'
	);
	const answer = $derived(latest ? latest.answer : (options.answer() ?? undefined));
	const refused = $derived(latest ? latest.refused : isRefusal(answer));
	const message = $derived.by(() => {
		if (status === 'slow') return SLOW;
		// Nothing while it is on its way. The last answer's words are about the last send, and
		// cleared now, the same words coming back are a change, which is what gets them announced.
		if (status === 'sending') return '';
		if (problem !== undefined) return problem;
		// A refusal always has something to say, whether or not the server sent a sentence.
		const fallback = Object.keys(errorsOf(answer)).length ? REFUSED_FIELDS : REFUSED;
		return messageOf(answer) || (refused ? fallback : '');
	});

	// The component outlives a move to another address of the same page, and what it holds is
	// about the address that was left. SvelteKit empties the page's `form` prop then, and this
	// does the same with its own.
	afterNavigate(({ type }) => {
		if (type === 'enter') return;
		latest = undefined;
		problem = undefined;
		gaveUp = false;
	});

	/** The send each form is waiting on an answer to, if any. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping: nothing on the page is drawn from it
	const flights = new Map<HTMLFormElement, Sent>();

	/** Ends a send, once: its timers, its place as its form's send, and what it showed in advance. */
	function finish(sent: Sent) {
		if (sent.done) return;
		sent.done = true;

		clearTimeout(sent.slow);
		clearTimeout(sent.limit);
		if (flights.get(sent.form) === sent) flights.delete(sent.form);
		flying -= 1;
		if (sent.lagging) lagging -= 1;
		sent.undo?.();
	}

	/** Whether the visitor's focus is where it was as the form left, or in the form. */
	const stayed = (sent: Sent) =>
		document.activeElement === sent.focus || sent.form.contains(document.activeElement);

	/** Resets the form, unless it is one that keeps its fields, or was typed in after it left. */
	function clear(sent: Sent, untouched: boolean) {
		if (after !== 'reset' || !untouched || !sent.form.isConnected) return;
		// From the prototype. Called on the form itself, a field named `reset` would be found in
		// place of the method.
		HTMLFormElement.prototype.reset.call(sent.form);
	}

	/** Deals with a send's answer. It is over when this returns, or throws. */
	async function settle(sent: Sent, result: ActionResult | null, deadline: Promise<void>) {
		// Whether anything has been typed since the form left: that is the start of the next
		// entry, and a reset would erase it. Asked before the answer is on the page, because the
		// answer changes the fields' defaults, and an untouched field follows its default.
		const untouched = () => sent.form.isConnected && snapshot(sent.form) === sent.fields;

		if (result?.type === 'redirect') {
			// The visitor is sent on, as after a plain post, and where that leads to this same
			// page the form must not still hold what was just sent.
			clear(sent, untouched());
			await applyAction(result);
			return;
		}

		if (result?.type !== 'success' && result?.type !== 'failure') {
			// An error, or an answer that is no result at all.
			problem = result?.type === 'error' ? explain(result) : UNREADABLE;
			return;
		}

		// What the page shows may be out of date now. It is reloaded where the visitor stands:
		// nothing here navigates, so the address and its query string stay as they are. The wait
		// is bounded by the same limit as the answer was, so a reload that hangs cannot hold the
		// form. If the limit ends it, the answer goes on the page ahead of the data.
		if (result.type === 'success' || reload === 'always') {
			await Promise.race([reloadData(), deadline]);
			// Replaced by a newer send in the meantime, whose answer is the one that counts.
			if (sent.done) return;
		}

		const fresh = untouched();
		const given = (result.data as Answer | undefined) ?? undefined;
		latest = { answer: given, refused: result.type === 'failure' };
		problem = undefined;
		gaveUp = false;
		// The server's version is on the page from here, so what was shown in advance can go.
		finish(sent);

		// A reset shows each field's default, and until now the defaults were whatever the server
		// had last sent back: reset any earlier and a refused entry would reappear.
		await tick();
		if (!sent.form.isConnected) return;

		if (result.type === 'failure') {
			if (stayed(sent)) focusFirstRefused(sent.form, errorsOf(given));
			return;
		}

		clear(sent, fresh);
		options.saved?.(sent.form, stayed(sent));
	}

	const submit: SubmitFunction = ({ formElement, formData, controller, cancel }) => {
		const earlier = flights.get(formElement);
		if (earlier) {
			if (again === 'ignore') {
				cancel();
				return;
			}
			// Abandoned in favour of this one. Its answer, if it is already on its way back, is
			// not applied: it is over.
			earlier.controller.abort();
			finish(earlier);
		}

		// Before anything is recorded, so that if it throws nothing is left half begun.
		const undo = options.sending?.(formData, formElement);

		const sent: Sent = {
			form: formElement,
			controller,
			fields: snapshot(formElement),
			// After `sending`, which may have moved focus on purpose.
			focus: document.activeElement,
			answered: false,
			lagging: false,
			done: false,
			undo
		};
		flights.set(formElement, sent);
		flying += 1;
		problem = undefined;
		gaveUp = false;

		sent.slow = setTimeout(() => {
			sent.lagging = true;
			lagging += 1;
		}, SLOW_AFTER);

		// The limit covers the whole exchange: the answer, and then the reload of the page's data
		// that may follow it.
		const deadline = new Promise<void>((resolve) => {
			sent.limit = setTimeout(() => {
				resolve();
				if (sent.done || sent.answered) return;

				// The page stops waiting. The request is abandoned, which tells the server
				// not to write (see `stopIfAbandoned`), and the form can be sent again.
				controller.abort();
				problem = UNANSWERED;
				gaveUp = true;
				finish(sent);
			}, limit);
		});

		return async ({ result }) => {
			if (sent.done) return;
			sent.answered = true;

			try {
				await settle(sent, result, deadline);
			} finally {
				// Whatever became of the answer, the send is over. Left in flight by an error
				// here, a form that ignores a second send could never be sent again.
				finish(sent);
			}
		};
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
		 * each field turned down.
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
			return message;
		},
		/** Whether the last send ended without saving, for the colour of the line. */
		get failed() {
			return flying === 0 && (problem !== undefined || refused);
		}
	};
}

/**
 * Loads the page's data again, and resolves when a reload that began after this call has
 * finished. SvelteKit lets a later reload take over from one in progress, and the earlier one's
 * promise then resolves with nothing new on the page. Measured with two rows of a list ticked
 * 100 ms apart: the first tick flipped back for a moment, because its reload had been dropped
 * for the second's. So reloads asked for here are run one after another, and every caller waits
 * for the last.
 */
let reloading: Promise<void> | undefined;
let wanted = false;

function reloadData(): Promise<void> {
	wanted = true;
	reloading ??= (async () => {
		try {
			while (wanted) {
				wanted = false;
				await refreshAll();
			}
		} finally {
			reloading = undefined;
		}
	})();

	return reloading;
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
 * What to say when the post ended in an error and not in the action's answer.
 *
 * An error with a status of its own came from the server's handling of the action: the action
 * threw outside `saveAction`, or there is no such action. Its message has been through the
 * server's error hook and is safe to show.
 *
 * The rest was made in the browser, by `use:enhance`, in one of two ways. Something answered the
 * post with an HTTP error before the action ran: the server's check that a form comes from its
 * own site, or a proxy's own error page. That is passed on with its status, and with its words
 * if it had any. Or no answer could be read at all (no connection, the server down, a page that
 * is not the server's in its place), and that reaches the browser's error hook as an error of
 * unknown kind. The hook in src/hooks.client.ts gives such an error a reference, which is how
 * it is told apart here. The reference is not shown: what it was recorded under is the
 * browser's failure to read an answer, which the visitor has just been told.
 */
function explain(result: Extract<ActionResult, { type: 'error' }>): string {
	const { message, status, reference } = result.error;

	if (result.status !== undefined) {
		const said = message || `Error ${result.status}.`;
		return reference ? `${said} Reference ${reference}.` : said;
	}
	if (reference) return navigator.onLine ? UNREADABLE : OFFLINE;
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
