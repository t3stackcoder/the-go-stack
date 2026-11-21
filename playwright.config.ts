import { defineConfig } from '@playwright/test';

const PRODUCTION = 'http://localhost:4173';
const DEVELOPMENT = 'http://localhost:5173';

/**
 * Tests that rely on something only Chromium has are tagged `@chromium-only`: the Layout
 * Instability API, which is the only way a browser reports a layout shift, and processor
 * throttling. Every other test also runs in Firefox and WebKit. A green run in those two
 * browsers therefore says nothing about layout shift; it says that what can be measured
 * anywhere (geometry before and after hydration and navigation, and behaviour) holds there too.
 */
const portable = {
	testMatch: '**/*.e2e.ts',
	testIgnore: '**/*.dev.e2e.ts',
	grepInvert: /@chromium-only/
};

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	reporter: 'list',

	// Two servers, because they answer different questions.
	webServer: [
		{
			// The real production server, as deployed: what is measured is what ships.
			command: 'pnpm build && node server.js',
			url: PRODUCTION,
			env: { PORT: '4173', ORIGIN: PRODUCTION },
			timeout: 120_000
		},
		{
			// The development server, for the diagnostics that only exist in development.
			command: 'pnpm exec vite dev --port 5173 --strictPort',
			url: DEVELOPMENT,
			timeout: 120_000
		}
	],

	projects: [
		{
			// The reference: every test, against the production build.
			name: 'chromium',
			testMatch: '**/*.e2e.ts',
			testIgnore: '**/*.dev.e2e.ts',
			use: { baseURL: PRODUCTION, browserName: 'chromium' }
		},
		{ name: 'firefox', ...portable, use: { baseURL: PRODUCTION, browserName: 'firefox' } },
		{ name: 'webkit', ...portable, use: { baseURL: PRODUCTION, browserName: 'webkit' } },
		{
			name: 'development',
			testMatch: '**/*.dev.e2e.ts',
			use: { baseURL: DEVELOPMENT, browserName: 'chromium' }
		}
	]
});
