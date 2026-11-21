/**
 * The site's argument, in reading order. The navigation, the home page and the "next chapter"
 * link at the foot of each page are all generated from this list.
 */
export const chapters = [
	{
		path: '/rendering',
		number: '01',
		title: 'Rendering',
		headline: 'One page, three ways',
		blurb: 'Server only, client only, or both. One line decides, per page.'
	},
	{
		path: '/reactivity',
		number: '02',
		title: 'Reactivity',
		headline: 'State without ceremony',
		blurb: 'Runes: reactive state as plain variables, compiled to precise updates.'
	},
	{
		path: '/data',
		number: '03',
		title: 'Data',
		headline: 'Data that arrives when it is ready',
		blurb: 'Typed from database to template. Slow parts stream in; fast parts never wait.'
	},
	{
		path: '/forms',
		number: '04',
		title: 'Forms',
		headline: 'Forms that work before JavaScript does',
		blurb: 'Plain HTML forms, upgraded in place. Turn JavaScript off and they still submit.'
	},
	{
		path: '/stability',
		number: '05',
		title: 'Stability',
		headline: 'Nothing moves',
		blurb: 'How this site guarantees zero layout shift, and the audit that proves it.'
	},
	{
		path: '/tradeoffs',
		number: '06',
		title: 'Tradeoffs',
		headline: 'What it costs you',
		blurb: 'The honest part. Where SvelteKit is the wrong choice, and why.'
	},
	{
		path: '/verdict',
		number: '07',
		title: 'Verdict',
		headline: 'Should you use it?',
		blurb: 'Answer a few questions about your project and get a straight answer.'
	}
] as const;

export type Chapter = (typeof chapters)[number];
export type ChapterPath = Chapter['path'];
