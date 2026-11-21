import { expect, test, type Page } from '@playwright/test';
import { settle } from './support.js';

/**
 * Security headers and the content security policy.
 *
 * The pages below are one of each kind, because each kind gets its protection by a different
 * route: a prerendered page is a file served from disk, with its policy in a <meta> tag; a page
 * rendered per request carries its policy in a header. The stability audit visits every page
 * with the policy in force and fails on any console error, so a page the policy breaks is
 * caught there.
 */
const PRERENDERED = '/';
const RENDERED_PER_REQUEST = '/forms';
const STREAMED = '/data/streaming';

const EVERY_RESPONSE = {
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'cross-origin-opener-policy': 'same-origin',
	'permissions-policy': 'camera=(), geolocation=(), microphone=()'
};

for (const [kind, path] of Object.entries({
	'a prerendered page': PRERENDERED,
	'a page rendered per request': RENDERED_PER_REQUEST,
	'a static file': '/favicon.svg',
	'an endpoint': '/api/catalog',
	'a missing page': '/no-page-lives-here'
})) {
	test(`${kind} is sent with the security headers`, async ({ request }) => {
		const response = await request.get(path);

		expect(response.headers()).toMatchObject(EVERY_RESPONSE);
	});
}

test('a page rendered per request carries its policy in a header', async ({ request }) => {
	const response = await request.get(RENDERED_PER_REQUEST);
	const policy = response.headers()['content-security-policy'];

	expect(policy).toContain("default-src 'self'");
	expect(policy).toContain("frame-ancestors 'none'");
	// Inline scripts are allowed by hash or nonce only.
	expect(policy).toMatch(/script-src 'self' 'sha256-[^']+' 'nonce-[^']+'(;|$)/);
	expect(policy).toMatch(/style-src-elem 'self' [^;]*'nonce-[^']+'/);
});

test('a prerendered page carries its policy in a meta tag', async ({ request }) => {
	const response = await request.get(PRERENDERED);
	expect(response.headers()['content-security-policy']).toBeUndefined();

	const html = await response.text();
	const policy = /<meta http-equiv="content-security-policy" content="([^"]+)"/.exec(html)?.[1];

	expect(policy).toContain("default-src 'self'");
	// Two hashes: the boot script in app.html, and the script SvelteKit writes to start the app.
	expect(policy).toMatch(/script-src 'self' 'sha256-[^']+' 'sha256-[^']+'(;|$)/);
	expect(policy).toMatch(/style-src-elem 'self' [^;]*'sha256-[^']+'/);
});

declare global {
	interface Window {
		__injected?: true;
	}
}

/** Adds an inline script to the page, as injected markup would, and reports whether it ran. */
function injectedScriptRuns(page: Page) {
	return page.evaluate(() => {
		const script = document.createElement('script');
		script.textContent = 'window.__injected = true';
		document.head.append(script);
		return window.__injected === true;
	});
}

for (const [kind, path] of Object.entries({
	'a prerendered page': PRERENDERED,
	'a page rendered per request': RENDERED_PER_REQUEST
})) {
	test(`${kind} refuses an inline script it did not ship`, async ({ page }) => {
		await page.goto(path);
		await settle(page);

		expect(await injectedScriptRuns(page)).toBe(false);
	});
}

test('the policy lets the page’s own scripts and styles through', async ({ page }) => {
	const refused: string[] = [];
	await page.exposeFunction('reportRefusal', (what: string) => refused.push(what));
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (event) => {
			void (window as unknown as { reportRefusal: (what: string) => void }).reportRefusal(
				`${event.violatedDirective}: ${event.blockedURI}`
			);
		});
	});

	// The streamed page is the hard case: SvelteKit adds an inline script for each late value.
	for (const path of [PRERENDERED, RENDERED_PER_REQUEST, STREAMED, '/stability/images']) {
		await page.goto(path);
		await settle(page);
	}
	// The boot script ran: it is what answers a click on the theme control.
	await page.getByRole('button', { name: 'Dark theme' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

	expect(refused).toEqual([]);
});
