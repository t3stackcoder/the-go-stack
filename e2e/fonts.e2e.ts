import { expect, test } from '@playwright/test';
import { distantServer, readLayoutShifts, recordLayoutShifts, settle } from './support.js';

// The script in src/app.html names the font by a fixed address, so the address cannot carry a
// version the way a built file's does. The font is cached by time instead: a browser keeps it for
// a month, and after that goes on using its copy while it fetches a new one in the background.
// Without the header a browser asks the server about the file on every visit, and a visit from
// far away would start in the fallback every time.
test('the font may be kept, and refreshed in the background', async ({ request }) => {
	const response = await request.get('/fonts/inter-latin.woff2');

	expect(response.status()).toBe(200);
	expect(response.headers()['cache-control']).toBe(
		'public, max-age=2592000, stale-while-revalidate=31536000'
	);
});

// A preload link looks like the obvious way to fetch the font early, and it would undo the work of
// the script in src/app.html: Chromium holds its first frame for a preloaded font whether or not
// the font can arrive in time, and a link cannot be made to depend on anything.
test('no font is preloaded by a link', async ({ page }) => {
	await page.goto('/');
	await settle(page);

	await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(0);
});

// Inter is used on a visit when it has loaded by the first frame. Chromium holds its first frame
// back briefly for a font the page has asked for, so it gets there on a first visit to a server
// that is close, as the test server is. The others do not wait:
// they get there once the file is cached, and on a busy machine not on every load even then. So
// this asks for what is promised, that a visit with the file cached can start in Inter, and
// reloads until one does. If the script in src/app.html ever ruled Inter out for good, no reload
// would.
test('renders text in Inter once it is cached, and headings in its display cut', async ({
	page
}) => {
	await page.goto('/');
	await settle(page);

	await expect(async () => {
		await page.reload();
		await settle(page);

		const { fallbackOnly, interLoaded } = await page.evaluate(() => ({
			fallbackOnly: document.documentElement.dataset.font === 'fallback',
			interLoaded: [...document.fonts].some(
				(face) => face.family.replaceAll('"', '') === 'Inter' && face.status === 'loaded'
			)
		}));
		expect(fallbackOnly).toBe(false);
		expect(interLoaded).toBe(true);
	}).toPass({ timeout: 20_000 });

	const headingVariation = await page.evaluate(
		() => getComputedStyle(document.querySelector('h1')!).fontVariationSettings
	);
	expect(headingVariation).toBe('"opsz" 32');
});

// Chromium holds its first frame for up to 100 ms while a font asked for in the <head> is on its
// way, and then paints the fallback anyway if the font has not arrived. From a server that takes
// more than 35 ms to answer the font cannot arrive in time, so the page must not ask: it takes the fallback
// at once and fetches the font once the page has long loaded. The next visit finds the file in the
// cache and starts in Inter, however far away the server is.
test('a first visit from far away does not wait for the font, and the next visit has it', async ({
	page,
	baseURL
}) => {
	const far = await distantServer(baseURL!, 150);
	try {
		// The font is put off until a few seconds after the page has loaded, so that it does not
		// compete with the scripts the page is waiting for.
		const fetched = page.waitForResponse((response) => response.url().endsWith('.woff2'));
		await page.goto(far.origin);
		await settle(page);
		expect(await page.evaluate(() => document.documentElement.dataset.font)).toBe('fallback');
		await (await fetched).finished();

		const { requested, loaded } = await page.evaluate(() => {
			const [navigation] = performance.getEntriesByType(
				'navigation'
			) as PerformanceNavigationTiming[];
			const font = performance
				.getEntriesByType('resource')
				.find((entry) => /\.woff2$/.test(entry.name));
			return { requested: font?.startTime, loaded: navigation.loadEventStart };
		});
		expect(requested, 'the font is fetched on this visit, for the next').toBeDefined();
		expect(requested, 'and only once the page has loaded').toBeGreaterThanOrEqual(loaded);

		await expect(async () => {
			// A new navigation and not a reload: some browsers check every file again on a reload,
			// and from this far away the answer would come after the first frame.
			await page.goto(far.origin);
			await settle(page);

			const { fallbackOnly, interLoaded } = await page.evaluate(() => ({
				fallbackOnly: document.documentElement.dataset.font === 'fallback',
				interLoaded: [...document.fonts].some(
					(face) => face.family.replaceAll('"', '') === 'Inter' && face.status === 'loaded'
				)
			}));
			expect(fallbackOnly).toBe(false);
			expect(interLoaded).toBe(true);
		}).toPass({ timeout: 20_000 });
	} finally {
		await far.close();
	}
});

declare global {
	interface Window {
		__titleWidths: number[];
	}
}

// The font a visit starts with must be the font it keeps. Left to themselves, browsers disagree
// about a font that is not ready at once: Firefox lays text out invisibly and again about 100 ms
// later, and WebKit keeps the fallback until the next navigation and swaps then, under the reader.
// The script in src/app.html settles it at the first frame instead. This measures a piece of text
// after every frame, through a cold load and a client-side navigation: it may have one width only.
for (const delay of [0, 60, 150, 400]) {
	test(`a font arriving ${delay} ms late is settled at the first frame, for the whole visit`, async ({
		page
	}) => {
		await page.route('**/*.woff2', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, delay));
			await route.continue();
		});
		await page.addInitScript(() => {
			window.__titleWidths = [];
			// A task queued from the animation callback runs once the frame has been drawn, so
			// this sees what was painted, not what was about to be.
			const afterEachFrame = () =>
				requestAnimationFrame(() =>
					setTimeout(() => {
						const width = document.querySelector('header a')?.getBoundingClientRect().width;
						if (width && !window.__titleWidths.includes(width)) window.__titleWidths.push(width);
						afterEachFrame();
					})
				);
			afterEachFrame();
		});

		await page.goto('/');
		await settle(page);
		await page.waitForTimeout(delay);
		await page.getByRole('navigation', { name: 'Chapters' }).getByRole('link').first().click();
		await expect(
			page.getByRole('heading', { level: 1, name: 'One page, three ways' })
		).toBeVisible();
		await settle(page);

		expect(await page.evaluate(() => window.__titleWidths)).toHaveLength(1);
	});
}

// A font that lands just after first paint is the case most likely to re-flow text: too late to be
// in the first frame, early enough that a browser might still swap it in. These delays straddle
// that window. (A font that is very late is covered by the slow-device check in the stability audit.)
for (const delay of [25, 60, 120]) {
	test(
		`a font arriving ${delay} ms late moves nothing`,
		{ tag: '@chromium-only' },
		async ({ page }) => {
			await page.route('**/*.woff2', async (route) => {
				await new Promise((resolve) => setTimeout(resolve, delay));
				await route.continue();
			});
			await recordLayoutShifts(page);

			await page.goto('/');
			await settle(page);

			expect(await readLayoutShifts(page)).toEqual([]);
		}
	);
}
