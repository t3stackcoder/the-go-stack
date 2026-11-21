import { expect, test, type Page } from '@playwright/test';
import { settle } from './support.js';

/**
 * The behaviour Chapter 03 claims, checked. Layout stability on these pages is covered by the
 * stability audit, which discovers them on its own.
 */

const results = (page: Page) => page.getByRole('region', { name: 'Results' }).getByRole('listitem');
const searchBox = (page: Page) =>
	page.getByRole('searchbox', { name: 'Search by code, phrase or kind' });

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the search is a plain form, filtered on the server', async ({ page }) => {
		await page.goto('/data/search');
		await searchBox(page).fill('timeout');
		await searchBox(page).press('Enter');

		await expect(page).toHaveURL(/\/data\/search\?q=timeout$/);
		await expect(results(page)).toHaveText([/408/, /504/]);
	});
});

test('searching as you type keeps focus and adds no history entries', async ({ page }) => {
	await page.goto('/data/search');
	await settle(page);
	const historyLength = await page.evaluate(() => history.length);

	await searchBox(page).pressSequentially('not f');

	await expect(page).toHaveURL(/\?q=not\+f$/);
	await expect(results(page)).toHaveText([/304/, /404/, /416/]);
	await expect(searchBox(page)).toBeFocused();
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test('streamed panels arrive, and a rejected one shows its error in place', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));

	await page.goto('/data/streaming');

	const panel = (name: string) =>
		page.locator('section', { has: page.getByRole('heading', { name, exact: true }) });

	await expect(panel('Rating').getByRole('alert')).toContainText('Reviews service timed out.');
	for (const name of ['Stock', 'Prices', 'Delivery']) {
		await expect(panel(name)).toContainText('Shown at');
	}
	expect(errors).toEqual([]);
});
