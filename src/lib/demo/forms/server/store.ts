/**
 * Where the packing lists live: in this server process's memory, one list per anonymous visitor.
 * Nothing is written to disk, so every list resets when the server restarts.
 *
 * Everything is bounded, so the store cannot grow without limit however it is used: items per
 * list, characters per item, entries per log, and lists in total. When
 * the store is full, the list that has gone unused the longest is dropped.
 *
 * This directory is named `server`, so SvelteKit refuses to bundle it into browser code.
 */
import { MAX_ITEMS, MAX_LOG, MAX_TEXT, SEED, type Item, type Submission } from '../packing.js';

export const MAX_LISTS = 1000;

export class PackingList {
	items: Item[] = SEED.map((item) => ({ ...item }));
	/** Newest first. */
	log: Submission[] = [];

	#nextId = SEED.length + 1;
	#nextSeq = 1;

	find(id: number) {
		return this.items.find((item) => item.id === id);
	}

	/** Expects input that has already been through `parseNewItem`, which explains any refusal. */
	add(text: string, quantity: number) {
		// The store holds its own bounds rather than trusting every caller to have checked.
		if (this.items.length >= MAX_ITEMS) throw new Error('The list is full.');
		if (text.length > MAX_TEXT) throw new Error('Item text is too long.');

		const item = { id: this.#nextId++, text, quantity, packed: false };
		// Appended, never inserted: a new row at the end of the list moves nothing above it.
		this.items.push(item);
		return item;
	}

	remove(id: number) {
		this.items = this.items.filter((item) => item.id !== id);
	}

	record(entry: Omit<Submission, 'seq'>) {
		this.log = [{ ...entry, seq: this.#nextSeq++ }, ...this.log].slice(0, MAX_LOG);
	}

	/** A copy for the page, so nothing outside the store holds a reference into it. */
	snapshot() {
		return {
			items: this.items.map((item) => ({ ...item })),
			log: this.log.map((entry) => ({ ...entry }))
		};
	}
}

export class ListStore {
	// A Map iterates in insertion order. Re-inserting a list on every use keeps the least recently
	// used one first, which makes it the one to evict.
	#lists = new Map<string, PackingList>();

	constructor(readonly capacity = MAX_LISTS) {}

	get size() {
		return this.#lists.size;
	}

	/** The visitor's list, created from the seed if they have none (or it has been evicted). */
	get(visitor: string): PackingList {
		const list = this.#lists.get(visitor) ?? new PackingList();
		this.#lists.delete(visitor);
		this.#lists.set(visitor, list);

		while (this.#lists.size > this.capacity) {
			const [oldest] = this.#lists.keys();
			this.#lists.delete(oldest);
		}

		return list;
	}
}

/** The one store for this server process. */
export const lists = new ListStore();
