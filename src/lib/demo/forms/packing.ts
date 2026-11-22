/**
 * The packing list's rules. Pure functions with no framework in them, shared by the server, which
 * enforces them, and the form, which only needs the limits to describe them.
 */

export const MAX_ITEMS = 10;
export const MAX_TEXT = 40;
export const MAX_QUANTITY = 99;
/** Submissions kept in each list's log. */
export const MAX_LOG = 5;

export interface Item {
	id: number;
	text: string;
	quantity: number;
	packed: boolean;
}

/** How a submission reached the server: sent in place by script, or as a plain HTML form post. */
export type Via = 'enhanced' | 'plain';

export interface Submission {
	/** Counts up from 1 for each list, so the log can be ordered without clocks. */
	seq: number;
	action: 'add' | 'pack' | 'unpack' | 'remove';
	via: Via;
	outcome: 'saved' | 'invalid' | 'refused';
	/** The item's text, as submitted. */
	subject: string;
}

/** Every new list starts with these, so the page is never empty and every visitor sees the same. */
export const SEED: readonly Item[] = [
	{ id: 1, text: 'Passport', quantity: 1, packed: true },
	{ id: 2, text: 'Phone charger', quantity: 1, packed: true },
	{ id: 3, text: 'Socks', quantity: 4, packed: false },
	{ id: 4, text: 'Rain jacket', quantity: 1, packed: false },
	{ id: 5, text: 'Kitchen sink', quantity: 1, packed: false }
];

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');
const sameText = (a: string, b: string) => tidy(a).toLowerCase() === tidy(b).toLowerCase();

export type ParsedItem =
	| { ok: true; text: string; quantity: number }
	| { ok: false; errors: { text?: string; quantity?: string } };

/** Checks a new item, as it was typed, against the list it would join. */
export function parseNewItem(
	values: { text: string; quantity: string },
	items: readonly Item[]
): ParsedItem {
	const errors: { text?: string; quantity?: string } = {};
	const text = tidy(values.text);
	const quantity = Number(values.quantity.trim());

	if (text === '') {
		errors.text = 'Enter something to pack.';
	} else if (text.length > MAX_TEXT) {
		errors.text = `Keep it to ${MAX_TEXT} characters or fewer.`;
	} else if (items.some((item) => sameText(item.text, text))) {
		errors.text = 'That is already on the list.';
	} else if (items.length >= MAX_ITEMS) {
		errors.text = 'The list is full. Remove something first.';
	}

	if (!/^\d+$/.test(values.quantity.trim()) || quantity < 1 || quantity > MAX_QUANTITY) {
		errors.quantity = `A whole number, 1 to ${MAX_QUANTITY}.`;
	}

	if (errors.text || errors.quantity) return { ok: false, errors };
	return { ok: true, text, quantity };
}

/**
 * The one rule that exists only so you can watch an optimistic update being rolled back: the
 * server will pack everything but the kitchen sink.
 */
export function refusePacking(item: Item): string | undefined {
	if (sameText(item.text, 'kitchen sink')) {
		return 'Refused: the server packs everything but the kitchen sink.';
	}
}
