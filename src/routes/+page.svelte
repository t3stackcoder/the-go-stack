<script lang="ts">
	import { resolve } from '$app/paths';
	import { kilobytes, metrics, shiftScore } from '#lib/hud/metrics.svelte.js';
	import { chapters } from '#lib/site/chapters.js';
	import ClientOnly from '#lib/stable/ClientOnly.svelte';

	const rules = [
		{
			title: 'Every demo runs',
			body: 'The demos are real components running in your browser, not recordings or screenshots.'
		},
		{
			title: 'Every number is measured',
			body: 'No benchmark is quoted. Anything numeric is measured on your device while you watch.'
		},
		{
			title: 'Every code sample is the running file',
			body: 'Code is imported into the page from the file that runs, so it cannot drift from the truth.'
		},
		{
			title: 'It argues against itself',
			body: 'Chapter 06 makes the case against SvelteKit, as hard as it honestly can.'
		}
	];
</script>

<svelte:head>
	<title>The case for SvelteKit</title>
	<meta
		name="description"
		content="Is SvelteKit worth using? An argument built with SvelteKit, where every claim is something you can watch happen in your own browser."
	/>
</svelte:head>

{#snippet stat(label: string, value: string, unit: string, tone = '')}
	<div class="rounded-2xl border border-line bg-surface p-5">
		<p class="text-sm text-ink-muted">{label}</p>
		<p class="mt-2 truncate font-display text-4xl font-semibold tracking-tight tabular-nums">
			<span class={tone}>{value}</span>
			<span class="text-base font-normal tracking-normal text-ink-subtle">{unit}</span>
		</p>
	</div>
{/snippet}

<div class="mx-auto max-w-6xl px-6 pt-20 pb-12 sm:pt-28">
	<header class="max-w-4xl">
		<p class="font-mono text-sm text-accent-text">An argument, with evidence</p>
		<h1
			class="mt-5 font-display text-6xl font-semibold tracking-tighter text-balance sm:text-8xl sm:leading-none"
		>
			Is SvelteKit worth it?
		</h1>
		<p class="mt-8 max-w-2xl text-xl leading-relaxed text-pretty text-ink-muted sm:text-2xl">
			This site is the argument and the evidence. It is built with SvelteKit, and every claim it
			makes is one you can watch happen in your own browser.
		</p>
		<div class="mt-10 flex flex-wrap gap-3">
			<a
				href={resolve('/rendering')}
				class="rounded-lg bg-accent px-5 py-3 font-semibold text-accent-ink"
			>
				Start with chapter 01 <span aria-hidden="true">→</span>
			</a>
			<a
				href={resolve('/tradeoffs')}
				class="rounded-lg border border-line bg-surface px-5 py-3 font-medium hover:border-line-strong"
			>
				Skip to the case against
			</a>
		</div>
	</header>

	<section class="mt-20" aria-labelledby="proof">
		<h2 id="proof" class="font-mono text-sm text-ink-subtle">
			This page, measured on your device a moment ago
		</h2>

		<!-- Four tiles of fixed height: one row on wide screens, two rows of two on narrow ones. -->
		<ClientOnly class="mt-4 h-60 lg:h-28">
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				{@render stat('JavaScript sent', kilobytes(metrics.scriptBytes), 'KB')}
				{@render stat('Interactive after', metrics.hydratedAt?.toFixed(0) ?? '', 'ms')}
				{#if metrics.serverMs === undefined}
					{@render stat('Server time', '0', 'ms, prerendered')}
				{:else}
					{@render stat('Server time', metrics.serverMs.toFixed(1), 'ms')}
				{/if}
				{#if metrics.layoutShift === undefined}
					{@render stat('Layout shift', 'n/a', 'in this browser')}
				{:else}
					{@render stat(
						'Layout shift',
						shiftScore(metrics.layoutShift),
						'',
						metrics.layoutShift === 0 ? 'text-good' : 'text-bad'
					)}
				{/if}
			</div>

			{#snippet placeholder()}
				<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
					{#each [0, 1, 2, 3] as tile (tile)}
						<div class="skeleton rounded-2xl"></div>
					{/each}
				</div>
			{/snippet}
		</ClientOnly>

		<p class="mt-4 max-w-2xl text-ink-muted">
			Reload and they are measured again. The same figures follow you through every chapter, in the
			readout at the bottom of the screen.
		</p>
	</section>

	<section class="mt-24" aria-labelledby="rules">
		<h2 id="rules" class="font-display text-3xl font-semibold tracking-tight">The ground rules</h2>
		<ul class="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
			{#each rules as rule, index (rule.title)}
				<li class="border-t border-line-strong pt-4">
					<p class="font-mono text-xs text-ink-subtle">0{index + 1}</p>
					<h3 class="mt-2 font-semibold">{rule.title}</h3>
					<p class="mt-2 text-ink-muted">{rule.body}</p>
				</li>
			{/each}
		</ul>
	</section>

	<section class="mt-24" aria-labelledby="chapters">
		<h2 id="chapters" class="font-display text-3xl font-semibold tracking-tight">
			Seven chapters, in order
		</h2>
		<ol class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each chapters as chapter (chapter.path)}
				<li>
					<a
						href={resolve(chapter.path)}
						class="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 hover:border-line-strong"
					>
						<p class="font-mono text-xs text-accent-text">{chapter.number} · {chapter.title}</p>
						<h3
							class="mt-3 font-display text-2xl font-semibold tracking-tight group-hover:text-accent-text"
						>
							{chapter.headline}
						</h3>
						<p class="mt-3 text-ink-muted">{chapter.blurb}</p>
					</a>
				</li>
			{/each}
		</ol>
	</section>
</div>
