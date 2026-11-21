import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { codeToHtml } from 'shiki';
import type { Plugin } from 'vite';

const QUERY = '?highlight';

// The highlighted module is given an id of its own rather than keeping the source file's. Left as
// `Counter.svelte?highlight`, other plugins would still see a Svelte file and try to compile the
// generated JavaScript; left as `+page.server.ts?highlight`, it could be mistaken for server-only
// code. The leading NUL is the Rollup convention for "virtual: other plugins, leave this alone".
const PREFIX = '\0highlight:';
const SUFFIX = '.js';

const LANGUAGES: Record<string, string> = {
	'.svelte': 'svelte',
	'.ts': 'typescript',
	'.js': 'javascript',
	'.css': 'css',
	'.html': 'html',
	'.json': 'json'
};

/**
 * Lets a page import the highlighted source of a real file:
 *
 *     import source from './Counter.svelte?highlight';
 *
 * The code shown on the site is therefore the code that runs the site: it cannot drift, because
 * there is only one copy. Highlighting happens at build time, so no highlighter is ever sent to
 * the browser. Each token carries a light and a dark colour as CSS variables; the stylesheet picks
 * one with `light-dark()`, the same way every other colour on the site is chosen.
 */
export function highlight(): Plugin {
	return {
		name: 'highlight',
		enforce: 'pre',

		async resolveId(source, importer) {
			if (!source.endsWith(QUERY)) return;

			const file = await this.resolve(source.slice(0, -QUERY.length), importer, {
				skipSelf: true
			});
			if (!file) this.error(`Cannot highlight ${source}: the file was not found.`);

			return PREFIX + file.id + SUFFIX;
		},

		async load(id) {
			if (!id.startsWith(PREFIX)) return;

			const file = id.slice(PREFIX.length, -SUFFIX.length);
			const language = LANGUAGES[extname(file)];
			if (!language) {
				this.error(`Cannot highlight ${file}: no language is configured for its extension.`);
			}

			this.addWatchFile(file);
			const source = await readFile(file, 'utf8');
			const html = await codeToHtml(source.trimEnd(), {
				lang: language,
				themes: { light: 'github-light-default', dark: 'github-dark-default' },
				defaultColor: false
			});

			return `export default ${JSON.stringify(html)};`;
		}
	};
}
