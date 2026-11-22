import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, normalizePath } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import { highlight } from './plugins/highlight.js';

/**
 * The one inline script in src/app.html, which has to be named in the content security policy
 * by its hash: a nonce cannot be used in the template while any page is prerendered.
 *
 * The hash is computed from the file each time this configuration is read, so the two cannot
 * drift apart. (Edit the script while the development server is running and the browser will
 * refuse it until the server is restarted.) Line endings are normalised first, because that is
 * what a browser does to a script before hashing it.
 */
function bootScriptHash() {
	const scripts = [
		...readFileSync('src/app.html', 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)
	];
	if (scripts.length !== 1) {
		throw new Error(
			`src/app.html must contain exactly one inline script, and has ${scripts.length}. ` +
				`The content security policy allows that one script by its hash.`
		);
	}
	const script = scripts[0][1].replaceAll('\r\n', '\n');
	return `sha256-${createHash('sha256').update(script).digest('base64')}` as const;
}

/**
 * Where this site's own source files live, as the bundler names them. Anchored to the project,
 * because a bare `src` is also a folder inside most packages, and may be one above this project.
 */
const SOURCE = `${normalizePath(resolve('src'))}/`;

export default defineConfig({
	// How the browser's JavaScript is cut into files. Left alone, the bundler gives every distinct
	// set of pages that share some code a file of its own, and a page of this site asked for 21 to
	// 28 of them, some 22 bytes long. A page is not interactive until the last has arrived.
	//
	// Two rules gather the pieces. Code from packages that more than one entry uses goes into one
	// file, which changes only when a dependency does. This site's own source that three or more
	// pages use goes into another. The rest is cut as before: a page's own code is in the page's
	// file, and code that exactly two pages share, such as a code sample printed on both, keeps a
	// small file to itself. So do SvelteKit's entry files and the bundler's helpers. A page now
	// asks for 11 to 15 files.
	//
	// Measured on 2026-11-21, loading the two builds alternately in Chromium. Over HTTP/1.1, where
	// a browser fetches six files at a time, pages were interactive 50 to 70 ms sooner at a 20 ms
	// round trip, and 120 to 190 ms sooner at 150 ms on a slow line and a slow processor. Over
	// HTTP/2, where files do not queue, there was no difference to measure at 20 ms, and 60 to
	// 100 ms at 150 ms. The JavaScript is 2 to 6 KB smaller on the wire, because one large file
	// compresses better than many small ones.
	//
	// The price is in the second file. Every page downloads all of it, 5 KB compressed, including
	// the parts it does not use, and an edit to anything in it gives it a new name, so a returning
	// visitor fetches it again.
	//
	// Only shared code is gathered. SvelteKit's build looks for its entry modules in files of
	// their own, and a rule that took them in would break it. This applies to the browser's build
	// alone: the server's files are laid out by SvelteKit.
	environments: {
		client: {
			build: {
				rolldownOptions: {
					output: {
						codeSplitting: {
							groups: [
								{ name: 'framework', test: /node_modules/, minShareCount: 2 },
								{
									name: 'shared',
									test: (id) => normalizePath(id).startsWith(SOURCE),
									minShareCount: 3
								}
							]
						}
					}
				}
			}
		}
	},
	plugins: [
		highlight(),
		tailwindcss(),
		// Turns `?enhanced` image imports into AVIF, WebP and fallback files with known dimensions.
		// Pages use them through src/lib/stable/Image.svelte.
		enhancedImages(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Stylesheets up to this many bytes are written into the page's HTML instead of being
			// linked. A linked stylesheet is a second round trip that blocks first paint: measured on
			// this site over a 150 ms connection, inlining took first paint from about 700 ms to about
			// 340 ms. The cost is the CSS being resent with each full page load, which compression
			// keeps to a few kilobytes. Above the threshold it quietly goes back to a link.
			inlineStyleThreshold: 60_000,
			// Addresses are written the same way on the server and in the browser: from the root.
			// By default the server writes them relative to the page (`./rendering`) and the browser
			// from the root (`/rendering`), so hydration found every link on the page different from
			// its own and rewrote it: 9 to 17 attribute writes a page, to arrive at the same address.
			// Relative addresses are for HTML that has to work from an unknown folder. This site is
			// served from the root of its own origin.
			paths: { relative: false },
			// The content security policy. SvelteKit adds what its own output needs: a hash for
			// each inline script and stylesheet of a prerendered page, where the policy travels
			// in a <meta> tag, and a nonce for pages rendered per request, where it is a header.
			//
			// Scripts are held to the strict rule: this origin's files, and inline scripts only by
			// hash or nonce. Styles are not, and that is the one thing given up. A <style> element
			// needs a hash or nonce like a script, but `style` attributes are allowed outright,
			// because the site is built on them: every token of highlighted code carries its two
			// colours in one, and so does anything sized with a `style:` directive. An attribute
			// can only style the element it is on, which is why this is the acceptable place to
			// give way.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', bootScriptHash()],
					'style-src-elem': ['self'],
					'style-src-attr': ['unsafe-inline'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					// Only reaches pages rendered per request. See server.js for the rest.
					'frame-ancestors': ['none']
				}
			},
			adapter: adapter()
		})
	]
});
