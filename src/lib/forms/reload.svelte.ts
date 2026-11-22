/**
 * Loads a page's data again where the visitor stands, without costing them the page if it cannot
 * be had. The form helper beside this file (./save-form.svelte.ts) asks for it after every
 * answer, and the root layout asks for it when a page is come back to by Back or Forward.
 */
import { refreshAll } from '$app/navigation';

/** How long one reload is waited for, in milliseconds. */
const LIMIT = 8000;

/**
 * Loads the page's data again, and resolves when a reload that began after this call has ended:
 * with true if it is on the page, and false if it failed or was given up at the time limit.
 *
 * SvelteKit lets a later reload take over from one in progress, and the earlier one's promise
 * then resolves with nothing new on the page. Measured with two rows of a list ticked 100 ms
 * apart: the first tick flipped back for a moment, because its reload had been dropped for the
 * second's. So reloads asked for here are run one after another.
 *
 * A caller waits for the first to begin after it asked, and no longer. It once waited until no
 * more were wanted. Measured with a reload that took 400 ms and a tick pressed every 400 ms:
 * every answer was held until the ticking stopped, seconds on, because each new one kept the
 * queue from emptying.
 */
let reloading: Promise<boolean> | undefined;
let queued: Promise<boolean> | undefined;

export function reloadData(): Promise<boolean> {
	// One that has yet to begin will begin after this call too, so it will do.
	if (queued) return queued;

	const begin = () => {
		queued = undefined;
		const mine: Promise<boolean> = reloadOnce().finally(() => {
			if (reloading === mine) reloading = undefined;
		});
		return (reloading = mine);
	};

	return reloading ? (queued = reloading.then(begin, begin)) : begin();
}

/**
 * How many reloads have begun, and how many have landed: put the page's data on the page. A
 * form that is behind the server knows by the second when it has caught up.
 */
let begun = 0;
let landings = $state(0);

/** The count of reloads that have landed, for a form to tell whether one has since it fell behind. */
export const reloads = {
	get landed() {
		return landings;
	}
};

/**
 * One reload, and whether it landed.
 *
 * It is given eight seconds, the time a form is, and is then left behind. One after another, a reload that
 * never ended would hold up every one after it. Measured with the first reload's request left
 * unanswered: the next item added to a list was not on the page twelve seconds later. The next
 * reload takes over from one left behind, as SvelteKit allows.
 */
function reloadOnce(): Promise<boolean> {
	const mine = (begun += 1);

	return new Promise<boolean>((resolve, reject) => {
		const over = () => {
			clearTimeout(timer);
			// It may have asked for nothing, as a page with no data of its own does. The next
			// request for this page's data is then somebody else's, and not to be stood in front of.
			if (expected === reload) expected = undefined;
		};
		const end = (landed: boolean) => {
			over();
			resolve(landed);
		};
		const timer = setTimeout(end, LIMIT, false);
		const reload: Reload = { ...pageAddress(), failed: () => end(false) };

		watchFor(reload);
		refreshAll().then(
			() => {
				// One that was left behind and answers after all still lands, unless another has
				// begun since: that one took over from it, and SvelteKit dropped what this one brought.
				if (mine === begun) landings += 1;
				end(true);
			},
			(thrown: Error) => {
				over();
				reject(thrown);
			}
		);
	});
}

/**
 * Stands between SvelteKit and a reload that fails.
 *
 * Loading a page's data is SvelteKit's, and it has one answer to a load that fails: the error
 * page, in place of the page. After a form that is the wrong answer. The server has answered by
 * then, so the save is made or the refusal is known, and only the request for the data went
 * wrong. Measured with the connection cut between the two: the visitor was shown "Error 500"
 * for a save that had worked, and after a refusal lost the form and everything typed into it.
 *
 * SvelteKit offers no way to try a reload and keep the page if it fails. It does ask for the
 * data through `window.fetch`, and says it does so in order that the page's own `fetch` is
 * used. So the page's `fetch` is given this to do, and nothing else: when the request for a
 * reload asked for here fails, SvelteKit is never told. To SvelteKit that reload is one that
 * has not ended, and such a one is left behind already (see `reloadOnce`). The page stays as
 * it is, the form is told at once that its data did not come, and the next reload starts
 * afresh. A reload that works, and every other request the page makes, passes straight through.
 *
 * What counts as failing: no answer, an answer with an error status, or one that is not the
 * JSON SvelteKit expects (a sign-in page, a proxy's own). An error raised by a `load` function
 * is none of these. It travels inside a good answer, and is SvelteKit's to show.
 *
 * It rests on two things SvelteKit does not promise: the address it asks for data at, and that
 * it asks through `window.fetch`. If either changes this does nothing, and a failed reload is
 * the error page again.
 */
interface Reload {
	/** The page the reload is for, as its path and its query. */
	path: string;
	query: string;
	/** Called when the request for its data fails. */
	failed: () => void;
}

const DATA = '/__data.json';

/** The reload whose request has yet to be made. */
let expected: Reload | undefined;
let watching = false;

const withoutSlash = (path: string) => path.replace(/\/$/, '');

function pageAddress() {
	return {
		path: withoutSlash(location.pathname),
		query: new URLSearchParams(location.search).toString()
	};
}

/** Whether a request is the one SvelteKit makes for the data of a page. */
function asksForDataOf(page: Reload, input: RequestInfo | URL): boolean {
	const url = new URL(input instanceof Request ? input.url : input, location.href);
	if (url.origin !== location.origin || !url.pathname.endsWith(DATA)) return false;

	// SvelteKit adds parameters of its own to the page's query.
	for (const name of Array.from(url.searchParams.keys())) {
		if (name.startsWith('x-sveltekit-')) url.searchParams.delete(name);
	}

	return (
		url.pathname.slice(0, -DATA.length) === page.path && url.searchParams.toString() === page.query
	);
}

function watchFor(reload: Reload) {
	expected = reload;
	if (watching) return;
	watching = true;

	const send = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const reload = expected;
		if (!reload || !asksForDataOf(reload, input)) return send(input, init);

		// One request a reload. The next request for this page's data is somebody else's.
		expected = undefined;

		try {
			const answer = await send(input, init);
			if (answer.ok && answer.headers.get('content-type')?.includes('application/json')) {
				return answer;
			}
		} catch {
			// No answer at all. Nothing here is the site's fault to record: the form says that
			// the page is behind, and the connection is the visitor's to see to.
		}

		reload.failed();
		return new Promise<Response>(() => {});
	};
}
