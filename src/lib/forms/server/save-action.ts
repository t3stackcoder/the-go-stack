/**
 * The server's half of a form that saves data. The browser's half is ../save-form.svelte.ts, and
 * both are for forms that POST to an action. A form whose fields are the page's address (a
 * search box, a set of filters) is a GET form, and uses ../address-form.ts.
 *
 * An action written with `saveAction` gets its fields read and checked against a zod schema, and
 * every way it can end short of saving comes back to the page as the same thing: a `Refusal`,
 * carrying what was typed. With JavaScript or without, the visitor is looking at the form they
 * sent, with their text in it and the reason beside it. A bare action answers some of these with
 * an error page instead, and what was typed is gone.
 *
 *     export const actions = {
 *         add: saveAction('add', NewItem, (item, event) => {
 *             if (taken(item.text)) refuse({ text: 'That is already on the list.' });
 *             stopIfAbandoned(event);
 *             list.add(item);
 *         })
 *     };
 *
 * Everything typed is sent back, whatever the field. A form with a secret in it, a password,
 * needs a way to leave that field out, and this does not have one yet.
 *
 * A post can arrive twice for one press: a browser sends one again by itself when the connection
 * fails before any answer has come, and a visitor told that no answer came sends again what may
 * be saved already. `saveAction` knows a repeat for what it is, and gives it the answer the first
 * was given without saving again (see ./once.ts). That holds on one server and while it runs.
 * Where a repeat can reach another server, or this one after a restart, the action has to be
 * safe by itself: write a state and not a change ("aboard: yes", never "flip it"), or turn down
 * what is already there, as the `add` above does.
 *
 * This directory is named `server`, so SvelteKit refuses to bundle it into browser code.
 */
import {
	error,
	fail,
	isHttpError,
	isRedirect,
	type ActionFailure,
	type RequestEvent
} from '@sveltejs/kit';
import type * as z from 'zod';
import { recordFault, recordRefusal } from '#lib/server/faults.js';
import { saveOnce } from './once.js';

/** A schema for a form: an object with one key for each field name. */
type FormSchema = z.ZodObject;

/**
 * What was typed, by field name, to be shown again: yes or no for a checkbox (`z.boolean()`), a
 * list where a name is repeated (`z.array(...)`), and text for everything else. A field the
 * schema converts (`z.coerce.number()`) comes back as the text that was typed.
 *
 * The type is worked out from what the schema takes in, and the value from the schema's own
 * kind (see `kindOf`). For the three kinds above the two agree. For a schema that takes in
 * anything and converts it to one of them (`z.coerce.boolean()`, a preprocessed list), the type
 * says text and is wrong: use the plain kinds for a checkbox and for a list.
 */
export type Echo<Schema extends FormSchema> = {
	[Name in keyof z.input<Schema>]: [NonNullable<z.input<Schema>[Name]>] extends [boolean]
		? boolean
		: [NonNullable<z.input<Schema>[Name]>] extends [unknown[]]
			? string[]
			: string;
};

/**
 * A field's name, or for one of a repeated field its name and position: `price.3` is the fourth
 * value sent under `price`.
 */
type FieldKey<Schema extends FormSchema> =
	(keyof z.input<Schema> & string) | `${keyof z.input<Schema> & string}.${number}`;

/** What an action sends back when it does not save: the data of a `fail()`. */
export interface Refusal<Name extends string = string, Schema extends FormSchema = FormSchema> {
	/** Always true. It is how the page tells a refusal from what the action returns on a save. */
	refused: true;
	/** The action that answered. A page with several forms uses it to tell whose answer this is. */
	action: Name;
	values: Echo<Schema>;
	/** One message for each field that was turned down. Empty when the reason is not a field. */
	errors: Partial<Record<FieldKey<Schema>, string>>;
	/** The reason, when it is about the form as a whole. */
	message?: string;
}

/**
 * The most a form's fields may hold. More than this is turned down, with a message, whatever the
 * schema would have said.
 *
 * What was over the limit goes back to the page whole, like everything else that was typed: a
 * visitor without JavaScript gets their fields from that, and what they are given is what they
 * send next. It was once cut to the limit on its way back. Measured then, without JavaScript: a
 * name of 61 characters was turned down and came back as 60, and sent again as it stood it was
 * saved as 60. The end of what had been typed was gone, and nothing on the page said so. What
 * bounds a post, and so what can come back, is the server's own limit on a request's size.
 */
export interface FieldLimits {
	/** The most characters one field may hold. Default 1000. */
	text?: number;
	/** The most values one repeated field may hold. Default 1000. */
	list?: number;
}

class Refused extends Error {
	constructor(readonly errors: Record<string, string>) {
		super('A form was refused outside saveAction, which is the only place that can answer it.');
	}
}

class Abandoned extends Error {
	constructor() {
		super('stopIfAbandoned was called outside saveAction, which is the only place it can stop.');
	}
}

/**
 * Turns fields down after the schema has passed them, for a reason the schema cannot know: a name
 * that is taken, a list that is full. Call it inside `saveAction`, with a message for each field
 * by the field's name. It does not return. A message under a name the form has no field for
 * reaches the page, and has nowhere there to be shown.
 *
 * To turn the whole form down, use SvelteKit's `error(409, 'The reason.')`. Inside `saveAction`
 * it ends on the form too.
 */
export function refuse(errors: Record<string, string>): never {
	throw new Refused(errors);
}

/**
 * Stops the action if nobody is waiting for its answer any more: the form gave up on it at its
 * time limit, or the visitor left the page, or pressed twice without JavaScript and the browser
 * dropped the first for the second. Call it just before writing. It returns only if the
 * request still stands.
 *
 * Abandoning a request in the browser does not stop the action that is answering it. Measured
 * with three quick presses of one control, two of them abandoned in the browser: all three ran
 * to the end on the server. Unless the action looks, it saves after the visitor has been told
 * that no answer came.
 *
 * It can only look where it can see. A proxy that does not pass a browser's hanging up on to the
 * server hides it, and then this returns for a request nobody is waiting for. That is why the
 * helper no longer relies on it to keep two presses of one control in order (it sends them one
 * at a time), and why a repeat of a press is known by its key (see ./once.ts).
 */
export function stopIfAbandoned(event: Pick<RequestEvent, 'request'>): void {
	if (event.request.signal.aborted) throw new Abandoned();
}

/**
 * An action for a form that saves. It is given its own name, the key it is exported under, so
 * that its refusals say which action they came from in a way the type check can follow.
 *
 * The posted fields are read against the schema, by the kind of each of its keys:
 *
 * - a list (`z.array(...)`) takes every field of that name, in order. Rows of fields are posted
 *   as repeated names and never as JSON, which needs JavaScript to be sent at all;
 * - a boolean (`z.boolean()`) is a checkbox: true if it was sent;
 * - text (`z.string()`) is the field's text, and the empty string if the field was empty or was
 *   not sent;
 * - anything else (a number, a choice) is the field's text, or nothing at all if the field was
 *   empty, so that an emptied number field is a missing number and not a nought.
 *
 * If the schema passes them, `save` is called with the typed values, and what it returns is the
 * action's answer. Otherwise, and whenever `save` stops short, the answer is a `Refusal`:
 *
 * - the schema turned a field down, or `save` did with `refuse()`, or a field held more than
 *   its limit: status 400, a message a field;
 * - `save` raised an expected error with `error()`: that status and message, for the whole form;
 * - `save` threw anything else: a fault, recorded like any other, and answered with status 500
 *   and the sentence and reference a visitor is shown for one.
 *
 * A redirect goes through untouched. A request that cannot be read as a form is turned away
 * with status 400, and one that was given up on before it had arrived is answered to nobody.
 */
export function saveAction<
	Name extends string,
	Schema extends FormSchema,
	Event extends RequestEvent,
	Saved extends Record<string, unknown> | void
>(
	name: Name,
	schema: Schema,
	save: (values: z.output<Schema>, event: Event) => Saved | Promise<Saved>,
	limits: FieldLimits = {}
): (event: Event) => Promise<Saved | ActionFailure<Refusal<Name, Schema>>> {
	return async (event) => {
		// A wrong name would send every refusal to a form that is not looking for it, and
		// nothing would say so. This says so the first time the action runs.
		const answering = actionName(event.url);
		if (answering !== name) {
			throw new Error(
				`saveAction was named "${name}" but is answering "${answering}". ` +
					`Give it the key it is exported under.`
			);
		}

		let fields: FormData;
		try {
			fields = await event.request.formData();
		} catch (unread) {
			// Given up on while it was still arriving. Nobody is waiting for an answer, and a
			// visitor who went away is no fault of the server's. Measured before this was
			// caught: each one was recorded as an unexpected error, with a reference.
			if (event.request.signal.aborted) {
				return fail<Refusal<Name, Schema>>(499, {
					refused: true,
					action: name,
					values: {} as Echo<Schema>,
					errors: {}
				});
			}
			// Not a form at all: text, or parts that do not add up. No browser sends one, and
			// it is the sender's mistake, so it is turned away as that. Measured before: each
			// was answered with status 500 and recorded as a fault.
			if (unread instanceof TypeError) error(400, 'What was sent could not be read as a form.');
			// Anything else is not the action's to explain: too large a post, which SvelteKit
			// turns away itself, or a fault.
			throw unread;
		}

		const { raw, values, tooMuch } = read(fields, schema, limits);
		// The keys of `errors` are meant to be field names: they come from the schema's own
		// complaints, from the limits, or from a call to `refuse` in the action.
		const refusal = (status: number, errors: Record<string, string>, message?: string) =>
			fail<Refusal<Name, Schema>>(status, {
				refused: true,
				action: name,
				values,
				errors: errors as Refusal<Name, Schema>['errors'],
				message
			});

		try {
			// Awaited, so that a schema may check something that takes time.
			const checked = await schema.safeParseAsync(raw);
			const complaints = checked.success
				? { errors: {}, message: undefined }
				: messages(checked.error);

			// Where both have something to say about a field, the schema's words are the ones
			// written for it.
			const errors = { ...tooMuch.errors, ...complaints.errors };
			const message = complaints.message ?? tooMuch.message;
			if (!checked.success || message || Object.keys(errors).length) {
				return refusal(400, errors, message);
			}

			// Once for one press, however many times the press arrives.
			return await saveOnce(event, fields, () => save(checked.data, event));
		} catch (thrown) {
			if (isRedirect(thrown)) throw thrown;
			if (thrown instanceof Refused) return refusal(400, thrown.errors);
			// Nobody is listening for this answer. The status is the one proxies log for a client
			// that went away.
			if (thrown instanceof Abandoned) return refusal(499, {});

			if (isHttpError(thrown)) {
				recordRefusal('app', thrown.status, event);
				return refusal(thrown.status, {}, thrown.body.message);
			}

			const { message, reference } = recordFault(thrown, event);
			return refusal(500, {}, `${message} Reference ${reference}.`);
		}
	};
}

/** The name in `?/name`, as SvelteKit reads it from the address a form posts to. */
function actionName(url: URL): string {
	for (const [name] of url.searchParams) {
		if (name.startsWith('/')) return name.slice(1);
	}
	return 'default';
}

/** The little of a zod schema's definition that is read here. */
interface Definition {
	type: string;
	innerType?: { def: Definition };
	in?: { def: Definition };
	out?: { def: Definition };
}

/**
 * What kind of field a schema expects: a list, a checkbox, text, or some other single value. It
 * looks through the wrappers a schema is commonly given (optional, a default, a transform after
 * or before). A kind it does not know (a tuple, a set, a schema defined lazily) is read as a
 * single value.
 */
function kindOf(field: unknown): 'list' | 'checkbox' | 'text' | 'value' {
	let { def } = field as { def: Definition };

	for (;;) {
		if (def.type === 'array') return 'list';
		if (def.type === 'boolean') return 'checkbox';
		if (def.type === 'string') return 'text';

		// A pipe is checked on the side that sees the posted value: its input, unless that is a
		// preprocessing step, which hands the value on to its output.
		const inner = def.innerType ?? (def.in?.def.type === 'transform' ? def.out : def.in);
		if (!inner) return 'value';
		def = inner.def;
	}
}

/**
 * The posted fields the schema names, as the schema should be given them and as they are sent
 * back, with what was over a limit. Fields the schema does not name are dropped.
 */
function read<Schema extends FormSchema>(fields: FormData, schema: Schema, limits: FieldLimits) {
	const { text: maxText = 1000, list: maxList = 1000 } = limits;

	// A browser sending a form its own way writes every line break as two characters, and a form
	// sent by script as one. Measured: the same note in a textarea reached the action 20
	// characters long with JavaScript and 21 without. One form is settled on here, so that an
	// action is given the same text either way, and a length limit means the same thing.
	const posted = (value: FormDataEntryValue | null) =>
		typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value;
	// A file cannot be put back into a field, so there is nothing of it to send back.
	const typed = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : '');
	const tooLong = (value: FormDataEntryValue | null) =>
		typeof value === 'string' && value.length > maxText;

	const raw: Record<string, unknown> = {};
	const values: Record<string, string | string[] | boolean> = {};
	const tooMuch: { errors: Record<string, string>; message?: string } = { errors: {} };
	const long = `Keep it to ${maxText} characters or fewer.`;

	for (const [name, field] of Object.entries(schema.shape)) {
		const kind = kindOf(field);

		if (kind === 'list') {
			const all = fields.getAll(name).map(posted);
			raw[name] = all;
			values[name] = all.map(typed);
			all.forEach((value, position) => {
				if (tooLong(value)) tooMuch.errors[`${name}.${position}`] = long;
			});
			if (all.length > maxList) {
				tooMuch.message ??= `Too much was sent: ${maxList} of "${name}" at most.`;
			}
		} else if (kind === 'checkbox') {
			raw[name] = values[name] = fields.has(name);
		} else {
			const value = posted(fields.get(name));
			// An empty field is the empty string where text is wanted, and no value anywhere else.
			raw[name] =
				kind === 'text' ? (value ?? '') : value === '' || value === null ? undefined : value;
			values[name] = typed(value);
			if (tooLong(value)) tooMuch.errors[name] = long;
		}
	}

	return { raw, values: values as Echo<Schema>, tooMuch };
}

/**
 * A schema's complaints as the page shows them: the first for each field, under the field's key,
 * and the first that is about no field in particular as the message for the form.
 */
function messages(error: z.ZodError) {
	const errors: Record<string, string> = {};
	let message: string | undefined;

	for (const issue of error.issues) {
		const key = issue.path.join('.');
		if (key === '') message ??= issue.message;
		// Its own keys only: a field may be named `constructor`, which every object already has.
		else if (!Object.hasOwn(errors, key)) errors[key] = issue.message;
	}

	return { errors, message };
}
