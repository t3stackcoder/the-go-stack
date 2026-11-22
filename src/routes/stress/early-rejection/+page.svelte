<script lang="ts">
	import Streamed from '#lib/stable/Streamed.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Stress: a rejection nobody was listening for</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A rejection nobody was listening for
	</h1>
	<Streamed value={data.late} class="mt-6 h-10">
		<p class="self-center text-sm">It arrived.</p>
	</Streamed>
	<p class="mt-6 text-sm text-ink-muted">If you can read this, the server survived.</p>
</div>
