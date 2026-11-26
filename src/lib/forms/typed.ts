/**
 * What a visitor has typed into a page's forms, kept through leaving the page and coming back.
 *
 * A browser does this by itself for a page it loads whole: follow a link, press Back, and what
 * was typed is still in the form. A page that SvelteKit draws in place is drawn again from
 * nothing. Measured in three browsers, with a title and a note typed, a link followed and Back
 * pressed: both were still there without JavaScript, and both were gone with it. The same loss
 * met a visitor whom a proxy sent off to sign in half way through a form.
 *
 * SvelteKit's `snapshot` is the way to put it back: it asks for something to keep as a page is
 * left, and hands it over when the visitor returns to that entry in their history, by Back or
 * Forward or a reload. The root layout registers the two functions below, once, for every page.
 *
 * Kept: only the forms that save (POST), because the fields of a GET form are the page's
 * address (see ./address-form.ts). And only what the visitor changed. A field that still holds
 * what the page gave it is left to take whatever the page gives it next, which may be newer:
 * put back, an old value would look typed, and be saved over the new one.
 *
 * Never kept: a password, a file (which cannot be put back), and fields nobody types in.
 */

/** What a field holds: its text, whether it is ticked, or which of its options are chosen. */
type Held = string | boolean | string[];

/** What was typed, by where each field stands on the page. */
export type Typed = Record<string, Held>;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const NOT_KEPT = ['password', 'hidden', 'file', 'submit', 'button', 'image', 'reset'];

/**
 * Every field of every form that saves, each with a name for its place: its form's action and
 * which form of that action it is, then its own name and which field of that name it is. Rows
 * of a list share an action and a name, and are told apart by their order.
 */
function* fields(): Generator<[place: string, field: Field]> {
	const actions = new Map<string, number>();

	for (const form of document.querySelectorAll<HTMLFormElement>('form[method="post" i]')) {
		const action = form.getAttribute('action') ?? '';
		const nth = actions.get(action) ?? 0;
		actions.set(action, nth + 1);

		const names = new Map<string, number>();
		// Found by tag and attribute. `form.elements` could be a field of that name.
		for (const field of form.querySelectorAll<Field>('input[name], select[name], textarea[name]')) {
			if (field instanceof HTMLInputElement && NOT_KEPT.includes(field.type)) continue;

			const count = names.get(field.name) ?? 0;
			names.set(field.name, count + 1);
			yield [`${action} ${nth} ${field.name} ${count}`, field];
		}
	}
}

/** What a field holds, if that is not what the page gave it. */
function changed(field: Field): Held | undefined {
	if (field instanceof HTMLSelectElement) {
		const options = Array.from(field.options);
		return options.some((option) => option.selected !== option.defaultSelected)
			? options.filter((option) => option.selected).map((option) => option.value)
			: undefined;
	}
	if (ticked(field)) return field.checked === field.defaultChecked ? undefined : field.checked;
	return field.value === field.defaultValue ? undefined : field.value;
}

/** Whether a field is one that is ticked and not typed in. */
const ticked = (field: Field): field is HTMLInputElement =>
	field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio');

/** Called as the page is left. */
export function keepTyped(): Typed {
	const typed: Typed = {};

	for (const [place, field] of fields()) {
		const held = changed(field);
		if (held !== undefined) typed[place] = held;
	}

	return typed;
}

/**
 * Called when the visitor is back, with what was kept. A field that is no longer there, or is
 * no longer the kind of field it was, is passed over.
 */
export function putBackTyped(typed: Typed) {
	for (const [place, field] of fields()) {
		// Own keys only: an action or a field's name can be anything.
		if (!Object.hasOwn(typed, place)) continue;
		const held = typed[place];

		if (field instanceof HTMLSelectElement) {
			if (!Array.isArray(held)) continue;
			for (const option of field.options) option.selected = held.includes(option.value);
		} else if (ticked(field)) {
			if (typeof held === 'boolean') field.checked = held;
		} else if (typeof held === 'string') {
			field.value = held;
		}
	}
}
