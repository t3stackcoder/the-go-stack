<script lang="ts">
	import Streamed from '#lib/stable/Streamed.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Stress: streamed values</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		{data.values.length} streamed values{data.hung ? ', and one that never arrives' : ''}
	</h1>

	<ul class="mt-6 grid grid-cols-4 gap-2 sm:grid-cols-8">
		{#each data.values as value, index (index)}
			<li class="rounded-lg border border-line p-2">
				<Streamed promise={value} class="h-10">
					{#snippet children(settled: { index: number; delay: number })}
						<p data-settled class="self-center text-sm tabular-nums">
							#{settled.index} · {settled.delay} ms
						</p>
					{/snippet}
				</Streamed>
			</li>
		{/each}
	</ul>

	{#if data.hung}
		<section class="mt-6 rounded-lg border border-line p-4">
			<h2 class="text-sm font-medium">A dependency that has stopped answering</h2>
			<Streamed promise={data.hung} class="mt-2 h-10">
				<p data-settled class="self-center text-sm">It answered.</p>
			</Streamed>
		</section>
	{/if}

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
