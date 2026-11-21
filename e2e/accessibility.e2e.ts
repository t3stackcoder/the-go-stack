import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { auditedPages, settle } from './support.js';

/**
 * Automated accessibility checks, on every page the stability audit visits and in both themes.
 *
 * They catch what a machine can: missing names and labels, broken structure, text without enough
 * contrast. They cannot say whether a page makes sense to someone using a screen reader, so a
 * green run here is a floor and not a verdict.
 */
for (const route of auditedPages) {
	for (const colorScheme of ['light', 'dark'] as const) {
		test(`${route} has no detectable accessibility problems in the ${colorScheme} theme`, async ({
			page
		}) => {
			await page.emulateMedia({ colorScheme });
			await page.goto(route);
			await settle(page);

			const { violations } = await new AxeBuilder({ page }).analyze();

			// Reduced to what is needed to find each problem, so that a failure can be read.
			const problems = violations.map(({ id, help, nodes }) => ({
				id,
				help,
				where: nodes.map((node) => node.target.join(' '))
			}));
			expect(problems).toEqual([]);
		});
	}
}

test.describe('the skip link', () => {
	/**
	 * Moves focus to the skip link the way a keyboard user does, with the first press of Tab, and
	 * checks that the link is what it lands on.
	 *
	 * The WebKit build used here never moves to a link with Tab (Safari itself needs Option held, or
	 * a setting changed, and this build ignores both). There the link is focused directly. That
	 * still checks that it shows itself and works, but not that it comes first.
	 */
	async function reachSkipLink(page: Page, browserName: string) {
		const skip = page.getByRole('link', { name: 'Skip to content' });
		if (browserName === 'webkit') await skip.focus();
		else await page.keyboard.press('Tab');
		await expect(skip).toBeFocused();
		return skip;
	}

	test('is the first thing the keyboard reaches, and leads past the navigation', async ({
		page,
		browserName
	}) => {
		await page.goto('/reactivity');
		await settle(page);

		const skip = await reachSkipLink(page, browserName);
		await expect(skip).toBeInViewport();

		await page.keyboard.press('Enter');
		await expect(page.locator('main')).toBeFocused();
	});

	test('takes no space and moves nothing when it appears', async ({ page, browserName }) => {
		await page.goto('/');
		await settle(page);
		const headerTop = () =>
			page
				.locator('header')
				.first()
				.evaluate((header) => header.getBoundingClientRect().y);
		const before = await headerTop();

		await reachSkipLink(page, browserName);

		expect(await headerTop()).toBe(before);
	});
});
