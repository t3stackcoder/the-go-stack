// Whether a browser is signed in, whether as someone who may open the admin area, and whether
// they have switched the readout on, is written down in places that cannot share code: the
// cookie's name and values here, the boot script in app.html that reads the cookie before
// anything can be imported, and the stylesheet rules that show one control or another, and the
// readout. A name or a value changed in one and not the others leaves the header showing "sign in"
// to everybody, or the admin button or the readout to nobody, and nothing on the page would say
// why.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAG_SEPARATOR, MARKED, MARKER } from './marker.js';

const root = join(import.meta.dirname, '../../..');
const bootScript = readFileSync(join(root, 'src/app.html'), 'utf-8');
const marker = readFileSync(join(root, 'src/lib/auth/marker.ts'), 'utf-8');
const control = readFileSync(join(root, 'src/lib/auth/AccountButton.svelte'), 'utf-8');
const adminButton = readFileSync(join(root, 'src/lib/auth/AdminButton.svelte'), 'utf-8');
const hud = readFileSync(join(root, 'src/lib/hud/Hud.svelte'), 'utf-8');
const layout = readFileSync(join(root, 'src/routes/+layout.svelte'), 'utf-8');
const authLayout = readFileSync(join(root, 'src/routes/(auth)/+layout.svelte'), 'utf-8');

describe('the signed-in marker', () => {
	// At the start of the cookie string or after a separator: not the tail of another name.
	const reading = `/(^|; )${MARKER}=([^;]*)/.exec(document.cookie)?.[2]`;

	it('is read by the boot script and after a move within the site under the name the server sets it by', () => {
		expect(bootScript).toContain(reading);
		expect(marker).toContain(reading);
	});

	it('is put on <html> the same way by the boot script and after a move within the site', () => {
		const signedIn = "root.dataset.signedIn = marker !== undefined ? 'yes' : 'no'";
		expect(bootScript).toContain(signedIn);
		expect(marker).toContain(signedIn);

		expect(bootScript).toContain(`const flags = marker?.split('${FLAG_SEPARATOR}') ?? []`);
		expect(marker).toContain('const flags = marker?.split(FLAG_SEPARATOR) ?? []');

		for (const [flag, attribute] of [
			['admin', 'admin'],
			['readout', 'readout']
		] as const) {
			expect(bootScript).toContain(
				`if (flags.includes('${MARKED[flag]}')) root.dataset.${attribute} = ''`
			);
			expect(marker).toContain(
				`if (flags.includes(MARKED.${flag})) root.dataset.${attribute} = ''`
			);
			expect(bootScript).toContain(`else delete root.dataset.${attribute}`);
			expect(marker).toContain(`else delete root.dataset.${attribute}`);
		}
	});

	it('is asked again whenever a page is shown, for one brought back by Back or Forward', () => {
		expect(bootScript).toContain("addEventListener('pageshow', showSignedIn)");
	});

	it('shows one control for each thing it can say', () => {
		expect(control).toContain(":global(:root[data-signed-in='no']) .signed-out");
		expect(control).toContain(":global(:root[data-signed-in='yes']) .signed-in");
		// And one for when nothing has said: a browser that does not run the boot script.
		expect(control).toMatch(/<noscript>\s*<a href=\{resolve\('\/account'\)\}/);
	});

	it('shows the admin button only where it says the admin area is open', () => {
		expect(adminButton).toContain(':global(:root[data-admin]) .admin');
	});

	it('shows the readout, and the room kept clear of it, only where it says it is switched on', () => {
		expect(hud).toMatch(
			/<Reserve\s+class="[^"]*\bhidden\b[^"]*\[:root\[data-readout\]_&\]:not-print:grid/
		);
		expect(layout).toContain("!bare && '[:root[data-readout]_&]:pb-32");
		expect(authLayout).toContain('[:root[data-readout]_&]:pb-32');
	});
});
