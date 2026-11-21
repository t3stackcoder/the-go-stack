import { expect, test, type Page } from '@playwright/test';
import {
	arriveByLink,
	auditedPages,
	expectedStatus,
	firstFrame,
	holdLateArrivals,
	MISSING_PAGE,
	measurePage,
	prepareArrival,
	readLayoutShifts,
	recordLayoutShifts,
	reportsExpectedStatus,
	revealImages,
	runsAppScripts,
	settle,
	simulateSlowDevice,
	type Arrival
} from './support.js';

/**
 * The stability audit. Every page in the app is held to the same rules, whatever mix of server
 * rendering and hydration it uses:
 *
 *   1. Nothing moves after it is first painted, on a fast machine.
 *   2. Nothing moves on a slow one either, with a late font, late scripts and late images.
 *   3. Hydration and late images leave the server-painted page exactly as it was, apart from the
 *      contents of boxes that were reserved for late content.
 *   4. Reached by a link from another page, nothing moves once its first frame is drawn.
 *   5. Reached that way, every element stays exactly where that first frame put it.
 *
 * Pages are discovered from the filesystem, so a new page is covered without being listed here.
 * The error page is audited too, both where a page is missing and where one fails.
 *
 * Rules 1, 2 and 4 read the browser's own report of what moved. Only Chromium makes one, and only
 * Chromium can slow its processor, so those checks run there alone. Rules 3 and 5 compare
 * measurements, which any browser can take, and run in Firefox and WebKit as well.
 */

/** Fails on anything the browser itself reports as broken while the page loads. */
function collectProblems(page: Page, route: string) {
	const problems: string[] = [];
	page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() !== 'error' || reportsExpectedStatus(message, route)) return;
		problems.push(`console error: ${message.text()}`);
	});
	page.on('requestfailed', (request) =>
		problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`)
	);
	return problems;
}

async function expectNoLayoutShift(page: Page) {
	const shifts = await readLayoutShifts(page);
	// The assertion is on the list rather than its sum so that a failure names what moved.
	expect(shifts, 'elements moved after they were first painted').toEqual([]);
}

/**
 * Opens another page, then follows a link to `route`, as most visits to a page begin.
 *
 * Two kinds of address cannot be reached through the router, and the browser loads them as new
 * documents: a page that ships no JavaScript, and an address the router has no page for, which
 * only the server can answer. Anywhere else a new document would mean the router had given up,
 * and the check would be auditing a second cold load under another name.
 */
async function arriveFromAnotherPage(page: Page, route: string): Promise<Arrival> {
	await prepareArrival(page);
	await page.goto(route === '/' ? '/rendering' : '/');
	await settle(page);

	const arrival = await arriveByLink(page, route);
	await settle(page);
	await revealImages(page);

	if (!arrival.clientSide && route !== MISSING_PAGE) {
		expect(
			await runsAppScripts(page),
			'the router did not handle this navigation: a page that runs JavaScript was reached by a full page load'
		).toBe(false);
	}
	return arrival;
}

for (const route of auditedPages) {
	test.describe(route, () => {
		test('nothing moves after first paint', { tag: '@chromium-only' }, async ({ page }) => {
			const problems = collectProblems(page, route);
			await recordLayoutShifts(page);

			const response = await page.goto(route);
			await settle(page);

			expect(response?.status()).toBe(expectedStatus(route));
			await expectNoLayoutShift(page);
			expect(problems).toEqual([]);
		});

		test(
			'nothing moves on a slow phone with a late font, late scripts and late images',
			{ tag: '@chromium-only' },
			async ({ page }) => {
				await page.setViewportSize({ width: 390, height: 844 });
				await simulateSlowDevice(page);
				await recordLayoutShifts(page);

				await page.goto(route);
				await settle(page);
				// Outlast the delayed font, so a font that swapped in late would be caught.
				await page.waitForTimeout(1500);
				await revealImages(page);

				await expectNoLayoutShift(page);
			}
		);

		test('hydration and late images leave the server-painted page unchanged', async ({ page }) => {
			const release = await holdLateArrivals(page);

			// The document, including anything streamed into it, has arrived. Its scripts and images
			// have not.
			await page.goto(route, { waitUntil: 'domcontentloaded' });
			test.skip(
				(await page.locator('main').count()) === 0,
				'Client-rendered only: the server paints nothing, so there is nothing for hydration to disturb.'
			);
			await firstFrame(page);
			const painted = await measurePage(page);

			release();
			await settle(page);
			await revealImages(page);
			const arrived = await measurePage(page);

			expect(arrived).toEqual(painted);
		});

		// Every shift after the first frame is counted, including those the standard metric leaves
		// out for falling within half a second of a click. That exemption is meant for movement the
		// visitor asked for, and the page they asked for is the first frame. Late content landing
		// 300 ms after the click and pushing the page down is still the page moving under them.
		test(
			'nothing moves after arriving from another page',
			{ tag: '@chromium-only' },
			async ({ page }) => {
				const problems = collectProblems(page, route);
				await recordLayoutShifts(page);

				const arrival = await arriveFromAnotherPage(page, route);

				const shifts = (await readLayoutShifts(page)).filter((shift) => shift.at >= arrival.at);
				expect(shifts, 'elements moved after the new page was first drawn').toEqual([]);
				expect(problems).toEqual([]);
			}
		);

		// The same arrival, judged by measurement instead of by the browser's shift report, which
		// ignores movement under three pixels and exists only in Chromium.
		test('arriving from another page leaves it as first drawn', async ({ page }) => {
			const arrival = await arriveFromAnotherPage(page, route);

			expect(await measurePage(page)).toEqual(arrival.firstFrame);
		});
	});
}
