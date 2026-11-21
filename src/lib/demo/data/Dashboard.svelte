<!--
	The streaming dashboard: its panels, a chart of when each one appeared, and a way to run the
	whole request again.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Arrivals, setArrivals } from './arrivals.svelte.js';
	import Waterfall from './Waterfall.svelte';

	let {
		panels,
		children
	}: {
		/** The panel names, in order, for the chart. */
		panels: string[];
		/** The panels themselves. */
		children: Snippet;
	} = $props();

	const arrivals = setArrivals(new Arrivals());

	// 'enter' is the initial, full page load: the only kind whose start the browser can time.
	afterNavigate(({ type }) => {
		arrivals.measurable = type === 'enter';
	});
</script>

<div
	class="grid grid-cols-2 gap-3 lg:grid-cols-5 [&>:first-child]:col-span-2 lg:[&>:first-child]:col-span-1"
>
	{@render children()}
</div>

<div class="mt-6 grid gap-6 border-t border-line pt-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
	<Waterfall {panels} />

	<div class="flex flex-col items-start gap-3 text-sm text-ink-muted">
		<p>
			Times are measured in your browser, from the moment it requested the page until each panel
			appeared. Run it again for a fresh request.
		</p>
		<!-- A full page load, so the whole response is streamed again and timed from its start. -->
		<a
			href={resolve('/data/streaming')}
			data-sveltekit-reload
			class="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:border-line-strong"
		>
			Run it again
		</a>
	</div>
</div>
