<!--
	The frame every chapter page shares: its heading, its content, and the link to the next chapter.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { chapters, type ChapterPath } from '#lib/site/chapters.js';

	let {
		path,
		lede,
		children
	}: {
		path: ChapterPath;
		/** One or two sentences under the headline. Also used as the page description. */
		lede: string;
		children: Snippet;
	} = $props();

	const index = $derived(chapters.findIndex((chapter) => chapter.path === path));
	const chapter = $derived(chapters[index]);
	const next = $derived(chapters.at(index + 1));
</script>

<svelte:head>
	<title>{chapter.headline} · The case for SvelteKit</title>
	<meta name="description" content={lede} />
</svelte:head>

<article class="mx-auto max-w-6xl px-6 pt-16 pb-12 sm:pt-24">
	<header class="max-w-3xl">
		<p class="font-mono text-sm text-accent-text">Chapter {chapter.number} · {chapter.title}</p>
		<h1
			class="mt-4 font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]"
		>
			{chapter.headline}
		</h1>
		<p class="mt-6 text-xl leading-relaxed text-pretty text-ink-muted">{lede}</p>
	</header>

	<div class="mt-16 space-y-16">
		{@render children()}
	</div>

	{#if next}
		<nav aria-label="Next chapter" class="mt-24 border-t border-line pt-10">
			<a href={resolve(next.path)} class="group block max-w-3xl">
				<p class="font-mono text-sm text-ink-subtle">Next · Chapter {next.number}</p>
				<p
					class="mt-2 font-display text-3xl font-semibold tracking-tight group-hover:text-accent-text sm:text-4xl"
				>
					{next.headline} <span aria-hidden="true">→</span>
				</p>
				<p class="mt-2 text-ink-muted">{next.blurb}</p>
			</a>
		</nav>
	{/if}
</article>
