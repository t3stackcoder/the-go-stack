<!--
	The shared frame for the three rendering demos. The pages differ only in how they are rendered,
	so everything visible is the same component, fed the same catalog.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import CatalogGrid from '#lib/demo/CatalogGrid.svelte';
	import type { Product } from '#lib/demo/catalog.js';
	import Code from '#lib/ui/Code.svelte';

	const modes = [
		{ path: '/rendering/server', label: 'Server only', tab: 'Server only' },
		{ path: '/rendering/hybrid', label: 'Server and client', tab: 'Both' },
		{ path: '/rendering/client', label: 'Client only', tab: 'Client only' }
	] as const;

	let {
		path,
		summary,
		notice,
		products,
		source,
		file,
		children
	}: {
		path: (typeof modes)[number]['path'];
		summary: string;
		/** What the reader should look for on this page. */
		notice: string[];
		products: Product[];
		/** The `?highlight` import of the file that sets this page's rendering mode. */
		source: string;
		file: string;
		/** Extra content between the notes and the catalog. */
		children?: Snippet;
	} = $props();

	const mode = $derived(modes.find((candidate) => candidate.path === path)!);
</script>

<svelte:head>
	<title>{mode.label} · The case for SvelteKit</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<a href={resolve('/rendering')} class="font-mono text-sm text-accent-text hover:underline">
		← Chapter 01 · Rendering
	</a>

	<nav aria-label="Rendering modes" class="mt-6">
		<!--
			A block that hugs its tabs, not an inline box. A page can be painted while its HTML is
			still arriving, and an inline box drawn empty moved up when its tabs turned up.
		-->
		<ul class="flex w-fit gap-1 rounded-xl border border-line bg-sunken p-1 text-sm">
			{#each modes as candidate (candidate.path)}
				<li>
					<!--
						The link to the server-only page always makes a full page load. `csr = false` is a
						setting the server reads. A page already running in the browser cannot see it, and
						would render that page itself: with JavaScript, and a readout that wakes up.
					-->
					<a
						href={resolve(candidate.path)}
						aria-current={candidate.path === path ? 'page' : undefined}
						data-sveltekit-reload={candidate.path === '/rendering/server' ? true : undefined}
						class="block rounded-lg px-3 py-1.5 whitespace-nowrap text-ink-muted hover:text-ink aria-[current]:bg-surface aria-[current]:font-medium aria-[current]:text-ink aria-[current]:shadow-sm"
					>
						{candidate.tab}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<h1 class="mt-8 font-display text-4xl font-semibold tracking-tight sm:text-5xl">{mode.label}</h1>
	<p class="mt-4 max-w-2xl text-lg text-ink-muted">{summary}</p>

	<div class="mt-8 grid gap-6 lg:grid-cols-2">
		<section class="rounded-2xl border border-line bg-surface p-5">
			<h2 class="text-sm font-medium">What to notice</h2>
			<ul class="mt-3 space-y-2 text-ink-muted">
				{#each notice as item (item)}
					<li class="flex gap-3">
						<span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
						{item}
					</li>
				{/each}
			</ul>
		</section>

		<Code html={source} {file} />
	</div>

	{#if children}
		<div class="mt-6">{@render children()}</div>
	{/if}

	<div class="mt-10">
		<CatalogGrid {products} />
	</div>
</div>
