<!--
	The shared frame for the three data demos: where you are, what to look for, the live demo, and
	the real files that run it. The words live here, so each demo page is only the demo.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Code from '#lib/ui/Code.svelte';
	import Demo from '#lib/ui/Demo.svelte';

	const demos = [
		{
			path: '/data/typed',
			tab: 'Types',
			label: 'Typed from server to template',
			summary:
				'A load function runs on the server and returns plain data. The page receives it as a typed prop, with no API, no fetch and no response types in between.',
			notice: [
				'Every value was read on the server during this request. The browser cannot read a Node.js version or a process’s memory; the page can show them because the server sent them.',
				'The template calls toISOString() on data.renderedAt. It is still a Date when it reaches the page: load can return Dates, Maps, Sets and BigInts, not only what JSON can carry.',
				'Rename renderedAt in the server file and the type check fails on this template, with the line number. There is no second definition to keep in step.',
				'“Run load again” re-runs the same function. With JavaScript, the browser fetches only the new data, not a new page. Without it, the button still works, as a page reload.'
			],
			title: 'Read on the server',
			note: 'This request'
		},
		{
			path: '/data/streaming',
			tab: 'Streaming',
			label: 'Slow data streams in',
			summary:
				'The page is sent as soon as its fast data is ready. Each slow part follows in the same HTTP response when it is done, into space held open for it.',
			notice: [
				'The page and the catalog panel arrived first. Nothing waited for the slowest service.',
				'Each slow panel streamed into the same response when its data was ready, and appeared in a box already sized for it. The readout’s layout shift stays at 0.',
				'One service fails on purpose. Its error is shown in its own panel and the rest of the page is untouched.',
				'The delays are simulated with timers on the server. The times on screen are measured in your browser, from the moment it requested the page.'
			],
			title: 'Streamed dashboard',
			note: 'Simulated delays'
		},
		{
			path: '/data/search',
			tab: 'Search',
			label: 'The URL as state',
			summary:
				'The search box is a plain HTML form. Its state is the query string, so the server can render any search, and the browser can make each one without reloading.',
			notice: [
				'Type, and the results follow. Each keystroke submits the form, which becomes a navigation to ?q=… that re-runs load on the server. Focus stays in the box.',
				'The URL is the whole state. Copy it, reload it or send it to someone, and the same results come back.',
				'Turn JavaScript off and it still works. It is a form with method GET, and the server renders the results.',
				'The results box has a fixed height. However many codes match, nothing below it moves.',
				'The readout shows how long each search took, and that it fetched no new JavaScript.'
			],
			title: 'HTTP status codes',
			note: 'Server-filtered'
		}
	] as const;

	let {
		path,
		files,
		children
	}: {
		path: (typeof demos)[number]['path'];
		/** The files that run the demo: `?highlight` imports and their paths. */
		files: { html: string; file: string }[];
		/** The demo itself. */
		children: Snippet;
	} = $props();

	const demo = $derived(demos.find((candidate) => candidate.path === path)!);
</script>

<svelte:head>
	<title>{demo.label} · The case for SvelteKit</title>
	<meta name="description" content={demo.summary} />
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<a href={resolve('/data')} class="font-mono text-sm text-accent-text hover:underline">
		← Chapter 03 · Data
	</a>

	<nav aria-label="Data demos" class="mt-6">
		<ul class="inline-flex gap-1 rounded-xl border border-line bg-sunken p-1 text-sm">
			{#each demos as candidate (candidate.path)}
				<li>
					<!-- The streaming demo times a full page load, so links to it always make one. -->
					<a
						href={resolve(candidate.path)}
						aria-current={candidate.path === path ? 'page' : undefined}
						data-sveltekit-reload={candidate.path === '/data/streaming' ? true : undefined}
						class="block rounded-lg px-3 py-1.5 whitespace-nowrap text-ink-muted hover:text-ink aria-[current]:bg-surface aria-[current]:font-medium aria-[current]:text-ink aria-[current]:shadow-sm"
					>
						{candidate.tab}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-10">
		<div>
			<h1 class="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
				{demo.label}
			</h1>
			<p class="mt-4 text-lg text-pretty text-ink-muted">{demo.summary}</p>
		</div>

		<section class="self-start rounded-2xl border border-line bg-surface p-5">
			<h2 class="text-sm font-medium">What to notice</h2>
			<ul class="mt-3 space-y-2 text-ink-muted">
				{#each demo.notice as item (item)}
					<li class="flex gap-3">
						<span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
						<span>{item}</span>
					</li>
				{/each}
			</ul>
		</section>
	</div>

	<div class="mt-10">
		<Demo title={demo.title} note={demo.note}>
			{@render children()}
		</Demo>
	</div>

	<h2 class="mt-16 font-display text-2xl font-semibold tracking-tight">The code</h2>
	<p class="mt-2 max-w-2xl text-ink-muted">
		The complete files behind the demo above, imported into this page from the files that run it.
	</p>
	<div class="mt-6 max-w-4xl space-y-6">
		{#each files as { html, file } (file)}
			<Code {html} {file} />
		{/each}
	</div>
</div>
