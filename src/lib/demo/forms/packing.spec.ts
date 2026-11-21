import { describe, expect, it } from 'vitest';
import {
	MAX_ITEMS,
	MAX_QUANTITY,
	MAX_TEXT,
	SEED,
	parseNewItem,
	refusePacking,
	type Item
} from './packing.js';

const submit = (fields: Record<string, string>) => {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	return form;
};

const listOf = (count: number): Item[] =>
	Array.from({ length: count }, (_, index) => ({
		id: index + 1,
		text: `Item ${index + 1}`,
		quantity: 1,
		packed: false
	}));

describe('parseNewItem', () => {
	it('accepts a valid item, with its whitespace tidied', () => {
		expect(parseNewItem(submit({ text: '  Sun   cream ', quantity: '2' }), SEED)).toEqual({
			ok: true,
			text: 'Sun cream',
			quantity: 2
		});
	});

	it('rejects text that is empty or only spaces', () => {
		const result = parseNewItem(submit({ text: '   ', quantity: '1' }), SEED);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.errors.text).toBeTruthy();
	});

	it('accepts text at the limit and rejects text over it', () => {
		const atLimit = 'a'.repeat(MAX_TEXT);
		expect(parseNewItem(submit({ text: atLimit, quantity: '1' }), SEED).ok).toBe(true);

		const result = parseNewItem(submit({ text: `${atLimit}a`, quantity: '1' }), SEED);
		expect(!result.ok && result.errors.text).toBeTruthy();
	});

	it('rejects an item already on the list, ignoring case and spacing', () => {
		const result = parseNewItem(submit({ text: ' rain   JACKET', quantity: '1' }), SEED);
		expect(!result.ok && result.errors.text).toBe('That is already on the list.');
	});

	it('rejects a new item when the list is full', () => {
		const result = parseNewItem(submit({ text: 'One more', quantity: '1' }), listOf(MAX_ITEMS));
		expect(!result.ok && result.errors.text).toBeTruthy();
		expect(
			parseNewItem(submit({ text: 'One more', quantity: '1' }), listOf(MAX_ITEMS - 1)).ok
		).toBe(true);
	});

	it.each(['', '0', '-1', '1.5', 'two', String(MAX_QUANTITY + 1)])(
		'rejects the quantity %j',
		(quantity) => {
			const result = parseNewItem(submit({ text: 'Hat', quantity }), SEED);
			expect(!result.ok && result.errors.quantity).toBeTruthy();
			expect(!result.ok && result.errors.text).toBeUndefined();
		}
	);

	it('returns everything that was submitted, so nothing typed is lost', () => {
		const result = parseNewItem(submit({ text: 'Socks', quantity: '0' }), SEED);
		expect(result).toMatchObject({ ok: false, values: { text: 'Socks', quantity: '0' } });
		expect(!result.ok && Object.keys(result.errors)).toEqual(['text', 'quantity']);
	});

	it('clips what it echoes back from an oversized post', () => {
		const result = parseNewItem(submit({ text: 'a'.repeat(10_000), quantity: '1' }), SEED);
		expect(!result.ok && result.values.text.length).toBeLessThanOrEqual(200);
	});

	it('treats missing fields as empty', () => {
		const result = parseNewItem(new FormData(), SEED);
		expect(result).toMatchObject({ ok: false, values: { text: '', quantity: '' } });
	});
});

describe('refusePacking', () => {
	const item = (text: string): Item => ({ id: 1, text, quantity: 1, packed: false });

	it('refuses the kitchen sink, however it is written', () => {
		expect(refusePacking(item('Kitchen sink'))).toBeTruthy();
		expect(refusePacking(item('  KITCHEN   sink '))).toBeTruthy();
	});

	it('allows everything else', () => {
		expect(refusePacking(item('Kitchen scales'))).toBeUndefined();
		expect(refusePacking(item('Socks'))).toBeUndefined();
	});
});

describe('SEED', () => {
	// The stability audit loads the page with a new session every time, and compares the server
	// render with the hydrated one: the starting list has to be the same for everyone.
	it('has unique ids and passes its own validation rules', () => {
		expect(new Set(SEED.map((item) => item.id)).size).toBe(SEED.length);
		expect(SEED.length).toBeLessThanOrEqual(MAX_ITEMS);
		for (const item of SEED) expect(item.text.length).toBeLessThanOrEqual(MAX_TEXT);
	});

	it('includes an item the server will refuse to pack, so a rollback can be seen', () => {
		expect(SEED.some((item) => !item.packed && refusePacking(item))).toBe(true);
	});
});
