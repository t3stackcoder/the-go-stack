<!--
	The readout pinned to the bottom of every page: what this page cost, measured live.

	Before hydration it says so, which is also the permanent and truthful state on pages that ship
	no JavaScript. Its contents change after first paint, so it sits in a reserved box like any
	other late content.

	The cells are columns of a fixed grid, with left-aligned text. Their values change constantly,
	and a layout driven by content width would nudge neighbouring cells sideways on every update:
	the readout would cause the very layout shift it reports.

	Five cells do not fit across a phone, so the grid has six columns there: three cells take two
	each on the first row, and the rest share the second. From the `sm` breakpoint up, all five sit
	in one row. A cell is left out where the browser cannot measure what it reports.
-->
<script lang="ts">
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { hydration } from '#lib/stable/hydration.svelte.js';
	import Reserve from '#lib/stable/Reserve.svelte';
	import { kilobytes, metrics, responseTime, shiftScore } from './metrics.svelte.js';

	// The most recent client-side navigation: how long it took and how much JavaScript the app
	// had downloaded before it, so the cost of the navigation itself can be shown.
	let navigation = $state<{ ms: number; scriptBytesBefore: number }>();
	let started: { at: number; scriptBytes: number } | undefined;

	beforeNavigate(() => {
		started = { at: performance.now(), scriptBytes: metrics.scriptBytes };
	});

	afterNavigate(({ type }) => {
		// 'enter' is the initial page load, which the other cells already describe.
		if (type === 'enter' || !started) return;
		navigation = { ms: performance.now() - started.at, scriptBytesBefore: started.scriptBytes };
	});
</script>

{#snippet cell(label: string, value: string, tone: 'plain' | 'good' | 'bad' = 'plain')}
	<!-- The first three cells fill the first row on a phone; the fourth starts the second. -->
	<div
		class="col-span-3 border-l border-line pl-3 first:border-l-0 first:pl-0 nth-[-n+3]:col-span-2 max-sm:nth-4:border-l-0 max-sm:nth-4:pl-0 sm:col-span-1 sm:nth-[-n+3]:col-span-1"
	>
		<dt class="truncate text-[0.625rem] leading-4 tracking-wide text-ink-subtle uppercase">
			{label}
		</dt>
		<dd
			class={[
				'truncate text-xs leading-4 font-medium tabular-nums',
				tone === 'good' && 'text-good',
				tone === 'bad' && 'text-bad'
			]}
		>
			{value}
		</dd>
	</div>
{/snippet}

<Reserve
	class="pointer-events-none fixed inset-x-0 bottom-4 z-20 mx-auto h-22 w-[calc(100vw-1.5rem)] sm:h-12 sm:w-120 lg:right-6 lg:left-auto lg:mx-0 print:hidden"
>
	<aside
		aria-label="Live measurements of this page"
		class="pointer-events-auto flex items-center rounded-2xl border border-line bg-surface/90 px-4 shadow-lg backdrop-blur"
	>
		{#if hydration.done}
			<dl class="grid w-full grid-cols-6 gap-y-2 sm:grid-cols-5">
				{@render cell('JS sent', `${kilobytes(metrics.scriptBytes)} KB`)}

				{#if navigation}
					{@render cell('Navigated', `${navigation.ms.toFixed(0)} ms`)}
					{@render cell(
						'Fetched',
						`+${kilobytes(metrics.scriptBytes - navigation.scriptBytesBefore)} KB`
					)}
				{:else}
					{@render cell('Hydrated', `${metrics.hydratedAt?.toFixed(0)} ms`)}
					{@render cell(
						'Server',
						metrics.serverMs === undefined ? 'prerendered' : `${metrics.serverMs.toFixed(1)} ms`
					)}
				{/if}

				{#if metrics.layoutShift !== undefined}
					{@render cell(
						'Shift',
						shiftScore(metrics.layoutShift),
						metrics.layoutShift === 0 ? 'good' : 'bad'
					)}
				{/if}

				{#if metrics.slowestResponse === null}
					{@render cell('Response', '–')}
				{:else if metrics.slowestResponse !== undefined}
					<!-- 200 ms is the line the Interaction to Next Paint metric draws for a good response. -->
					{@render cell(
						'Response',
						responseTime(metrics.slowestResponse),
						metrics.slowestResponse <= 200 ? 'good' : 'bad'
					)}
				{/if}
			</dl>
		{:else}
			<p class="flex w-full items-center justify-center gap-2 text-xs text-ink-muted">
				<span class="size-1.5 rounded-full bg-ink-subtle" aria-hidden="true"></span>
				Server-rendered HTML. No JavaScript is running.
			</p>
		{/if}
	</aside>
</Reserve>
