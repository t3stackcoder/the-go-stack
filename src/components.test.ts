// Tailwind reads only the shadcn-svelte components listed in the stylesheet (see the `@source`
// lines in src/routes/layout.css). A component used but not listed renders without its styles,
// and nothing else would say so. This finds every component in use, including the ones other
// components are built from, and checks that each is listed.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const ui = join(root, 'src/lib/components/ui');
const stylesheet = readFileSync(join(root, 'src/routes/layout.css'), 'utf-8');

const IMPORTED = /#lib\/components\/ui\/([a-z0-9-]+)\//g;
const LISTED = /^@source '\.\.\/lib\/components\/ui\/([a-z0-9-]+)';$/gm;

function sources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && /\.(svelte|ts)$/.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name));
}

/** The components a set of files imports, by directory name. */
function importedBy(files: string[]) {
	return new Set(
		files.flatMap((file) => [...readFileSync(file, 'utf-8').matchAll(IMPORTED)].map((m) => m[1]))
	);
}

/** These components, and every component they are built from. */
function withParts(names: Iterable<string>) {
	const all = new Set(names);
	// A Set visits what is added to it while it is being walked.
	for (const name of all) {
		for (const part of importedBy(sources(join(ui, name)))) all.add(part);
	}
	return all;
}

describe('the components Tailwind reads', () => {
	const app = sources(join(root, 'src')).filter((file) => relative(ui, file).startsWith('..'));
	const listed = new Set([...stylesheet.matchAll(LISTED)].map((m) => m[1]));

	it('lists every component in use', () => {
		const missing = [...withParts(importedBy(app))].filter((name) => !listed.has(name)).sort();
		expect(
			missing,
			`Add @source '../lib/components/ui/<name>'; to src/routes/layout.css for each`
		).toEqual([]);
	});

	it('counts the components a component is built from', () => {
		expect(withParts(['input-group'])).toContain('textarea');
	});
});
