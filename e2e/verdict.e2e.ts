import { expect, test, type Page } from '@playwright/test';
import { holdLateArrivals } from './support.js';

const answers = {
	'What are you building?': 'A web product with public pages and an application behind them',
	'What does your team know today?': 'Deep React experience, and a lot of existing React code',
	'How much do you rely on ready-made components and vendor SDKs?': 'Somewhat. A few key libraries',
	'How much do first-load speed and search visibility matter?': 'They are critical to the business',
	'How will the team grow?': 'We need to hire many developers quickly',
	'How do you feel about framework upgrades?': 'We keep dependencies current as a matter of routine'
};

async function answerEverything(page: Page) {
	for (const [question, answer] of Object.entries(answers)) {
		await page.getByRole('group', { name: question }).getByLabel(answer).check();
	}
}

const verdict = (page: Page) => page.getByRole('complementary', { name: 'Your verdict' });

test('counts answers, then gives a verdict with reasons on both sides', async ({ page }) => {
	await page.goto('/verdict');
	await expect(verdict(page)).toContainText('0 of 6 answered');

	await page
		.getByRole('group', { name: 'What are you building?' })
		.getByLabel(answers['What are you building?'])
		.check();
	await expect(verdict(page)).toContainText('1 of 6 answered');

	await answerEverything(page);

	await expect(verdict(page).getByRole('heading', { level: 2 })).toHaveText(
		'Yes, with your eyes open.'
	);
	await expect(verdict(page).getByRole('heading', { name: 'In its favour' })).toBeVisible();
	await expect(verdict(page).getByRole('heading', { name: 'Against it' })).toBeVisible();
});

test('says no when interface code must be shared with native apps', async ({ page }) => {
	await page.goto('/verdict');
	await answerEverything(page);
	await page.getByLabel('Web and native mobile apps that share one interface codebase').check();

	await expect(verdict(page).getByRole('heading', { level: 2 })).toHaveText('Probably not.');
});

test('keeps the verdict in the address, so the link can be shared', async ({ page, browser }) => {
	await page.goto('/verdict');
	await answerEverything(page);
	await expect(verdict(page).getByRole('heading', { level: 2 })).toBeVisible();

	// Someone else opening the same link sees the same verdict, with the answers filled in.
	const context = await browser.newContext();
	const other = await context.newPage();
	await other.goto(page.url());

	await expect(verdict(other).getByRole('heading', { level: 2 })).toHaveText(
		'Yes, with your eyes open.'
	);
	await expect(other.getByLabel(answers['How will the team grow?'])).toBeChecked();
	await context.close();
});

test('answering does not add history entries or lose the scroll position', async ({ page }) => {
	await page.goto('/');
	await page.goto('/verdict');
	await answerEverything(page);
	await expect(verdict(page).getByRole('heading', { level: 2 })).toBeVisible();

	// The last question is well down the page: the page must not have jumped back to the top.
	expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);

	// Six answers, one history entry: Back leaves the page instead of undoing one answer.
	await page.goBack();
	await expect(page).toHaveURL('/');
});

test('answers given before the page has hydrated are kept, and counted once it has', async ({
	page
}) => {
	const release = await holdLateArrivals(page);

	// One question is already answered in the address, so both cases are here: an answer changed
	// and an answer given, each before any of the app's JavaScript has arrived.
	await page.goto('/verdict?building=content', { waitUntil: 'domcontentloaded' });
	const historyLength = await page.evaluate(() => history.length);

	const product = page.getByLabel(answers['What are you building?']);
	const react = page.getByLabel(answers['What does your team know today?']);
	await product.check();
	await react.check();
	// Nothing is listening yet, so the verdict is still the one the server sent.
	await expect(verdict(page)).toContainText('1 of 6 answered');

	release();

	// Hydration leaves the form as the visitor left it, and the address catches up with it
	// without a new page or a new history entry.
	await expect(verdict(page)).toContainText('2 of 6 answered');
	await expect(page).toHaveURL(/\?building=product&team=react$/);
	await expect(product).toBeChecked();
	await expect(react).toBeChecked();
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test('the form follows the address when something else changes it', async ({ page }) => {
	const ticked = page.locator('main form').getByRole('radio', { checked: true });

	await page.goto('/verdict');
	await answerEverything(page);
	await expect(verdict(page).getByRole('heading', { level: 2 })).toBeVisible();

	// The chapter's own link in the navigation: the same page with no answers, as a new entry.
	await page
		.getByRole('navigation', { name: 'Chapters' })
		.getByRole('link', { name: 'Verdict' })
		.click();
	await expect(verdict(page)).toContainText('0 of 6 answered');
	await expect(ticked).toHaveCount(0);

	await page.goBack();
	await expect(verdict(page).getByRole('heading', { level: 2 })).toBeVisible();
	await expect(ticked).toHaveCount(6);

	await page.getByRole('link', { name: 'Start again' }).click();
	await expect(verdict(page)).toContainText('0 of 6 answered');
	await expect(ticked).toHaveCount(0);
});

test('works with JavaScript switched off', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/verdict');

	await answerEverything(page);
	await page.getByRole('button', { name: 'Show my verdict' }).click();

	await expect(verdict(page).getByRole('heading', { level: 2 })).toHaveText(
		'Yes, with your eyes open.'
	);
	await context.close();
});
