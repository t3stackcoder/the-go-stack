/**
 * The marker: a cookie that says "this browser is signed in" and nothing else.
 *
 * The session's own cookie cannot be read by script, which is the point of it, and most of this
 * site's pages are built once and served to everybody, so the server cannot draw the header
 * differently for a visitor who is signed in. The marker is what the page reads instead. The
 * server sets it whenever it sets the session cookie and clears it whenever it clears that one
 * (src/lib/server/auth/cookies.ts), and the script in src/app.html puts what it says on <html>
 * before the first frame, as `data-signed-in`: "yes" or "no". The header's stylesheet reads it
 * there. No attribute at all means nothing has said, which is a browser without JavaScript, and
 * the header then shows a control that is right either way (src/lib/auth/AccountButton.svelte).
 *
 * It is a hint, and holds nothing secret: it is the same for everyone. Forged, it shows the
 * avatar to someone the server will still turn away. Stale, it is corrected by the first request
 * that looks the session up, and by the account menu when it finds no session.
 *
 * Its name is written three times: here, in src/lib/server/auth/cookies.ts through this file,
 * and in the boot script, which can import nothing. src/lib/auth/marker.test.ts checks the third.
 */
export const MARKER = 'signed-in';

/** Whether this browser holds the marker. Only in the browser: there is no `document` elsewhere. */
export function hasMarker(): boolean {
	return document.cookie.split('; ').some((cookie) => cookie.startsWith(`${MARKER}=`));
}

/**
 * Puts what the marker says on <html>, as the boot script did when the page loaded. That script
 * runs once for each full page load, so after a move within the site (a sign-in that ends in a
 * redirect, a sign-out) it is this that brings the header up to date. The two must agree.
 */
export function showMarker(): void {
	document.documentElement.dataset.signedIn = hasMarker() ? 'yes' : 'no';
}

/**
 * Forgets the marker, for when the server has said there is no session after all. The server's
 * own answer clears it too, where it knows to; this is for the answers that only say "nobody".
 */
export function dropMarker(): void {
	// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API it would have instead answers later, and the attribute is set from the cookie on the next line
	document.cookie = `${MARKER}=; Path=/; Max-Age=0; SameSite=Lax`;
	showMarker();
}
