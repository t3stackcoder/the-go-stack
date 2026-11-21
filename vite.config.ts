import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
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

export default defineConfig({
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
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
