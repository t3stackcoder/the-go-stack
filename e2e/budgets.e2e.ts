import { expect, test } from '@playwright/test';
import { auditedPages, settle } from './support.js';

/**
 * Performance budgets. A page that gets heavier fails here, instead of nobody noticing.
 *
 * Every budget is a count of bytes or of requests. There is no budget on time: on a shared
 * machine timings vary more from run to run than a regression would move them, and a bound loose
 * enough to hold would catch nothing.
 *
 * What is measured is what crossed the network on a first visit, compressed as the server sent
 * it. That depends on the server and not on the browser, so it is measured once, in Chromium.
 */

/**
 * What each page weighed when it was last measured, in kilobytes as sent (Brotli): the JavaScript
 * the page downloads, and its HTML, which includes the inlined stylesheet.
 *
 * A page may grow by HEADROOM over these figures before its test fails. When a change needs more
 * than that, measure again (the failure message gives the new figures), decide whether the
 * weight is worth it, and record the new baseline here in the same change.
 */
const BASELINE: Record<string, { js: number; html: number }> = {
	// Measured 2026-11-21 on the production build.
	'/': { js: 47.8, html: 11.1 },
	'/data': { js: 50.3, html: 13.3 },
	'/data/search': { js: 51.1, html: 15.4 },
	'/data/streaming': { js: 54.6, html: 15.3 },
	'/data/typed': { js: 50.7, html: 13.7 },
	'/forms': { js: 59.7, html: 21.6 },
	'/reactivity': { js: 56.4, html: 17 },
	'/rendering': { js: 50.3, html: 12.4 },
	'/rendering/client': { js: 48.3, html: 9.4 },
	'/rendering/hybrid': { js: 49.6, html: 13.2 },
	// Ships no JavaScript at all. Zero with headroom is still zero.
	'/rendering/server': { js: 0, html: 11.7 },
	'/stability': { js: 57.8, html: 19.4 },
	'/stability/failure': { js: 45.4, html: 11 },
	'/stability/images': { js: 52.5, html: 17 },
	'/tradeoffs': { js: 49.2, html: 12.6 },
	'/verdict': { js: 49.6, html: 12.6 },
	'/no-page-lives-here': { js: 45.4, html: 11 }
};

/** Room for small changes, and for pages rendered per request, whose HTML differs a little each time. */
const HEADROOM = 1.1;

const kilobytes = (bytes: number) => Math.round(bytes / 102.4) / 10;

for (const route of auditedPages) {
	test(`${route} stays within its budget`, { tag: '@chromium-only' }, async ({ page }) => {
		const finished: { path: string; bytes: Promise<number> }[] = [];
		page.on('requestfinished', (request) =>
			finished.push({
				path: new URL(request.url()).pathname,
				bytes: request.sizes().then((sizes) => sizes.responseBodySize)
			})
		);

		await page.goto(route);
		await settle(page);

		// Files are told apart by their address. The browser's own label for a request is not
		// reliable: a module that was preloaded is reported as a script in some cases and not others.
		const sent = async (matches: (path: string) => boolean) => {
			const sizes = await Promise.all(
				finished.filter(({ path }) => matches(path)).map(({ bytes }) => bytes)
			);
			return kilobytes(sizes.reduce((total, size) => total + size, 0));
		};
		const requested = (extension: string) =>
			finished.map(({ path }) => path).filter((path) => path.endsWith(extension));

		const measured = {
			js: await sent((path) => path.startsWith('/_app/immutable/') && path.endsWith('.js')),
			html: await sent((path) => path === route)
		};

		const baseline = BASELINE[route];
		if (!baseline) {
			throw new Error(
				`${route} has no budget. It weighs ${JSON.stringify(measured)} (KB, as sent). ` +
					`Record that in BASELINE in e2e/budgets.e2e.ts.`
			);
		}

		expect(measured.js, `JavaScript sent (KB). Baseline ${baseline.js}`).toBeLessThanOrEqual(
			baseline.js * HEADROOM
		);
		expect(measured.html, `HTML sent (KB). Baseline ${baseline.html}`).toBeLessThanOrEqual(
			baseline.html * HEADROOM
		);

		// One font file: the Latin Inter. A second would mean a page has started using characters
		// from another range, or another face has been added.
		expect(requested('.woff2')).toHaveLength(1);

		// No stylesheet request: the styles are inlined into the HTML so that first paint does not
		// wait for a second round trip. Past `inlineStyleThreshold` (vite.config.ts) SvelteKit
		// quietly goes back to linking the file, and this is what notices.
		expect(requested('.css')).toEqual([]);
	});
}
