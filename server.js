/**
 * The production entry point: `node server.js`, after `pnpm build`.
 *
 * It starts the server the Node adapter built, unchanged, and adds the security headers that
 * belong on every response. They are set here, and not in src/hooks.server.ts, because
 * prerendered pages and static files are served straight from disk and never pass through a
 * hook: a header set there would be missing from most of the site.
 *
 * Two things are deliberately not here:
 *
 * - The content security policy. It needs a hash or a nonce per page, so SvelteKit writes it:
 *   as a header on pages rendered per request, and as a <meta> tag in prerendered ones. It is
 *   configured in vite.config.ts.
 * - Strict-Transport-Security. This server speaks plain HTTP to whatever terminates TLS in front
 *   of it, and that is where a promise about HTTPS has to be made.
 */

const HEADERS = {
	// Browsers must not guess a file's type from its contents.
	'X-Content-Type-Options': 'nosniff',
	// No other site may show this one in a frame. The policy's `frame-ancestors` says the same
	// for pages rendered per request, but it cannot be given in a <meta> tag, so prerendered
	// pages rely on this.
	'X-Frame-Options': 'DENY',
	// Other sites are told which site a visitor came from, never which page.
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	// A window this site opens, or is opened from, gets no handle on it.
	'Cross-Origin-Opener-Policy': 'same-origin',
	// The site uses none of these, so nothing running in it may ask for them.
	'Permissions-Policy': 'camera=(), geolocation=(), microphone=()'
};

// The build only exists after `pnpm build`, so its address is assembled here and not written as
// a static import, which the type check would try to follow.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- typed by the cast: the build has no types of its own
const { server } = /** @type {{ server: import('node:http').Server }} */ (
	await import(new URL('./build/index.js', import.meta.url).href)
);

// Ahead of the adapter's own listener, because that one may start writing the response at once.
server.prependListener('request', (_request, response) => {
	for (const [name, value] of Object.entries(HEADERS)) response.setHeader(name, value);
});
