/**
 * Keeps a refreshed page from being drawn at the top before it jumps back to where it was.
 *
 * SvelteKit switches off the browser's own scroll restoring and puts the position back itself,
 * which it can only do once its JavaScript has started. The server's HTML is drawn before that,
 * from the top. Measured on a page scrolled to 1,500 px and refreshed, frame by frame: 2 frames
 * at the top in Chromium, 4 or 5 in Firefox and 4 to 6 in WebKit.
 *
 * So the job is handed back to the browser at the one moment it does it better: as the page is
 * left. The page that replaces it in this history entry, on a refresh or on the way back from
 * another site, is then put where it was by the browser as its HTML arrives. SvelteKit takes
 * over again when it starts, and lands on the same position. Measured the same way afterwards:
 * no frame at the top in any of the three, and Back and Forward as before.
 *
 * A page restored whole from the browser's back-forward cache is still running, with SvelteKit
 * in charge, so there the setting is put back to what SvelteKit expects.
 *
 * Two things it does not do:
 *
 * - In WebKit, a page that streams is still drawn at the top until it hydrates. WebKit does not
 *   put such a page back itself while the response is open, so SvelteKit still does, as before.
 * - The browser puts the page back by distance, in whatever layout it has at that moment. If
 *   the layout above then changes, the browser holds the content in view and the distance is no
 *   longer the one the page was left at. Measured once, in Firefox, when the font was settled a
 *   frame after the page had been put back: it ended 29 px further down than it was left.
 *
 * Called once by the root layout. Not for use anywhere else.
 */
/** Where the page was when it was left. Read by the script in `src/app.html`, by this name. */
const LEFT_AT = 'left-at';

export function restoreScrollOnReload() {
	addEventListener('pagehide', () => {
		history.scrollRestoration = 'auto';
		try {
			sessionStorage.setItem(LEFT_AT, JSON.stringify([location.href, scrollY]));
		} catch {
			// Storage can be unavailable. The browser still puts the page back where it can.
		}
	});

	addEventListener('pageshow', (event) => {
		if (event.persisted) history.scrollRestoration = 'manual';
	});
}
