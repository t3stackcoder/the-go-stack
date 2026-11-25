/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import adapter from '@sveltejs/adapter-node';
import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, normalizePath, type Plugin } from 'vite';
import { highlight } from './plugins/highlight.js';
import { PROVIDERS } from './src/lib/auth/providers.js';

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
 * Where a form on this site may end up, besides the site itself: the providers a visitor can
 * sign in with. A provider's button is a form posted to this site, which answers with a redirect
 * to the provider, and a browser may hold the redirect that follows a form to the policy's
 * `form-action` as well as the form. Measured with a policy that did not name the origin the
 * form was redirected to: Chromium and WebKit refused to follow, and pressing the button did
 * nothing at all. Firefox followed it.
 *
 * The three real providers are always named: which of them are switched on is decided when the
 * server starts, long after this policy is written into the build. The fake that stands in for
 * them in development (compose.yaml) is named only while OAUTH_MOCK_URL is set, so a build made
 * without it carries no trace of it. That also means the variable has to be as wanted when the
 * site is built, and not only when it is run.
 */
function providerOrigins(mode: string): FormAction {
	const providers: FormAction = PROVIDERS.map((provider) => provider.origin);
	// Every variable, and not only those with Vite's prefix: this one is the server's.
	const mock = loadEnv(mode, process.cwd(), '').OAUTH_MOCK_URL;
	// src/env.ts is what refuses a value that is not an address on this machine. Here one that
	// cannot be read is left out, and the server says why as it fails to start. An origin read
	// from a URL is plain text to the type checker, where the policy's type spells a host out.
	return mock && URL.canParse(mock)
		? [...providers, new URL(mock).origin as FormAction[number]]
		: providers;
}

/** What the policy's `form-action` takes, as SvelteKit types it. */
type FormAction = NonNullable<
	NonNullable<
		NonNullable<NonNullable<Parameters<typeof sveltekit>[0]>['csp']>['directives']
	>['form-action']
>;

/**
 * Where this site's own source files live, as the bundler names them. Anchored to the project,
 * because a bare `src` is also a folder inside most packages, and may be one above this project.
 */
const SOURCE = `${normalizePath(resolve('src'))}/`;

/**
 * The part of src/lib/auth that is the header's, and so every page's: the account control and
 * what it is built from.
 */
const HEADER = /\/lib\/auth\/(AccountButton\.svelte|who\.svelte\.ts|marker\.ts|next\.ts)$/;

/** The fields and buttons the account pages' forms are made of. No other page has one. */
const ACCOUNT_FORMS = [`${SOURCE}lib/forms/Field.svelte`, `${SOURCE}lib/forms/Submit.svelte`];

/**
 * Whether a file is one that only the pages about a visitor's account use: their form parts,
 * and everything under src/lib/auth but the header's.
 */
function isAccounts(id: string) {
	const file = normalizePath(id);
	return (
		(file.startsWith(`${SOURCE}lib/auth/`) && !HEADER.test(file)) || ACCOUNT_FORMS.includes(file)
	);
}

/** The root layout, which is part of every page. */
const ROOT_LAYOUT = `${SOURCE}routes/+layout.svelte`;

/** Svelte and SvelteKit: the packages every page needs. */
const FRAMEWORK = /[\\/]node_modules[\\/](svelte|@sveltejs)[\\/]/;

/**
 * SvelteKit's payload module. It is an entry of the browser's build and has to keep a file of its
 * own: the app's first file sets the payload, and only then loads the code that reads it.
 */
const PAYLOAD = /[\\/]@sveltejs[\\/]kit[\\/]src[\\/]runtime[\\/]client[\\/]payload\.js$/;

/** The package a file under node_modules belongs to, such as `zod`. */
const packageOf = (id: string) =>
	/.*[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1].replace(/[\\/]/, '-') ?? null;

/**
 * Stops the build if the payload module has lost its file to a shared one.
 *
 * That is what the file-splitting rules below once did to it. A group takes the files its rule
 * names and whatever they import, the framework's files import the payload, and so it was moved
 * into the framework's file. The app's first file then ran the whole framework before the payload
 * had been set, and the browser's copy of the build version was `undefined`. The first answer
 * from the server looked like a new deployment, and from then on SvelteKit turned any navigation
 * that ended in an error status into a full page load: a refused form lost its message and
 * everything typed into it. Nothing failed where anyone would look, which is why the build does.
 */
function payloadKeepsItsFile(): Plugin {
	return {
		name: 'payload-keeps-its-file',
		applyToEnvironment: (environment) => environment.name === 'client',
		generateBundle(_, bundle) {
			const entry = Object.values(bundle).find(
				(file) => file.type === 'chunk' && file.isEntry && PAYLOAD.test(file.facadeModuleId ?? '')
			);
			if (entry?.type !== 'chunk') {
				this.error(
					"SvelteKit's payload module is no longer an entry of the browser's build, so " +
						'vite.config.ts cannot check that it kept a file of its own. Find where it went.'
				);
			}
			// The payload, the whole payload, and nothing but the payload. Anything else in the
			// file, or loaded by it, is code that runs before the payload has been set.
			const modules = Object.keys(entry.modules);
			const alone = modules.length === 1 && PAYLOAD.test(modules[0]) && entry.imports.length === 0;
			if (!alone) {
				this.error(
					`${entry.fileName} is not SvelteKit's payload module alone. It holds ` +
						`[${modules.join(', ')}] and imports [${entry.imports.join(', ')}]. Moved into ` +
						'a shared file, or sharing its own, the payload is read before it is set. The ' +
						'file-splitting rules in vite.config.ts must leave that module a file to itself.'
				);
			}
		}
	};
}

/**
 * Stops the build if the account pages' file has become every page's.
 *
 * It is kept apart by a rule further down, which goes by where a file lives. A rule like that
 * is one import away from being wrong: let the header use something from src/lib/auth that the
 * rule does not know to be the header's, and the whole file follows it into every page, for
 * pages with no form on them to download and never run. The site would work exactly as before,
 * which is why the build is what says so.
 */
function accountsStayOffOtherPages(): Plugin {
	return {
		name: 'accounts-stay-off-other-pages',
		applyToEnvironment: (environment) => environment.name === 'client',
		generateBundle(_, bundle) {
			const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
			const accounts = chunks.find((chunk) => chunk.name === 'accounts');
			// No such file means the account pages share nothing, and there is nothing to check.
			if (!accounts) return;

			const layout = chunks.find((chunk) => Object.keys(chunk.modules).includes(ROOT_LAYOUT));
			if (!layout) {
				this.error(
					"The root layout was not found in the browser's build, so vite.config.ts cannot " +
						"check that it does not load the account pages' file. Find where it went."
				);
			}

			// Everything the layout's file loads as it loads, however far down.
			const loaded = new Set<string>();
			const follow = (fileName: string) => {
				if (loaded.has(fileName)) return;
				loaded.add(fileName);
				const file = bundle[fileName];
				if (file?.type === 'chunk') file.imports.forEach(follow);
			};
			follow(layout.fileName);

			if (loaded.has(accounts.fileName)) {
				this.error(
					`The root layout loads ${accounts.fileName}, the file of code that only the account ` +
						'pages use, so every page now downloads it. Something the header imports from ' +
						'src/lib/auth is not named in HEADER in vite.config.ts: name it there, or move it. ' +
						`The file holds [${Object.keys(accounts.modules)
							.map((id) => normalizePath(id).replace(SOURCE, ''))
							.join(', ')}].`
				);
			}
		}
	};
}

export default defineConfig(({ mode }) => ({
	// Tests sit beside the code they test, and run in Node unless a file asks for otherwise. The
	// services under docker/ and the scripts under scripts/ are tested the same way.
	test: { include: ['src/**/*.test.ts', 'docker/**/*.test.ts', 'scripts/**/*.test.ts'] },
	// How the browser's JavaScript is cut into files. Left alone, the bundler gives every distinct
	// set of pages that share some code a file of its own, and a page of this site asked for 21 to
	// 28 of them, some 22 bytes long. A page is not interactive until the last has arrived.
	//
	// Three rules gather the pieces. Code from Svelte and SvelteKit that more than one entry uses
	// goes into one file, which changes only when they do. Any other package that more than one
	// entry uses gets a file to itself, fetched by the pages that use that package and by no
	// others. This site's own source that three or more pages use goes into another. The rest is
	// cut as before: a page's own code is in the page's file, and code that exactly two pages
	// share, such as a code sample printed on both, keeps a small file to itself. So do SvelteKit's
	// entry files and the bundler's helpers. A page now asks for 13 to 16 files.
	//
	// A fourth rule, listed first, gathers nothing. It keeps one module out of the other three:
	// SvelteKit's payload, which the framework's files import and which would otherwise follow
	// them into their file. What that broke is told above `payloadKeepsItsFile`, which fails the
	// build if it happens again. Leaving the payload out of the other rules' tests is not enough
	// without it, because a group also takes whatever its files import. It costs one more file a
	// page, about 140 bytes on the wire.
	//
	// A fifth rule keeps the third from costing every page what only a few need. The pages about
	// a visitor's account (signing in and up, a new password, the account itself) share their
	// fields, their buttons and their sentences, and there are more than three of them, so the
	// third rule put all of it into the file every page fetches. Measured on 2026-11-23: that
	// file went from 7.4 KB to 9.3 KB on the wire, and the home page was paying for a sign-in
	// form it does not have. Now that code is a file of its own, 3.1 KB, fetched by those pages
	// alone, and the shared file is 7.4 KB again. The rule stands after the two for packages and
	// not ahead of them: a group takes what its files import, and listed first it took Svelte
	// itself. The header's account control is the exception to it, being part of every page, and
	// `accountsStayOffOtherPages` fails the build if the rest is ever pulled in after it.
	//
	// The second rule was once part of the first, which took in every package. That held while
	// Svelte and SvelteKit were the only ones. Then a form library was tried on four pages, since
	// removed. It went into the file every page fetches, and each page of the site was 8.6 KB
	// heavier on the wire for a library it never ran. In a file of its own it was 9.5 KB, sent to
	// those four. The rule stays for the next package a few pages share.
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
								{ name: 'payload', test: PAYLOAD, priority: 10 },
								{
									name: 'framework',
									test: (id) => FRAMEWORK.test(id) && !PAYLOAD.test(id),
									minShareCount: 2
								},
								{
									name: packageOf,
									test: (id) => /node_modules/.test(id) && !PAYLOAD.test(id),
									minShareCount: 2
								},
								{ name: 'accounts', test: isAccounts, minShareCount: 2 },
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
		payloadKeepsItsFile(),
		accountsStayOffOtherPages(),
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
					'form-action': ['self', ...providerOrigins(mode)],
					// Only reaches pages rendered per request. See server.js for the rest.
					'frame-ancestors': ['none']
				}
			},
			adapter: adapter()
		})
	]
}));
