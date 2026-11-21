import { expect, test } from '@playwright/test';
import { blockAppScripts, expectDark, expectLight } from './support.js';

test.describe('with no stored choice', () => {
	test('follows a light system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await expectLight(page);
	});

	test('follows a dark system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/');
		await expectDark(page);
	});

	test('presents the system option as selected', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'System theme (selected)' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Dark theme', exact: true })).toBeVisible();
	});
});

test.describe('with a stored choice', () => {
	test('is applied before the page is first painted', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.addInitScript(() => {
			localStorage.setItem('theme', 'dark');

			// The body cannot be painted before it exists, so the theme at the moment it is created
			// is the theme of the first paint.
			// Observed from the document itself: this runs before <html> has been created.
			new MutationObserver((_, observer) => {
				if (!document.body) return;
				(window as Window & { themeAtFirstPaint?: string }).themeAtFirstPaint =
					document.documentElement.dataset.theme ?? 'none';
				observer.disconnect();
			}).observe(document, { childList: true, subtree: true });
		});

		await page.goto('/');

		expect(
			await page.evaluate(
				() => (window as Window & { themeAtFirstPaint?: string }).themeAtFirstPaint
			)
		).toBe('dark');
		await expectDark(page);
	});

	test('light overrides a dark system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.addInitScript(() => localStorage.setItem('theme', 'light'));
		await page.goto('/');
		await expectLight(page);
	});

	test('dark overrides a light system', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
		await page.goto('/');
		await expectDark(page);
	});
});

test.describe('the theme control', () => {
	test('works without hydration, and the choice survives a reload', async ({ page }) => {
		await blockAppScripts(page);
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await expectLight(page);

		await page.getByRole('button', { name: 'Dark theme' }).click();
		await expectDark(page);
		await expect(page.getByRole('button', { name: 'Dark theme (selected)' })).toBeVisible();

		await page.reload();
		await expectDark(page);

		await page.getByRole('button', { name: 'System theme' }).click();
		await expectLight(page);
		expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
	});

	test('works on a page that ships no JavaScript', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/rendering/server');

		await page.getByRole('button', { name: 'Dark theme' }).click();
		await expectDark(page);
	});
});

/**
 * Tailwind's `dark:` is redefined in layout.css to follow the same attribute as the colour tokens.
 * Left as Tailwind ships it, it follows the system alone, and is wrong whenever the visitor has
 * chosen the opposite of their system. Its one use on this site dims images in the dark theme.
 */
test.describe('the `dark:` variant agrees with the theme', () => {
	for (const stored of ['no', 'light', 'dark'] as const) {
		for (const system of ['light', 'dark'] as const) {
			const dark = stored === 'no' ? system === 'dark' : stored === 'dark';

			test(`${stored} stored choice on a ${system} system is ${dark ? 'dark' : 'light'}`, async ({
				page
			}) => {
				await page.emulateMedia({ colorScheme: system });
				if (stored !== 'no') {
					await page.addInitScript((theme) => localStorage.setItem('theme', theme), stored);
				}
				await page.goto('/stability/images');

				const filter = await page
					.getByRole('img')
					.first()
					.evaluate((image) => getComputedStyle(image).filter);

				expect(filter).toBe(dark ? 'brightness(0.9)' : 'none');
				// The tokens and the variant must agree with each other, not only with the expectation.
				await (dark ? expectDark(page) : expectLight(page));
			});
		}
	}
});
