import { describe, expect, it } from 'vitest';
import { MAX_ITEMS, MAX_LOG, MAX_TEXT, SEED } from '../packing.js';
import { ListStore, PackingList } from './store.js';

describe('PackingList', () => {
	it('starts from a copy of the seed, not the seed itself', () => {
		const list = new PackingList();
		expect(list.items).toEqual(SEED);

		list.items[0].packed = !list.items[0].packed;
		expect(new PackingList().items).toEqual(SEED);
	});

	it('appends new items with ids that do not collide with the seed', () => {
		const list = new PackingList();
		const item = list.add('Sun cream', 1);

		expect(list.items.at(-1)).toBe(item);
		expect(SEED.map((seeded) => seeded.id)).not.toContain(item.id);
		expect(list.add('Hat', 1).id).toBeGreaterThan(item.id);
	});

	it('refuses to grow past its limits, whatever the caller checked', () => {
		const list = new PackingList();
		expect(() => list.add('a'.repeat(MAX_TEXT + 1), 1)).toThrow();

		while (list.items.length < MAX_ITEMS) list.add(`Item ${list.items.length}`, 1);
		expect(() => list.add('One too many', 1)).toThrow();
		expect(list.items).toHaveLength(MAX_ITEMS);
	});

	it('removes by id, and removing twice is harmless', () => {
		const list = new PackingList();
		list.remove(SEED[0].id);
		list.remove(SEED[0].id);
		expect(list.find(SEED[0].id)).toBeUndefined();
		expect(list.items).toHaveLength(SEED.length - 1);
	});

	it('keeps only the newest log entries, newest first', () => {
		const list = new PackingList();
		for (let index = 0; index < MAX_LOG + 3; index++) {
			list.record({ action: 'add', via: 'plain', outcome: 'saved', subject: `${index}` });
		}

		expect(list.log).toHaveLength(MAX_LOG);
		expect(list.log.map((entry) => entry.seq)).toEqual(
			Array.from({ length: MAX_LOG }, (_, index) => MAX_LOG + 3 - index)
		);
	});

	it('hands out snapshots that cannot change the store', () => {
		const list = new PackingList();
		const snapshot = list.snapshot();
		snapshot.items[0].text = 'Changed';
		snapshot.items.pop();

		expect(list.items).toEqual(SEED);
	});
});

describe('ListStore', () => {
	it('gives each visitor their own list, and the same one each time', () => {
		const store = new ListStore();
		const mine = store.get('a');
		mine.remove(SEED[0].id);

		expect(store.get('a')).toBe(mine);
		expect(store.get('b').items).toEqual(SEED);
	});

	it('never holds more lists than its capacity', () => {
		const store = new ListStore(3);
		for (const visitor of ['a', 'b', 'c', 'd', 'e']) store.get(visitor);
		expect(store.size).toBe(3);
	});

	it('evicts the list that has gone unused the longest', () => {
		const store = new ListStore(2);
		const a = store.get('a');
		const b = store.get('b');
		store.get('a'); // a is now more recent than b
		store.get('c'); // so b is the one to go

		expect(store.get('a')).toBe(a);
		expect(store.get('b')).not.toBe(b);
	});
});
