// What may only be written in one place, or not at all. Each rule names the one file that is
// exempt from it, the component that does the job properly.
//
// These were lint rules until the project moved to Biome, which cannot inspect Svelte markup this
// way. They are checked here against the compiler's own reading of every component, so a comment
// or a code sample that mentions an element cannot trip them.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type Node = { type?: string; name?: string; start?: number; attributes?: Node[] };

type Rule = {
	description: string;
	/** Relative to the project root, with forward slashes. */
	exempt: string;
	matches: (node: Node) => boolean;
	message: string;
	/** A component that breaks the rule, to show the check can fail. */
	breach: string;
};

const rules: Rule[] = [
	// An image whose box is not reserved moves the page when it arrives.
	{
		description: 'no bare <img>',
		exempt: 'src/lib/stable/Image.svelte',
		matches: (node) => node.name === 'img' || node.name === 'enhanced:img',
		message:
			'Use Image from #lib/stable/Image.svelte. It reserves the space the image will occupy, so the page cannot shift when the image arrives.',
		breach: '{#if ok}<div><img src="a.png" alt="" /></div>{/if}'
	},
	// Both of the next two lose what a visitor entered, through faults in Svelte 5.59. A <textarea>
	// given only a default is sent from the server empty. A <select> written with `bind:value` is set
	// back by hydration to what the server sent, where one given `defaultValue` keeps a choice made
	// while the page was loading.
	{
		description: 'no bare <textarea>',
		exempt: 'src/lib/forms/Textarea.svelte',
		matches: (node) => node.name === 'textarea',
		message:
			'Use Textarea from #lib/forms/Textarea.svelte. A bare <textarea> given a default arrives from the server empty.',
		breach: '<textarea></textarea>'
	},
	{
		description: 'no <select bind:value>',
		exempt: '',
		matches: (node) =>
			node.name === 'select' &&
			(node.attributes ?? []).some(
				(attribute) => attribute.type === 'BindDirective' && attribute.name === 'value'
			),
		message:
			'Give the <select> a `defaultValue` and read its value when it changes. With `bind:value`, hydration undoes a choice made while the page was loading.',
		breach: '<select bind:value={choice}></select>'
	}
];

const root = join(import.meta.dirname, '..');

function svelteFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
		.map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
}

/** Every element in a component, wherever it is nested: in blocks, snippets or other elements. */
function* elements(node: unknown): Generator<Node> {
	if (Array.isArray(node)) {
		for (const child of node) yield* elements(child);
		return;
	}
	if (node === null || typeof node !== 'object') return;
	const candidate = node as Node;
	if (candidate.type === 'RegularElement') yield candidate;
	for (const [key, value] of Object.entries(node)) {
		// Scripts and styles hold no markup, and their trees are large.
		if (key !== 'instance' && key !== 'module' && key !== 'css') yield* elements(value);
	}
}

function lineOf(source: string, offset: number) {
	return source.slice(0, offset).split('\n').length;
}

/** Where a rule is broken, as `file:line`, across every component in the project. */
function breaches(rule: Rule, files: { file: string; source: string }[]) {
	return files
		.filter(({ file }) => file !== rule.exempt)
		.flatMap(({ file, source }) =>
			[...elements(parse(source, { modern: true }).fragment)]
				.filter(rule.matches)
				.map((node) => `${file}:${lineOf(source, node.start ?? 0)}`)
		);
}

const project = svelteFiles(join(root, 'src')).map((file) => ({
	file,
	source: readFileSync(join(root, file), 'utf-8')
}));

describe('markup that may only be written in one place', () => {
	it('finds components to check', () => {
		expect(project.length).toBeGreaterThan(0);
	});

	for (const rule of rules) {
		it(rule.description, () => {
			expect(breaches(rule, project), rule.message).toEqual([]);
		});

		it(`${rule.description}: the check can fail`, () => {
			expect(breaches(rule, [{ file: 'Breach.svelte', source: rule.breach }])).toEqual([
				'Breach.svelte:1'
			]);
		});
	}
});
