import { expect, test, type Page } from '@playwright/test';

/**
 * Behaviour of the Reactivity chapter's demos. Their claims are made by numbers the page measures
 * itself, so these tests check that the numbers say what the copy says they will.
 */

/** Opens the chapter and waits for hydration, which the readout pinned to the page reports. */
async function open(page: Page) {
	await page.goto('/reactivity');
	await expect(page.getByLabel('Live measurements of this page')).toContainText('JS sent');
}

test('the bill split recomputes its derived values', async ({ page }) => {
	await open(page);
	const demo = page.getByRole('figure', { name: 'Split the bill' });

	await expect(demo.getByRole('definition')).toHaveText(['94.08', '31.36']);
	await demo.getByRole('slider', { name: 'People' }).press('ArrowRight');
	await expect(demo.getByRole('definition')).toHaveText(['94.08', '23.52']);
});

test('the heatmap writes one DOM node per changed cell, and none for unchanged ones', async ({
	page
}) => {
	await open(page);
	const demo = page.getByRole('figure', { name: '2,400 cells' });
	const nodesWritten = demo.getByRole('definition').first();

	await demo.getByRole('button', { name: 'Change one cell' }).click();
	await expect(nodesWritten).toHaveText('1');

	await demo.getByRole('button', { name: 'Change one cell' }).click();
	await demo.getByRole('button', { name: 'Change one cell' }).click();
	// All 2,400 cells are assigned zero, but only the three warm ones change.
	await demo.getByRole('button', { name: 'Cool all' }).click();
	await expect(nodesWritten).toHaveText('3');
});

test('two components stay in step through one shared module', async ({ page }) => {
	await open(page);
	const demo = page.getByRole('figure', { name: 'One basket' });
	const summary = demo.locator('p[aria-live]');
	const firstProduct = demo.getByRole('listitem').first();

	await expect(summary).toHaveText('0 items · $0');

	await demo.getByRole('button', { name: /^Add / }).first().click();
	await demo.getByRole('button', { name: /^Add / }).first().click();
	await expect(summary).toContainText('2 items');
	await expect(firstProduct).toContainText('2 in basket');

	await demo.getByRole('button', { name: /^Remove one / }).click();
	await expect(summary).toContainText('1 item ');
	await expect(firstProduct).toContainText('1 in basket');

	await demo.getByRole('button', { name: 'Empty the basket' }).click();
	await expect(summary).toHaveText('0 items · $0');
	await expect(firstProduct).toContainText('0 in basket');
});
