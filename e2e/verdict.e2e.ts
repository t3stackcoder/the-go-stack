import { expect, test, type Page } from '@playwright/test';

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
