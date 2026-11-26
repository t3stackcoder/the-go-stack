/**
 * Runs the billing worker: `pnpm billing:worker`, beside `pnpm dev` or `pnpm start`. `pnpm
 * launch` starts it for you.
 *
 * The worker itself is src/lib/server/billing/worker/main.ts, which says what it does. This
 * loads it through Vite, as the server loads its own code and as scripts/seed.js does, so it
 * runs the site's own configuration: the environment is held to the rules in src/env.ts, and the
 * database, Redis and Polar are the ones the site uses. Ctrl+C stops it, after it has sent on
 * what it was holding.
 *
 * While POLAR_MOCK_URL is set it also plays Polar, at that address (./mock-polar/server.js). The
 * fake lives here and not in compose.yaml with the other fakes because Polar has to call the
 * site back, with webhooks, and a container cannot be counted on to reach a server on the
 * machine that runs it. Measured on Windows with Docker Desktop: connections from a container
 * to a server on the host timed out, whichever address the server listened on. What the fake
 * knows is kept in a file under node_modules/.cache, so a subscription bought from it is still
 * there the next time this is run. Delete the file to start again with nobody subscribed.
 *
 * A deployment needs the worker built, not loaded through Vite. There is no deployment yet, and
 * that is for whoever makes one.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const vite = await createServer({
	server: { middlewareMode: true, hmr: false, ws: false },
	appType: 'custom',
	logLevel: 'warn'
});

/** @param {string} path A module of the site's, from the project's root. */
const load = (path) => vite.ssrLoadModule(path);

const { describeError } = /** @type {typeof import('../src/lib/errors.ts')} */ (
	await load('/src/lib/errors.ts')
);

const stop = new AbortController();
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
	process.once(signal, () => stop.abort());
}

/** @type {import('node:http').Server | undefined} */
let mock;
let failed = false;
try {
	const { mockUrl } = await load('/src/lib/server/billing/config.ts');
	if (mockUrl) {
		const { createMockPolar } = await import('./mock-polar/server.js');
		const stateFile = join(ROOT, 'node_modules', '.cache', 'mock-polar', 'state.json');
		mkdirSync(dirname(stateFile), { recursive: true });

		const address = new URL(mockUrl);
		const server = createMockPolar({ stateFile });
		mock = server;
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			// The port a URL leaves out is its protocol's own, which nothing here could listen on.
			server.listen(Number(address.port || 80), address.hostname, () => resolve(undefined));
		});
		console.log(`The fake Polar is listening at ${mockUrl}.`);
	}

	// A stop that came while all this was loading has already happened, and runWorker sees that
	// it has: it starts nothing, and returns.
	const { runWorker } = await load('/src/lib/server/billing/worker/main.ts');
	await runWorker(stop.signal);
} catch (failure) {
	failed = true;
	// The message, which is written for whoever started the worker, and what caused it, which is
	// often the part that says what to do about it.
	console.error(describeError(failure).message);
	// Each cause once, should one ever name an error before it.
	const seen = new Set([failure]);
	let cause = causeOf(failure);
	while (cause !== undefined && !seen.has(cause)) {
		seen.add(cause);
		const { name, message } = describeError(cause);
		console.error(`  Caused by ${name}: ${message}`);
		cause = causeOf(cause);
	}
} finally {
	if (mock) {
		mock.close();
		mock.closeAllConnections();
	}
	await vite.close();
}

// The database's pool of connections would keep the process alive for as long as it keeps an idle
// one, which is ten seconds.
process.exit(failed ? 1 : 0);

/**
 * What an error says caused it, if it says.
 * @param {unknown} error
 */
function causeOf(error) {
	return error instanceof Error ? error.cause : undefined;
}
