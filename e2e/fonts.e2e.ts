import { expect, test } from '@playwright/test';
import { readLayoutShifts, recordLayoutShifts, settle } from './support.js';

test('preloads exactly one font file: the Latin Inter that first paint needs', async ({ page }) => {
	await page.goto('/');

	const preloads = await page
		.locator('link[rel="preload"][as="font"]')
		.evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));

	expect(preloads).toHaveLength(1);
	expect(preloads[0]).toMatch(/inter-latin-opsz-normal\.[\w-]+\.woff2$/);
});

// Inter is used on a visit when it has loaded by the first frame. Chromium holds its first frame
// back briefly for a preloaded font, so it gets there on a first visit. The others do not wait:
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
