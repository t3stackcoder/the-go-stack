import { expect, test, type Page } from '@playwright/test';
import { settle } from './support.js';

/**
 * The site makes specific, checkable claims about itself. These tests hold it to them, so the
 * copy cannot go on saying something the code has stopped doing.
 */

test('the server-only page downloads no JavaScript', async ({ page }) => {
	const scripts: string[] = [];
	page.on('request', (request) => {
		if (request.resourceType() === 'script') scripts.push(request.url());
	});

	await page.goto('/rendering/server');
	await settle(page);

	expect(scripts).toEqual([]);
	await expect(page.getByText('Server-rendered HTML. No JavaScript is running.')).toBeVisible();
});

test('the client-only page sends an empty shell and builds the page in the browser', async ({
	page,
	request
}) => {
	const html = await (await request.get('/rendering/client')).text();
	expect(html).not.toContain('Client only');

	await page.goto('/rendering/client');
	await expect(page.getByRole('heading', { level: 1, name: 'Client only' })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: '$' })).toHaveCount(12);
});

test('the three rendering modes show the same catalog', async ({ page }) => {
	const catalogs: string[][] = [];
	for (const mode of ['server', 'hybrid', 'client']) {
		await page.goto(`/rendering/${mode}`);
		const products = page.getByRole('listitem').filter({ hasText: '$' });
		await expect(products).toHaveCount(12);
		catalogs.push(await products.allInnerTexts());
	}

	expect(catalogs[1]).toEqual(catalogs[0]);
	expect(catalogs[2]).toEqual(catalogs[0]);
});

const READOUT = { name: 'Live measurements of this page' };

/** The value shown under one of the readout's labels. */
const readoutValue = (page: Page, label: string) =>
	page
		.getByRole('complementary', READOUT)
		.getByText(label, { exact: true })
		.locator('xpath=following-sibling::dd');

test('the readout reports this page', async ({ page }) => {
	await page.goto('/');
	await settle(page);

	await expect(readoutValue(page, 'JS sent')).toHaveText(/^\d+\.\d KB$/);
	await expect(readoutValue(page, 'Hydrated')).toHaveText(/^\d+ ms$/);
	await expect(readoutValue(page, 'Server')).toHaveText('prerendered');
});

test('the readout shows a layout shift of zero', { tag: '@chromium-only' }, async ({ page }) => {
	await page.goto('/');
	await settle(page);

	await expect(readoutValue(page, 'Shift')).toHaveText('0');
});

// The other half of the same promise: where a browser cannot measure something, the readout
// says nothing about it. A zero there would be a claim with nothing behind it.
test('the readout leaves out what the browser cannot measure', async ({ page, browserName }) => {
	await page.goto('/');
	await settle(page);
	await expect(readoutValue(page, 'JS sent')).toBeVisible();

	const measurable = await page.evaluate(() => ({
		Shift: PerformanceObserver.supportedEntryTypes.includes('layout-shift'),
		Response:
			PerformanceObserver.supportedEntryTypes.includes('event') &&
			'interactionId' in PerformanceEventTiming.prototype
	}));
	// Chromium measures both. If it stopped, every check below would pass by showing nothing.
	if (browserName === 'chromium') expect(measurable).toEqual({ Shift: true, Response: true });

	for (const [label, supported] of Object.entries(measurable)) {
		await expect(readoutValue(page, label)).toHaveCount(supported ? 1 : 0);
	}
});

test('the readout measures how quickly the page responds', async ({ page }) => {
	await page.goto('/');
	await settle(page);
	test.skip(
		(await readoutValue(page, 'Response').count()) === 0,
		'This browser does not report interaction timings, and the readout says nothing about them.'
	);

	// Nothing has been clicked yet, so there is nothing to report, and it does not say zero.
	await expect(readoutValue(page, 'Response')).toHaveText('–');

	// A click handler that holds the page for 150 ms. The figure must show it.
	await page.evaluate(() =>
		document.addEventListener('click', () => {
			const until = performance.now() + 150;
			while (performance.now() < until);
		})
	);
	await page.getByRole('button', { name: 'Dark theme' }).click();

	await expect
		.poll(async () => parseInt((await readoutValue(page, 'Response').textContent()) ?? ''))
		.toBeGreaterThanOrEqual(150);
});

test('the readout reports a client-side navigation', async ({ page }) => {
	await page.goto('/');
	await settle(page);
	await page.getByRole('link', { name: 'Start with chapter 01' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'One page, three ways' })).toBeVisible();

	await expect(readoutValue(page, 'Navigated')).toHaveText(/^\d+ ms$/);
	await expect(readoutValue(page, 'Fetched')).toHaveText(/^\+\d+\.\d KB$/);
});

test('pages rendered per request are sent compressed', async ({ request }) => {
	const response = await request.get('/rendering/hybrid', {
		headers: { 'accept-encoding': 'br' }
	});

	expect(response.headers()['content-encoding']).toBe('br');
	expect(await response.text()).toContain('Server and client');
});

// Compression must not cost the streaming it sits in front of: the start of the page has to be
// sent at once, not held until the slowest data is ready.
test('a compressed page still arrives in pieces', async ({ baseURL }) => {
	const response = await fetch(`${baseURL}/data/streaming`, {
		headers: { 'accept-encoding': 'br' }
	});
	const reader = response.body!.getReader();

	await reader.read();
	const firstPiece = performance.now();
	while (!(await reader.read()).done);
	const lastPiece = performance.now();

	expect(response.headers.get('content-encoding')).toBe('br');
	// The slowest panel on that page takes two seconds; the first piece must not wait for it.
	expect(lastPiece - firstPiece).toBeGreaterThan(1000);
});

test.describe('the break-it demo', () => {
	test('moves the text without a reservation, and not with one', async ({ page }) => {
		await page.goto('/stability');
		await settle(page);

		await page.getByRole('button', { name: 'Deliver the late content' }).click();

		const moved = page.getByRole('paragraph').filter({ hasText: 'Text below moved' });
		// The first panel has no space reserved, so its text is pushed down by the notice's height.
		await expect(moved.nth(0)).toContainText(/[1-9]\d* px/);
		await expect(moved.nth(1)).toContainText('0 px');
	});

	test(
		'is recorded by the readout as a layout shift',
		{ tag: '@chromium-only' },
		async ({ page }) => {
			await page.goto('/stability');
			await settle(page);
			await expect(readoutValue(page, 'Shift')).toHaveText('0');

			await page.getByRole('button', { name: 'Deliver the late content' }).click();

			await expect(readoutValue(page, 'Shift')).not.toHaveText('0');
		}
	);
});
