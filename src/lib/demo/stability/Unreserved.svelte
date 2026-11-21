<!--
	Late content with no space held for it.
	Until it arrives this renders nothing, so when it does arrive, everything below is pushed down.
-->
<script lang="ts">
	let { arrival }: { arrival: Promise<string> } = $props();
</script>

{#await arrival then message}
	<p class="h-20 rounded-lg bg-accent-soft p-3 text-sm">{message}</p>
{/await}
