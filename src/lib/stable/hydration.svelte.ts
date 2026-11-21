/**
 * Whether the app has finished hydrating.
 *
 * It is `false` on the server and during the first client render, so that first render produces
 * exactly the HTML the server sent. The root layout flips it once, after mount. It stays `true`
 * for the rest of the session, so content that waits on it appears immediately on client-side
 * navigations, where there is no server HTML to match.
 *
 * This is the one sanctioned way to render something the server cannot know (stored state,
 * viewport, local time). Reading `browser` from `$app/env` during render instead makes the client's
 * first render differ from the server's, which is the cause of hydration flicker.
 */
let done = $state(false);

export const hydration = {
	get done() {
		return done;
	}
};

/** Called once by the root layout. Not for use anywhere else. */
export function markHydrated() {
	done = true;
}
