import { expect, test } from '@playwright/test';
import { auditedPages, reportsExpectedStatus, settle } from './support.js';

/**
 * Runs against the development server, because that is where the diagnostics are.
 *
 * Svelte reports a mismatch between server HTML and the client's first render only in development,
 * and the reserved-box guard (src/lib/stable/reservation.ts) only exists in development. A
 * production build repairs or tolerates both silently, so the production audit cannot see them.
 */
for (const route of auditedPages) {
	test(`${route} hydrates without warnings`, async ({ page }) => {
		const warnings: string[] = [];
		page.on('console', (message) => {
			if (reportsExpectedStatus(message, route)) return;
			if (message.type() === 'warning' || message.type() === 'error') {
				warnings.push(message.text());
			}
		});
		page.on('pageerror', (error) => warnings.push(error.message));

		await page.goto(route);
		await settle(page);

		expect(warnings).toEqual([]);
	});
}
