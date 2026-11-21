import { expect, test, type Page } from '@playwright/test';

/**
 * The forms chapter's claim: the same forms work with and without JavaScript, and JavaScript only
 * adds to them. Each test runs in a fresh browser context, so it gets a new anonymous session and
 * starts from the same seeded list.
 */

const itemField = (page: Page) => page.getByRole('textbox', { name: 'Item' });
const quantityField = (page: Page) => page.getByRole('spinbutton', { name: 'How many' });
const addButton = (page: Page) => page.getByRole('button', { name: 'Add to list' });
const toggleFor = (page: Page, text: string) =>
	page.getByRole('button', { name: new RegExp(`^Packed: ${text}\\b`) });
const removeFor = (page: Page, text: string) =>
	page.getByRole('button', { name: `Remove ${text}`, exact: true });
const newestLogEntry = (page: Page) =>
	page.getByRole('region', { name: 'Server log' }).getByRole('listitem').first();

/** The readout says this until the app has hydrated, and for good on a page without JavaScript. */
const noScriptNotice = (page: Page) =>
	page
		.getByRole('complementary', { name: 'Live measurements of this page' })
		.getByText('No JavaScript is running.');

async function add(page: Page, text: string, quantity: string) {
	await itemField(page).fill(text);
	await quantityField(page).fill(quantity);
	await addButton(page).click();
}

test.describe('with JavaScript', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/forms');
		// Interacting before hydration would quietly test the plain-post path instead.
		await expect(noScriptNotice(page)).toBeHidden();
		// Set on the window, so a full page reload would lose it.
		await page.evaluate(() => ((window as Window & { stayed?: boolean }).stayed = true));
	});

	test.afterEach(async ({ page }) => {
		expect(
			await page.evaluate(() => (window as Window & { stayed?: boolean }).stayed),
			'the page reloaded'
		).toBe(true);
	});

	test('adds an item in place, with a pending state, and logs it as enhanced', async ({ page }) => {
		await add(page, 'Sun cream', '2');

		await expect(page.getByRole('button', { name: 'Adding' })).toBeVisible();
		await expect(toggleFor(page, 'Sun cream')).toBeVisible();
		await expect(itemField(page)).toHaveValue('');
		await expect(itemField(page)).toBeFocused();
		await expect(newestLogEntry(page)).toContainText('Add “Sun cream”');
		await expect(newestLogEntry(page)).toContainText('Enhanced');
		await expect(newestLogEntry(page)).toContainText('Saved');
	});

	test('shows the server’s validation error and keeps what was typed', async ({ page }) => {
		await add(page, 'socks', '3');

		await expect(page.getByText('That is already on the list.')).toBeVisible();
		await expect(itemField(page)).toHaveValue('socks');
		await expect(quantityField(page)).toHaveValue('3');
		await expect(itemField(page)).toHaveAttribute('aria-invalid', 'true');
		await expect(itemField(page)).toHaveAccessibleDescription('That is already on the list.');
		await expect(itemField(page)).toBeFocused();
		await expect(newestLogEntry(page)).toContainText('Invalid');
	});

	test('ticks an item at once and keeps it ticked when the server agrees', async ({ page }) => {
		const socks = toggleFor(page, 'Socks');
		await expect(socks).toHaveAttribute('aria-pressed', 'false');

		await socks.click();
		// Optimistic: shown before the server, which deliberately takes 600 ms, has answered.
		await expect(socks).toHaveAttribute('aria-pressed', 'true', { timeout: 300 });
		await expect(newestLogEntry(page)).toContainText('Pack “Socks”');
		await expect(newestLogEntry(page)).toContainText('Saved');
		await expect(socks).toHaveAttribute('aria-pressed', 'true');
	});

	test('rolls back an optimistic tick that the server refuses', async ({ page }) => {
		const sink = toggleFor(page, 'Kitchen sink');

		await sink.click();
		await expect(sink).toHaveAttribute('aria-pressed', 'true', { timeout: 300 });

		await expect(page.getByRole('status')).toContainText('everything but the kitchen sink');
		await expect(sink).toHaveAttribute('aria-pressed', 'false');
		await expect(newestLogEntry(page)).toContainText('Refused');
	});

	test('removes an item at once and moves focus to the next one', async ({ page }) => {
		await removeFor(page, 'Rain jacket').focus();
		await page.keyboard.press('Enter');

		await expect(removeFor(page, 'Rain jacket')).toHaveCount(0, { timeout: 300 });
		await expect(removeFor(page, 'Kitchen sink')).toBeFocused();
		await expect(newestLogEntry(page)).toContainText('Remove “Rain jacket”');
		await expect(removeFor(page, 'Rain jacket')).toHaveCount(0);
	});
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test.beforeEach(async ({ page }) => {
		await page.goto('/forms');
		await expect(noScriptNotice(page)).toBeVisible();
	});

	test('adds an item with a plain form post and logs it as one', async ({ page }) => {
		await add(page, 'Sun cream', '2');

		await expect(page).toHaveURL(/\?\/add#packing-list$/);
		await expect(toggleFor(page, 'Sun cream')).toBeVisible();
		await expect(itemField(page)).toHaveValue('');
		await expect(newestLogEntry(page)).toContainText('Add “Sun cream”');
		await expect(newestLogEntry(page)).toContainText('Plain post');
	});

	test('answers a failed validation with a 400, the error, and the typed values', async ({
		page
	}) => {
		const response = page.waitForResponse((r) => r.request().method() === 'POST');
		await add(page, 'socks', '3');
		expect((await response).status()).toBe(400);

		await expect(page.getByText('That is already on the list.')).toBeVisible();
		await expect(itemField(page)).toHaveValue('socks');
		await expect(quantityField(page)).toHaveValue('3');
		await expect(itemField(page)).toHaveAttribute('aria-invalid', 'true');
		await expect(newestLogEntry(page)).toContainText('Plain post');
	});

	test('rejects text that is only spaces, which the browser lets through', async ({ page }) => {
		await add(page, '   ', '1');
		await expect(page.getByText('Enter something to pack.')).toBeVisible();
	});

	test('ticks an item off', async ({ page }) => {
		await toggleFor(page, 'Socks').click();
		await expect(toggleFor(page, 'Socks')).toHaveAttribute('aria-pressed', 'true');
		await expect(newestLogEntry(page)).toContainText('Plain post');

		await toggleFor(page, 'Socks').click();
		await expect(toggleFor(page, 'Socks')).toHaveAttribute('aria-pressed', 'false');
	});

	test('refuses to pack the kitchen sink', async ({ page }) => {
		await toggleFor(page, 'Kitchen sink').click();

		await expect(page.getByRole('status')).toContainText('everything but the kitchen sink');
		await expect(toggleFor(page, 'Kitchen sink')).toHaveAttribute('aria-pressed', 'false');
		await expect(newestLogEntry(page)).toContainText('Refused');
	});

	test('removes an item', async ({ page }) => {
		await removeFor(page, 'Rain jacket').click();

		await expect(removeFor(page, 'Rain jacket')).toHaveCount(0);
		await expect(newestLogEntry(page)).toContainText('Remove “Rain jacket”');
	});
});

test('keeps each visitor’s list to themselves', async ({ page, browser }) => {
	await page.goto('/forms');
	await removeFor(page, 'Socks').click();
	await expect(removeFor(page, 'Socks')).toHaveCount(0);

	const stranger = await browser.newContext();
	const theirPage = await stranger.newPage();
	await theirPage.goto('/forms');
	await expect(removeFor(theirPage, 'Socks')).toBeVisible();
	await stranger.close();
});
