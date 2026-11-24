/**
 * What a session's browser is, in words a person recognises: "Firefox on Windows". The account
 * page lists each session by this, so that a visitor can tell their phone from their laptop, and
 * either from a sign-in that was not theirs.
 *
 * It reads the user-agent string the browser sent when the session began, and knows only the
 * handful of browsers and systems that nearly everybody uses. That string is the browser's own
 * account of itself, and anybody's to write, so this is a description and never a proof. What it
 * does not recognise it says it does not know, rather than guess: "Unknown browser".
 *
 * Two things it cannot tell, and does not pretend to. Every browser on an iPhone is Safari's
 * engine under another name, and is named here by the name it gives (Chrome on iOS says
 * `CriOS`). And an iPad says it is a Mac, on purpose, so it is called macOS.
 *
 * It runs on the server, which is where the string stays: the page is sent the words and not
 * the string.
 */

/**
 * The browsers, most specific first. Edge, Opera and Samsung Internet all say "Chrome" as well,
 * and Chrome says "Safari", so each is looked for before the one it claims to be.
 */
const BROWSERS: readonly (readonly [string, RegExp])[] = [
	['Edge', /\bEdg(e|A|iOS)?\//],
	['Opera', /\bOPR\//],
	['Samsung Internet', /\bSamsungBrowser\//],
	['Firefox', /\b(Firefox|FxiOS)\//],
	// Chrome with no window (an automated one) calls itself HeadlessChrome. It is still Chrome.
	['Chrome', /\b(Chrome|CriOS|HeadlessChrome)\//],
	['Safari', /\bVersion\/[\d.]+.*\bSafari\//]
];

/**
 * The systems, most specific first: Android says "Linux", and an iPhone says "like Mac OS X".
 */
const SYSTEMS: readonly (readonly [string, RegExp])[] = [
	['Android', /\bAndroid\b/],
	['iOS', /\b(iPhone|iPad|iPod)\b/],
	['ChromeOS', /\bCrOS\b/],
	['Windows', /\bWindows\b/],
	['macOS', /\bMacintosh\b/],
	['Linux', /\bLinux\b/]
];

const first = (list: typeof BROWSERS, text: string) =>
	list.find(([, pattern]) => pattern.test(text))?.[0];

/** A session's browser and system, from its user-agent string, or "Unknown browser". */
export function describeDevice(userAgent: string | null | undefined): string {
	if (!userAgent) return 'Unknown browser';

	const browser = first(BROWSERS, userAgent) ?? 'Unknown browser';
	const system = first(SYSTEMS, userAgent);
	return system ? `${browser} on ${system}` : browser;
}

/**
 * Where a session signed in from, as the account page shows it, or null where it is not known.
 *
 * It is not always the address the browser had. Better Auth keeps an IPv6 address as the
 * network it belongs to: the first 64 bits, with the rest set to nought and every group written
 * out in full. That is deliberate, and right for the rate limiter, since one subscriber's
 * connection has the whole of such a network to choose addresses from. Shown as it is stored it
 * reads as an address that is mostly noughts, and it is not an address at all. So it is shown
 * as what it is, in the short form a network is written in: `2001:db8:12:34::/64`.
 *
 * An address on the server's own machine is said to be that. It is what a developer's machine
 * records, and also what a deployment records when the proxy in front of it has not been told
 * to pass the visitor's address on (ADDRESS_HEADER, in the Node adapter's settings): there it
 * is a fault worth seeing for what it is, and not somebody's address.
 */
export function describeAddress(stored: string | null | undefined): string | null {
	if (!stored) return null;

	const groups = stored.split(':');
	// Not IPv6 as Better Auth writes it: an IPv4 address, or something this does not know.
	if (groups.length !== 8) return stored.startsWith('127.') ? OWN_MACHINE : stored;

	// The network of the loopback address, `::1`, is all noughts.
	if (groups.every((group) => /^0+$/.test(group))) return OWN_MACHINE;
	if (!groups.slice(4).every((group) => /^0+$/.test(group))) return stored;

	const network = groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ''));
	return `${network.join(':')}::/64`;
}

const OWN_MACHINE = "The server's own machine";
