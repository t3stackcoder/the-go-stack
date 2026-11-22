import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

// An image whose box is not reserved moves the page when it arrives. The Image component reserves
// it, so it is the only place an <img> may be written.
const BARE_IMAGE = {
	selector: 'SvelteElement[name.name=/^(enhanced:)?img$/]',
	message:
		'Use Image from #lib/stable/Image.svelte. It reserves the space the image will occupy, so the page cannot shift when the image arrives.'
};

// The two kinds of field that lose what a visitor entered, both through faults in Svelte 5.59.
// A <textarea> given only a default is sent from the server empty, and the Textarea component
// works around that. A <select> written with `bind:value` is set back by hydration to what the
// server sent, where one given `defaultValue` keeps a choice made while the page was loading.
const BARE_TEXTAREA = {
	selector: 'SvelteElement[name.name="textarea"]',
	message:
		'Use Textarea from #lib/forms/Textarea.svelte. A bare <textarea> given a default arrives from the server empty.'
};
const BOUND_SELECT = {
	selector:
		'SvelteElement[name.name="select"] > SvelteStartTag > SvelteDirective[kind="Binding"][key.name.name="value"]',
	message:
		'Give the <select> a `defaultValue` and read its value when it changes. With `bind:value`, hydration undoes a choice made while the page was loading.'
};

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommendedTypeChecked,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: {
			parserOptions: { projectService: true },
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	// What may only be written in one place, or not at all. Each rule is listed with the one file
	// that is exempt from it, because a file's `no-restricted-syntax` is a single list: the
	// exemption has to restate the rules that still apply there.
	{
		files: ['**/*.svelte'],
		rules: { 'no-restricted-syntax': ['error', BARE_IMAGE, BARE_TEXTAREA, BOUND_SELECT] }
	},
	{
		files: ['src/lib/stable/Image.svelte'],
		rules: { 'no-restricted-syntax': ['error', BARE_TEXTAREA, BOUND_SELECT] }
	},
	{
		files: ['src/lib/forms/Textarea.svelte'],
		rules: { 'no-restricted-syntax': ['error', BARE_IMAGE, BOUND_SELECT] }
	}
);
