/**
 * Where the boats are kept: in this server process's memory, one for each anonymous visitor.
 * Nothing is written to disk, so every boat is as it began when the server restarts.
 *
 * Everything is bounded, so the store cannot grow without limit however it is used: seats on a
 * boat, characters in a name, entries in a ledger, and boats in total. When the store is full,
 * the boat that has gone unused the longest is dropped.
 *
 * This directory is named `server`, so SvelteKit refuses to bundle it into browser code.
 */
import {
	MAX_LEDGER,
	MAX_NAME,
	SEATS,
	SEED,
	seatsTaken,
	type Entry,
	type Party,
	type Tally
} from '../boat.js';

export const MAX_BOATS = 1000;

export class Boat {
	parties: Party[] = SEED.map((party) => ({ ...party }));
	/** Newest first. */
	ledger: Entry[] = [];
	tally: Tally = { saved: 0, 'turned-down': 0, broke: 0, abandoned: 0 };
	/**
	 * Set by a save made while the server is holding the list back (see `MOODS` in ../boat.ts):
	 * the next time the page asks for its data, it is kept waiting.
	 */
	withholds = false;

	#nextId = SEED.length + 1;
	#nextSeq = 1;

	find(id: number) {
		return this.parties.find((party) => party.id === id);
	}

	/** Expects input that has already been through `parseParty`, which explains any refusal. */
	add(name: string, seats: number) {
		// The store holds its own bounds rather than trusting every caller to have checked.
		if (seatsTaken(this.parties) + seats > SEATS) throw new Error('The boat is full.');
		if (name.length > MAX_NAME) throw new Error('The name is too long.');

		const party = { id: this.#nextId++, name, seats, aboard: false };
		// Appended, never inserted: a new row at the end of the list moves nothing above it.
		this.parties.push(party);
		return party;
	}

	remove(id: number) {
		this.parties = this.parties.filter((party) => party.id !== id);
	}

	/** Writes down what became of one request. Every request that reaches an action ends here. */
	record(entry: Omit<Entry, 'seq'>) {
		this.ledger = [{ ...entry, seq: this.#nextSeq++ }, ...this.ledger].slice(0, MAX_LEDGER);
		this.tally[entry.outcome] += 1;
	}

	/** A copy for the page, so nothing outside the store holds a reference into it. */
	snapshot() {
		return {
			parties: this.parties.map((party) => ({ ...party })),
			ledger: this.ledger.map((entry) => ({ ...entry })),
			tally: { ...this.tally }
		};
	}
}

export class BoatStore {
	// A Map iterates in insertion order. Re-inserting a boat on every use keeps the least recently
	// used one first, which makes it the one to drop.
	#boats = new Map<string, Boat>();

	constructor(readonly capacity = MAX_BOATS) {}

	get size() {
		return this.#boats.size;
	}

	/** The visitor's boat, new from the seed if they have none (or it has been dropped). */
	get(visitor: string): Boat {
		const boat = this.#boats.get(visitor) ?? new Boat();
		this.#boats.delete(visitor);
		this.#boats.set(visitor, boat);

		while (this.#boats.size > this.capacity) {
			const [oldest] = this.#boats.keys();
			this.#boats.delete(oldest);
		}

		return boat;
	}
}

/** The one store for this server process. */
export const boats = new BoatStore();
