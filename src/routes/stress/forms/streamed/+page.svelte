<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Streamed from '#lib/stable/Streamed.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Stress: a form beside a streamed value</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">A form beside a streamed value</h1>

	<form
		method="POST"
		action="?/add{data.elsewhere ? '&elsewhere' : ''}"
		use:enhance
		class="mt-6 flex items-center gap-4 text-sm"
	>
		<button class="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">Add one</button>
		<p class="tabular-nums">Count: <span data-count>{data.count}</span></p>
	</form>

	<section class="mt-6 rounded-lg border border-line p-4">
		<h2 class="text-sm font-medium">Streamed, and nothing to do with the form</h2>
		<Streamed promise={data.slow} class="mt-2 h-10">
			{#snippet children(value)}
				<p data-settled class="self-center text-sm">{value}</p>
			{/snippet}
		</Streamed>
	</section>

	<p class="mt-4 text-sm">
		<a
			data-elsewhere
			href="{resolve('/stress/forms/streamed')}{data.elsewhere ? '' : '?elsewhere'}"
			class="text-accent-text underline underline-offset-2"
		>
			The same page at another address
		</a>
	</p>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
