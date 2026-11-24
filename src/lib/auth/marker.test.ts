// Whether a browser is signed in is written down in places that cannot share code: the cookie's
// name here, the boot script in app.html that reads the cookie before anything can be imported,
// and the stylesheet rules in the header's account control that show one control or another. A
// name changed in one and not the others leaves the header showing "sign in" to everybody, and
// nothing on the page would say why.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKER } from './marker.js';

const root = join(import.meta.dirname, '../../..');
const bootScript = readFileSync(join(root, 'src/app.html'), 'utf-8');
const marker = readFileSync(join(root, 'src/lib/auth/marker.ts'), 'utf-8');
const control = readFileSync(join(root, 'src/lib/auth/AccountButton.svelte'), 'utf-8');

describe('the signed-in marker', () => {
	it('is read by the boot script under the name the server sets it by', () => {
		// At the start of the cookie string or after a separator: not the tail of another name.
		expect(bootScript).toContain(`/(^|; )${MARKER}=/.test(document.cookie)`);
	});

	it('is put on <html> the same way by the boot script and after a move within the site', () => {
		const values = "? 'yes' : 'no'";
		expect(bootScript).toContain(`root.dataset.signedIn = /(^|; )${MARKER}=/`);
		expect(bootScript).toContain(values);
		expect(marker).toContain(`document.documentElement.dataset.signedIn = hasMarker() ${values}`);
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
});
