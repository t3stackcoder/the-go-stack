<!--
	When a streaming-demo panel appeared, measured in the browser. Records the time when it mounts,
	which is the moment the panel's content was placed on the page, and shows it.

	Only for inside a reserved box: it renders nothing on the server.
-->
<script lang="ts">
	import { firstPaint, getArrivals } from './arrivals.svelte.js';

	let {
		name,
		failed = false,
		paint = false
	}: {
		name: string;
		failed?: boolean;
		/** The panel was in the first response, so it appeared at the first paint. */
		paint?: boolean;
	} = $props();

	const arrivals = getArrivals();
	const arrival = $derived(arrivals.times[name]);

	function record() {
		const at = paint ? firstPaint() : performance.now();
		if (at !== undefined) arrivals.record(name, failed, at);
	}
</script>

<p class="h-4 truncate text-xs text-ink-subtle tabular-nums" {@attach record}>
	{#if arrivals.measurable === false}
		Not timed (see below)
	{:else if arrival}
		{failed ? 'Failed' : 'Shown'} at {arrival.at.toFixed(0)} ms
	{/if}
</p>
