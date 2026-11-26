// An accent is written down in four places that cannot share code: the list the picker shows
// (accents.ts), the list the boot script in app.html accepts, its colours in the stylesheet, and
// the picker's rules for which swatch reads as selected. One missing from the boot script is
// dropped on every page load; one missing from the stylesheet shows orange under another name;
// one missing from the picker's rules is never shown as chosen. Nothing on the page would say so.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accents, DEFAULT_ACCENT } from './accents.js';

const root = join(import.meta.dirname, '../../..');
const bootScript = readFileSync(join(root, 'src/app.html'), 'utf-8');
const stylesheet = readFileSync(join(root, 'src/routes/layout.css'), 'utf-8');
const picker = readFileSync(join(root, 'src/lib/theme/AccentPicker.svelte'), 'utf-8');

const offered = accents.map((accent) => accent.value);

/** The values given to `setting('accent', [...])` in the boot script, in order. */
function accepted() {
	const list = /setting\('accent', \[([^\]]*)\]\)/.exec(bootScript)?.[1];
	if (!list) throw new Error("No setting('accent', [...]) in src/app.html");
	return [...list.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
}

describe('the accent colours', () => {
	it('are the ones the boot script accepts, the default first', () => {
		const [fallback, ...others] = accepted();
		expect(fallback).toBe(DEFAULT_ACCENT);
		expect([fallback, ...others].sort()).toEqual([...offered].sort());
	});

	it('each have a rule in the stylesheet', () => {
		const styled = [...stylesheet.matchAll(/^\t\[data-accent='([a-z-]+)'\] \{$/gm)].map(
			(match) => match[1]
		);
		expect(styled.sort()).toEqual([...offered].sort());
	});

	it('each show as selected when chosen', () => {
		for (const accent of offered) {
			const chosen =
				accent === DEFAULT_ACCENT ? ':root:not([data-accent])' : `:root[data-accent='${accent}']`;
			for (const part of ['.dot', '.selected']) {
				expect(picker).toContain(`:global(${chosen}) [data-accent-set='${accent}'] ${part}`);
			}
		}
	});
});
