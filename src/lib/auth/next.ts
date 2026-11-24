/**
 * Where a visitor goes once they have signed in: back to the page they set out from.
 *
 * The page travels in the address, as `?next=/the/page`, and so it is anybody's to write: a link
 * to this site's sign-in page can carry any `next` its author likes. Followed blindly, it would
 * send a visitor who had just typed their password here on to a page that only looks like here.
 * So only a path on this site is ever followed, and anything else is the home page.
 */

/** Where signing in leads when there is nowhere to go back to. */
export const HOME = '/team-collaborator';

/** Stands in for this site while a path is parsed. It is never fetched: `.invalid` cannot resolve. */
const SITE = 'https://site.invalid';

/** The pages a signed-in visitor is sent on from. As `next` they would send them round again. */
const SENT_ON_FROM = /^\/sign-(in|up)\/?$/;

/**
 * A `next` that is safe to follow, as a path with its query and fragment, or the home page.
 *
 * Safe is a path on this site: it begins with one `/`. Two (`//host`), or one and a backslash
 * (`/\host`), begin an address on another site to a browser, so those are refused, and so is a
 * backslash or a control character anywhere, which browsers variously drop or turn into `/`
 * before they read the address. An encoded slash or backslash in the path is refused too: Better
 * Auth turns such a path down as a place to return to, and a sign-in that carried one would fail.
 */
export function safeNext(next: string | null | undefined): string {
	if (!next?.startsWith('/') || next.startsWith('//')) return HOME;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is being refused
	if (/[\\\u0000-\u001f\u007f]/.test(next)) return HOME;

	let url: URL;
	try {
		url = new URL(next, SITE);
	} catch {
		return HOME;
	}
	// The parser's reading is the browser's. If it ends on another site, so would the visitor.
	if (url.origin !== SITE) return HOME;
	if (/%2f|%5c/i.test(url.pathname) || SENT_ON_FROM.test(url.pathname)) return HOME;

	return url.pathname + url.search + url.hash;
}

/** The query that carries a page to come back to, or nothing where it is the home page anyway. */
export function nextQuery(next: string): string {
	return next === HOME ? '' : `?next=${encodeURIComponent(next)}`;
}
