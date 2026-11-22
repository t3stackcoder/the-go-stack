<script lang="ts">
	import Streamed from '#lib/stable/Streamed.svelte';
	import { browser } from '$app/env';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let clicked = $state(false);

	function fail(moment: string): never {
		throw new Error(`stress: thrown at "${moment}". No visitor should ever read this sentence.`);
	}

	// Read from the template, so the throw happens during rendering and not in an event handler.
	const rendered = $derived.by(() => {
		if (data.when === 'server' && !browser) fail('server');
		if (data.when === 'hydrate' && browser) fail('hydrate');
		if (data.when === 'update' && clicked) fail('update');
		return 'rendered';
	});

	$effect(() => {
		if (data.when === 'effect') fail('effect');
	});

	function click() {
		if (data.when === 'handler') fail('handler');
		clicked = true;
	}
</script>

<svelte:head>
	<title>Stress: a component that throws</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A component that throws: {data.when ?? 'never'}
	</h1>
	<p data-status class="mt-4">{rendered}, clicked: {clicked}</p>
	<button
		type="button"
		onclick={click}
		class="mt-4 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium"
	>
		Click
	</button>

	<Streamed value={data.late} class="mt-6 h-10">
		{#snippet children(value)}
			<p data-late class="self-center text-sm">
				{data.when === 'streamed' ? fail('streamed') : value}
			</p>
		{/snippet}
	</Streamed>

	<p class="mt-6 text-sm text-ink-muted">The page below the fault.</p>
</div>
