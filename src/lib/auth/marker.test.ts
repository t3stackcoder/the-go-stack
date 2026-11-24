// Whether a browser is signed in, and whether as someone who may open the admin area, is written
// down in places that cannot share code: the cookie's name and values here, the boot script in
// app.html that reads the cookie before anything can be imported, and the stylesheet rules in the
// header's controls that show one control or another. A name or a value changed in one and not
// the others leaves the header showing "sign in" to everybody, or the admin button to nobody, and
// nothing on the page would say why.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKED, MARKER } from './marker.js';

const root = join(import.meta.dirname, '../../..');
const bootScript = readFileSync(join(root, 'src/app.html'), 'utf-8');
const marker = readFileSync(join(root, 'src/lib/auth/marker.ts'), 'utf-8');
const control = readFileSync(join(root, 'src/lib/auth/AccountButton.svelte'), 'utf-8');
const adminButton = readFileSync(join(root, 'src/lib/auth/AdminButton.svelte'), 'utf-8');

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

		expect(bootScript).toContain(`if (marker === '${MARKED.admin}') root.dataset.admin = ''`);
		expect(marker).toContain("if (marker === MARKED.admin) root.dataset.admin = ''");
		expect(bootScript).toContain('else delete root.dataset.admin');
		expect(marker).toContain('else delete root.dataset.admin');
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
});
