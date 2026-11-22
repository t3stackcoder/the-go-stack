<!--
	The same late content, in a box whose height was decided before the content existed.
	The placeholder and the message occupy the same space, so nothing below can move.
-->
<script lang="ts">
	import Streamed from '#lib/stable/Streamed.svelte';

	let { arrival }: { arrival: Promise<string> } = $props();
</script>

<Streamed value={arrival} class="h-20">
	{#snippet children(message: string)}
		<p class="rounded-lg bg-accent-soft p-3 text-sm">{message}</p>
	{/snippet}
</Streamed>
