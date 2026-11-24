/**
 * Who is signed in, for the account menu in the header: a name and an address, asked of the
 * server the first time they are wanted and kept for as long as the page lives.
 *
 * The header is on every page, most of which are built once for everybody and know nothing of
 * the visitor, so this cannot come with the page. It is asked for when the menu's button is
 * first pointed at or reached by keyboard, which is normally long enough before the menu opens
 * for the answer to be there. This is all the script the header has.
 */
import { resolve } from '$app/paths';
import { dropMarker } from './marker.js';

export interface Who {
	name: string;
	email: string;
}

let who = $state.raw<Who>();
/** The question, while it is being asked or once it has been answered. */
let asked: Promise<void> | undefined;

async function look(): Promise<void> {
	// The site's own address for it, which says a name and an address and nothing more. Better
	// Auth's answers with the session's token as well: see src/routes/account/who/+server.ts.
	const response = await fetch(resolve('/account/who'), {
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`Asked who is signed in, and was answered ${response.status}.`);

	const answer = (await response.json()) as Who | null;
	// Nobody: the server's whole answer is `null`. The marker said otherwise, so it was stale, and
	// the header goes back to offering a way to sign in.
	if (answer === null) return dropMarker();

	who = { name: answer.name, email: answer.email };
}

export const account = {
	/** Who is signed in, once the server has said. Until then, and if it has not, undefined. */
	get who() {
		return who;
	},

	/**
	 * Asks the server who is signed in, once. A question that fails is forgotten, so that the next
	 * time the button is pointed at it is asked again. The failure itself is not this page's to
	 * record or to announce: it is the visitor's connection, the menu still works, and the two
	 * lines it would have filled stay as the placeholders they were.
	 */
	ask(): void {
		if (asked) return;
		asked = look().catch(() => {
			asked = undefined;
		});
	},

	/** Forgets the answer, for when it has just been changed: the account page, after a new name. */
	forget(): void {
		who = undefined;
		asked = undefined;
	}
};
