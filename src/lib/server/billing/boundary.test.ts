// Billing has two sides: what serves a request, and the worker that talks to Polar for as long
// as it takes. A page that waits on Polar is as slow as Polar is, and is down when it is. Nothing
// would fail if a request's code reached the worker's side: it would work, until the day Polar
// was slow. So the imports are followed from everything that serves a request, and this test
// fails, naming the chain, if they reach the worker's side. (In the spirit of src/markup.test.ts.)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../../..');
const BILLING = 'src/lib/server/billing/';

/** Where a request's code must not reach: the worker's calls to Polar, and the worker itself. */
const forbidden = (file: string) =>
	file === `${BILLING}polar/sync.ts` || file.startsWith(`${BILLING}worker/`);

/** What serves a request, besides every file under src/routes. */
const REQUEST_SIDE = [
	'src/hooks.server.ts',
	`${BILLING}index.ts`,
	`${BILLING}service.ts`,
	`${BILLING}webhook.ts`,
	`${BILLING}redis.ts`,
	`${BILLING}config.ts`,
	`${BILLING}catalogue.ts`,
	`${BILLING}polar/checkout.ts`
];

/** A file's text by its path from the project root, or undefined where there is no such file. */
type Source = (file: string) => string | undefined;

const fromDisk: Source = (file) => {
	const path = join(root, file);
	return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

interface Import {
	specifier: string;
	/** `import type`, which is gone from the JavaScript that runs. */
	typeOnly: boolean;
}

/** Every module a file imports, re-exports or loads, read from its text. */
function importsOf(text: string): Import[] {
	// Comments are dropped first, since they talk about files in the same words. A `//` only
	// begins one at the start of a line or after a space, and not in `https://`.
	const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
	const found: Import[] = [];
	const patterns = [
		/\b(?:import|export)\s+(type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
		/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
	];
	for (const match of code.matchAll(patterns[0])) {
		found.push({ specifier: match[2], typeOnly: Boolean(match[1]) });
	}
	for (const match of code.matchAll(patterns[1])) {
		found.push({ specifier: match[1], typeOnly: false });
	}
	return found;
}

/** The file a specifier names, from the project's root, or null for a package or anything not in src. */
function resolve(from: string, specifier: string, source: Source): string | null {
	let base: string;
	if (specifier.startsWith('.')) base = normalize(join(dirname(from), specifier));
	else if (specifier.startsWith('#lib/')) base = join('src/lib', specifier.slice('#lib/'.length));
	else if (specifier.startsWith('$lib/')) base = join('src/lib', specifier.slice('$lib/'.length));
	else return null;

	base = base.replaceAll('\\', '/');
	// Written as `.js` and found as `.ts`, which is how TypeScript's own resolution reads it.
	const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`];
	return (
		candidates.find(
			(candidate) => /\.(ts|svelte)$/.test(candidate) && source(candidate) !== undefined
		) ?? null
	);
}

/**
 * Everything the files reach through their imports, each with the chain that led to it. Types
 * are not followed: they leave no import behind.
 */
function reach(roots: string[], source: Source): Map<string, string[]> {
	const chains = new Map<string, string[]>();
	const queue: string[] = [];
	for (const file of roots) {
		if (source(file) === undefined) continue;
		chains.set(file, [file]);
		queue.push(file);
	}
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		const chain = chains.get(next) as string[];
		for (const { specifier, typeOnly } of importsOf(source(next) as string)) {
			if (typeOnly) continue;
			const file = resolve(next, specifier, source);
			if (file === null || chains.has(file)) continue;
			chains.set(file, [...chain, file]);
			queue.push(file);
		}
	}
	return chains;
}

/** The chains that lead to a file a request must not reach, as `a -> b -> c`. */
function breaches(roots: string[], source: Source): string[] {
	return [...reach(roots, source)]
		.filter(([file]) => forbidden(file))
		.map(([, chain]) => chain.join(' -> '));
}

function filesUnder(directory: string): string[] {
	return readdirSync(join(root, directory), { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && /\.(ts|svelte)$/.test(entry.name))
		.filter((entry) => !/\.test\.ts$/.test(entry.name))
		.map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
}

const routes = filesUnder('src/routes');

describe('what serves a request', () => {
	it('has files to check, so that the rules below are not met by there being none', () => {
		expect(routes.length).toBeGreaterThan(10);
		for (const file of REQUEST_SIDE) expect(fromDisk(file), file).toBeDefined();
	});

	it('follows imports through the files themselves, down to what billing is made of', () => {
		const reached = [...reach([...routes, ...REQUEST_SIDE], fromDisk).keys()];

		expect(reached).toContain(`${BILLING}webhook.ts`);
		expect(reached).toContain(`${BILLING}redis.ts`);
		expect(reached).toContain('src/lib/server/log.ts');
	});

	it('never reaches the worker or the calls only the worker makes', () => {
		expect(breaches([...routes, ...REQUEST_SIDE], fromDisk)).toEqual([]);
	});

	it('reaches billing from a route only through its index', () => {
		const offenders: string[] = [];
		for (const file of routes) {
			for (const { specifier } of importsOf(fromDisk(file) as string)) {
				const target = resolve(file, specifier, fromDisk);
				if (target?.startsWith(BILLING) && target !== `${BILLING}index.ts`) {
					offenders.push(`${file} imports ${target}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe('the check itself', () => {
	it('finds the worker and its calls from the worker, so that it can find them from anywhere', () => {
		const found = breaches([`${BILLING}worker/main.ts`], fromDisk);

		expect(found.some((chain) => chain.endsWith(`${BILLING}polar/sync.ts`))).toBe(true);
		expect(found.some((chain) => chain.endsWith(`${BILLING}worker/drain.ts`))).toBe(true);
	});

	/** A project of a few files, to show the rule fails and says how it was reached. */
	const project =
		(files: Record<string, string>): Source =>
		(file) =>
			files[file];

	it('names the chain from a route to what it must not reach', () => {
		const source = project({
			'src/routes/page/+server.ts': "import { x } from '#lib/server/billing/index.js';",
			[`${BILLING}index.ts`]: "export { y } from './service.js';",
			[`${BILLING}service.ts`]: "import { z } from './polar/sync.js';",
			[`${BILLING}polar/sync.ts`]: 'export const z = 1;'
		});

		expect(breaches(['src/routes/page/+server.ts'], source)).toEqual([
			`src/routes/page/+server.ts -> ${BILLING}index.ts -> ${BILLING}service.ts -> ${BILLING}polar/sync.ts`
		]);
	});

	it('follows a dynamic import, and a file named without its extension', () => {
		const source = project({
			'src/routes/a.ts': "const later = await import('./b');",
			'src/routes/b.ts': "import '../lib/server/billing/worker/drain.js';",
			[`${BILLING}worker/drain.ts`]: ''
		});

		expect(breaches(['src/routes/a.ts'], source)).toHaveLength(1);
	});

	it('does not count an import of a type alone, a comment, or a package', () => {
		const source = project({
			'src/routes/a.ts': [
				`import type { Standing } from '#lib/server/billing/polar/sync.js';`,
				"// this used to import from '#lib/server/billing/worker/drain.js'",
				"/* import { z } from '#lib/server/billing/worker/ship.js'; */",
				"import { ok } from 'polar-something';"
			].join('\n'),
			[`${BILLING}polar/sync.ts`]: '',
			[`${BILLING}worker/drain.ts`]: '',
			[`${BILLING}worker/ship.ts`]: ''
		});

		expect(breaches(['src/routes/a.ts'], source)).toEqual([]);
	});

	it('finds a component that imports the worker from its script', () => {
		const source = project({
			'src/routes/+page.svelte': `<script lang="ts">\n\timport { syncOnce } from '#lib/server/billing/worker/sync.js';\n</script>`,
			[`${BILLING}worker/sync.ts`]: ''
		});

		expect(breaches(['src/routes/+page.svelte'], source)).toHaveLength(1);
	});
});
