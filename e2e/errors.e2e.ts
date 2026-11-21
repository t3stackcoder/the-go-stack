import { expect, test, type Page } from '@playwright/test';
import { expectDark, expectLight, MISSING_PAGE, settle } from './support.js';

/**
 * What a visitor sees when a page cannot be shown. The stability audit already holds these pages
 * to the rules every page follows; these tests cover what is particular to an error: the status,
 * the frame around it, the theme, and what the message is allowed to say.
 */

const FAILING_PAGE = '/stability/failure';

/** What the failing page's server code throws. It is written for the log and must stay there. */
const THROWN = 'threw on purpose';
const SAFE_MESSAGE = 'Something went wrong on our side. It has been recorded.';

declare global {
	interface Window {
		__beacon?: string;
	}
}

/** The frame every page has: the chapter navigation above and the readout below. */
async function expectSiteFrame(page: Page) {
	await expect(page.getByRole('navigation', { name: 'Chapters' })).toBeVisible();
	await expect(
		page.getByRole('complementary', { name: 'Live measurements of this page' })
	).toBeVisible();
}

test.describe('a page that does not exist', () => {
	test('answers 404 inside the site frame', async ({ page }) => {
		const response = await page.goto(MISSING_PAGE);

		expect(response?.status()).toBe(404);
		await expect(
			page.getByRole('heading', { level: 1, name: 'There is no page at this address' })
		).toBeVisible();
		await expect(page.getByText('Error 404')).toBeVisible();
		await expectSiteFrame(page);
	});

	test('leads back to the start', async ({ page }) => {
		await page.goto(MISSING_PAGE);
		await settle(page);
		await page.getByRole('link', { name: 'Back to the start' }).click();

		await expect(
			page.getByRole('heading', { level: 1, name: 'Is SvelteKit worth it?' })
		).toBeVisible();
	});
});

test.describe('a page whose server code throws', () => {
	test('answers 500 inside the site frame', async ({ page }) => {
		const response = await page.goto(FAILING_PAGE);

		expect(response?.status()).toBe(500);
		await expect(
			page.getByRole('heading', { level: 1, name: 'This page could not be shown' })
		).toBeVisible();
		await expectSiteFrame(page);
	});

	test('shows a safe message and a reference, never what was thrown', async ({ page, request }) => {
		// Read from the response itself, so that nothing sent is missed: not the markup, and not the
		// data serialised into it for hydration.
		const html = await (await request.get(FAILING_PAGE)).text();
		expect(html).toContain(SAFE_MESSAGE);
		expect(html).not.toContain(THROWN);

		await page.goto(FAILING_PAGE);
		await settle(page);
		await expect(page.getByText(SAFE_MESSAGE)).toBeVisible();
		await expect(page.getByText(/^Reference [0-9a-f]{12}$/)).toBeVisible();
		await expect(page.getByText(THROWN)).toHaveCount(0);
	});

	test('reached by a link, is shown in place by the router with the same safe message', async ({
		page
	}) => {
		const documents: string[] = [];
		page.on('request', (request) => {
			if (request.isNavigationRequest()) documents.push(new URL(request.url()).pathname);
		});

		await page.goto('/stability');
		await settle(page);
		await page.getByRole('link', { name: 'a page whose server code throws' }).click();

		await expect(
			page.getByRole('heading', { level: 1, name: 'This page could not be shown' })
		).toBeVisible();
		await expect(page.getByText(SAFE_MESSAGE)).toBeVisible();
		await expect(page.getByText(/^Reference [0-9a-f]{12}$/)).toBeVisible();
		await expectSiteFrame(page);
		// Only the first page was loaded as a document. The error arrived as data.
		expect(documents).toEqual(['/stability']);
	});
});

test.describe('a page that fails in the browser', () => {
	test('shows the safe message and reports the real one to the server', async ({ page }) => {
		// The client-rendered page fetches its catalog from the browser. Here that request fails.
		await page.route('**/api/catalog', (route) => route.fulfill({ status: 500, body: 'down' }));

		// The report is read as the page hands it to the browser, because not every browser shows
		// a test the body of a beacon. That it is then really sent is checked separately, below.
		await page.addInitScript(() => {
			const send = navigator.sendBeacon.bind(navigator);
			navigator.sendBeacon = (url, data) => {
				void (data as Blob).text().then((text) => (window.__beacon = text));
				return send(url, data);
			};
		});
		const sent = page.waitForRequest(
			(request) => request.url().endsWith('/api/client-errors') && request.method() === 'POST'
		);

		await page.goto('/rendering/client');

		await expect(
			page.getByRole('heading', { level: 1, name: 'This page could not be shown' })
		).toBeVisible();
		await expect(page.getByText(SAFE_MESSAGE)).toBeVisible();
		await expect(page.getByText('Catalog request failed')).toHaveCount(0);
		await expectSiteFrame(page);

		await sent;
		const beacon = await page.waitForFunction(() => window.__beacon);
		const report = JSON.parse((await beacon.jsonValue()) as string) as Record<string, string>;
		expect(report.message).toBe('Catalog request failed with status 500');
		expect(report.path).toBe('/rendering/client');
		// Browsers format a stack differently, and only some repeat the message in it.
		expect(report.stack).toMatch(/_app\/immutable/);
		// The reference on screen is the one the report was filed under.
		await expect(page.getByText(`Reference ${report.reference}`)).toBeVisible();
	});
});

test.describe('the endpoint that receives browser errors', () => {
	test('accepts a report', async ({ request }) => {
		const response = await request.post('/api/client-errors', {
			data: { reference: 'abc123abc123', message: 'A test report', path: '/' }
		});
		expect(response.status()).toBe(204);
	});

	test('refuses a body that is not JSON', async ({ request }) => {
		const response = await request.post('/api/client-errors', {
			headers: { 'content-type': 'application/json' },
			data: 'not json'
		});
		expect(response.status()).toBe(400);
	});

	test('refuses a body that is too large', async ({ request }) => {
		const response = await request.post('/api/client-errors', {
			data: { message: 'x'.repeat(9000) }
		});
		expect(response.status()).toBe(413);
	});
});

for (const route of [MISSING_PAGE, FAILING_PAGE]) {
	test.describe(`the error page at ${route}, in both colour schemes`, () => {
		test('follows a light system', async ({ page }) => {
			await page.emulateMedia({ colorScheme: 'light' });
			await page.goto(route);
			await expectLight(page);
		});

		test('follows a dark system', async ({ page }) => {
			await page.emulateMedia({ colorScheme: 'dark' });
			await page.goto(route);
			await expectDark(page);
		});

		test('a stored dark choice overrides a light system', async ({ page }) => {
			await page.emulateMedia({ colorScheme: 'light' });
			await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
			await page.goto(route);
			await expectDark(page);
		});

		test('a stored light choice overrides a dark system', async ({ page }) => {
			await page.emulateMedia({ colorScheme: 'dark' });
			await page.addInitScript(() => localStorage.setItem('theme', 'light'));
			await page.goto(route);
			await expectLight(page);
		});
	});
}

/**
 * The static fallback (src/error.html) is sent when the error page itself cannot be rendered.
 * SvelteKit also sends it for any error on a request carrying the header below, which it uses
 * internally to stop one failing error page from requesting another. That makes the fallback
 * reachable here without breaking anything.
 */
test.describe('the static fallback', () => {
	test.use({ extraHTTPHeaders: { 'x-sveltekit-error': 'true' } });

	test('answers with the status and a way back, without the app', async ({ page }) => {
		const response = await page.goto(MISSING_PAGE);

		expect(response?.status()).toBe(404);
		await expect(page.getByText('Error 404')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Back to the start' })).toBeVisible();
		// It is the fallback, not the app's error page: there is no site frame around it.
		await expect(page.getByRole('navigation', { name: 'Chapters' })).toHaveCount(0);
	});

	test('follows a light system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto(MISSING_PAGE);
		await expectLight(page);
	});

	test('follows a dark system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto(MISSING_PAGE);
		await expectDark(page);
	});

	test('a stored dark choice overrides a light system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
		await page.goto(MISSING_PAGE);
		await expectDark(page);
	});

	test('a stored light choice overrides a dark system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.addInitScript(() => localStorage.setItem('theme', 'light'));
		await page.goto(MISSING_PAGE);
		await expectLight(page);
	});
});

test('the health endpoint says the server is up, and which build it is', async ({ request }) => {
	const response = await request.get('/healthz');

	expect(response.status()).toBe(200);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.json()).toEqual({ status: 'ok', version: expect.stringMatching(/\S/) });
});
