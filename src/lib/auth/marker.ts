/**
 * The marker: a cookie that says "this browser is signed in", and the few things about the person
 * signed in that a page must know before its first frame: whether they may open the admin area,
 * and whether they have asked for the readout. Nothing else.
 *
 * The session's own cookie cannot be read by script, which is the point of it, and most of this
 * site's pages are built once and served to everybody, so the server cannot draw the header
 * differently for a visitor who is signed in. The marker is what the page reads instead. The
 * server sets it whenever it sets the session cookie and clears it whenever it clears that one
 * (src/lib/server/auth/cookies.ts), and the script in src/app.html puts what it says on <html>
 * before the first frame: `data-signed-in`, "yes" or "no", `data-admin` for someone who may open
 * the admin area, and `data-readout` for someone who has switched the readout on. The
 * stylesheets read them there. No `data-signed-in` at all means nothing has said, which is a
 * browser without JavaScript, and the header then shows a control that is right either way
 * (src/lib/auth/AccountButton.svelte).
 *
 * It is a hint, and holds nothing secret. Forged, it shows the avatar, the admin button or the
 * readout to someone the server will still turn away: every page and action under /admin checks
 * the role itself (src/lib/server/auth/access.ts). Stale, it is corrected by the first request
 * that looks the session up, and by the account menu when it finds no session.
 *
 * Its name and its values are written three times: here, in src/lib/server/auth/cookies.ts
 * through this file, and in the boot script, which can import nothing.
 * src/lib/auth/marker.test.ts checks the third.
 */
export const MARKER = 'signed-in';

/**
 * What the marker can say. Absent, it says nobody is signed in. Present, it is the flags that
 * hold for the person, joined by `FLAG_SEPARATOR` in the order they are listed here (`admin`,
 * `readout`, `admin.readout`), or `1` when none does.
 */
export const MARKED = {
	/** Signed in, and none of the flags below holds. */
	signedIn: '1',
	/** A flag: their role lets them open the admin area. */
	admin: 'admin',
	/** A flag: they have switched the readout on (src/lib/hud/Hud.svelte). */
	readout: 'readout'
} as const;

/** Between the flags. A cookie's value may hold a dot as it stands, where a comma would be escaped. */
export const FLAG_SEPARATOR = '.';

/** What the marker says, or undefined if this browser has none. Only in the browser. */
export function readMarker(): string | undefined {
	return /(^|; )signed-in=([^;]*)/.exec(document.cookie)?.[2];
}

/**
 * Puts what the marker says on <html>, as the boot script did when the page loaded. That script
 * runs once for each full page load, so after a move within the site (a sign-in that ends in a
 * redirect, a sign-out) it is this that brings the header up to date. The two must agree.
 */
export function showMarker(): void {
	const root = document.documentElement;
	const marker = readMarker();
	const flags = marker?.split(FLAG_SEPARATOR) ?? [];
	root.dataset.signedIn = marker !== undefined ? 'yes' : 'no';
	if (flags.includes(MARKED.admin)) root.dataset.admin = '';
	else delete root.dataset.admin;
	if (flags.includes(MARKED.readout)) root.dataset.readout = '';
	else delete root.dataset.readout;
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
