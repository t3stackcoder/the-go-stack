/**
 * The boat's rules. Pure functions with no framework in them, shared by the server, which
 * enforces them, and the page, which only needs the limits and the words to describe them.
 */

export const SEATS = 10;
export const MAX_PARTY = 4;
export const MAX_NAME = 30;
/** Requests kept in each boat's ledger. */
export const MAX_LEDGER = 6;

export interface Party {
	id: number;
	name: string;
	seats: number;
	aboard: boolean;
}

/**
 * How the server has been asked to behave, by `?server=` in the page's address. Each is a way a
 * real server lets a form down, made available on request so that it can be watched.
 */
export const MOODS = {
	prompt: { label: 'Answers', does: 'The server answers in under half a second.' },
	slow: { label: 'Is slow', does: 'The server takes two and a half seconds to answer.' },
	silent: { label: 'Never answers', does: 'The server takes the request and says nothing.' },
	broken: { label: 'Breaks', does: 'The server’s own code throws before it can save.' },
	withholding: {
		label: 'Holds back the list',
		does: 'The server saves and says so, then never sends the page the list it asks for next.'
	}
} as const;

export type Mood = keyof typeof MOODS;

/** The mood an address asks for. Anything it does not name is the ordinary one. */
export const moodOf = (url: URL): Mood => {
	const asked = url.searchParams.get('server');
	return asked !== null && Object.hasOwn(MOODS, asked) ? (asked as Mood) : 'prompt';
};

/** How a request reached the server: sent in place by script, or as a plain HTML form post. */
export type Via = 'enhanced' | 'plain';

/** What became of a request once the server had it. */
export type Outcome = 'saved' | 'turned-down' | 'broke' | 'abandoned';

export interface Entry {
	/** Counts up from 1 for each boat, so the ledger can be ordered without clocks. */
	seq: number;
	action: 'add' | 'aboard' | 'ashore' | 'remove';
	/** The party's name, as it was sent. */
	subject: string;
	via: Via;
	outcome: Outcome;
}

/** How many requests have ended each way, over the life of a boat. */
export type Tally = Record<Outcome, number>;

/** Every new boat starts with these, so the page is never empty and every visitor sees the same. */
export const SEED: readonly Party[] = [
	{ id: 1, name: 'The skipper', seats: 1, aboard: true },
	{ id: 2, name: 'Okafor', seats: 2, aboard: true },
	{ id: 3, name: 'Lindqvist', seats: 2, aboard: false },
	{ id: 4, name: 'Tanaka', seats: 1, aboard: false }
];

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');
const sameName = (a: string, b: string) => tidy(a).toLowerCase() === tidy(b).toLowerCase();

export const seatsTaken = (parties: readonly Party[]) =>
	parties.reduce((taken, party) => taken + party.seats, 0);

export type ParsedParty =
	| { ok: true; name: string; seats: number }
	| { ok: false; errors: { name?: string; seats?: string } };

/**
 * Checks a new party, as it was typed, against the boat it would join. Both fields can be turned
 * down at once, and each has its own message.
 */
export function parseParty(
	values: { name: string; seats: string },
	parties: readonly Party[]
): ParsedParty {
	const errors: { name?: string; seats?: string } = {};
	const name = tidy(values.name);
	const typed = values.seats.trim();
	const seats = Number(typed);
	const left = SEATS - seatsTaken(parties);

	if (name === '') {
		errors.name = 'Enter the name the party is under.';
	} else if (name.length > MAX_NAME) {
		errors.name = `Keep it to ${MAX_NAME} characters or fewer.`;
	} else if (parties.some((party) => sameName(party.name, name))) {
		errors.name = 'That name is already on the list.';
	}

	if (!/^\d+$/.test(typed) || seats < 1 || seats > MAX_PARTY) {
		errors.seats = `A whole number, 1 to ${MAX_PARTY}.`;
	} else if (seats > left) {
		errors.seats = left === 0 ? 'The boat is full.' : `Only ${left} left.`;
	}

	if (errors.name || errors.seats) return { ok: false, errors };
	return { ok: true, name, seats };
}

/**
 * The one rule that exists so that an optimistic change can be watched being rolled back: the
 * boat does not sail without its skipper, who can be neither put ashore nor taken off the list.
 */
export function refuseWithout(party: Party): string | undefined {
	if (sameName(party.name, SEED[0].name)) {
		return 'Refused: the boat does not sail without its skipper.';
	}
}
