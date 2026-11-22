<!--
	When each panel of the streaming dashboard appeared, as bars on one time axis.

	Every bar is a measurement taken in this browser on this visit. The chart sits in a reserved
	box and its bars are absolutely positioned, so arriving data cannot move anything; they grow
	in with `transform` only.
-->
<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import type { TransitionConfig } from 'svelte/transition';
	import ClientOnly from '#lib/stable/ClientOnly.svelte';
	import { getArrivals } from './arrivals.svelte.js';

	let { panels }: { panels: string[] } = $props();

	const arrivals = getArrivals();

	const slowest = $derived(
		Math.max(0, ...Object.values(arrivals.times).map((arrival) => arrival.at))
	);
	// At least two seconds, so that early bars are not stretched across the whole width.
	const scale = $derived(Math.max(2000, Math.ceil(slowest / 500) * 500));
	const percent = (ms: number) => `${(ms / scale) * 100}%`;

	/** Grows a bar out from the axis. */
	const grow: (node: Element) => TransitionConfig = () => ({
		duration: 500,
		easing: cubicOut,
		css: (t) => `transform: scaleX(${t})`
	});
</script>

<!-- Sized for five rows, the axis and the caption, which wraps to more lines when narrow. -->
<ClientOnly class="h-56 sm:h-48">
	{#if arrivals.measurable === false}
		<p class="text-sm text-ink-muted">
			You reached this page by a client-side navigation, which the browser cannot time from its
			start. Run it again to measure a full page load.
		</p>
	{:else}
		<figure>
			<ul
				class="grid grid-cols-[5.75rem_minmax(0,1fr)_4rem] gap-x-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_4.5rem]"
			>
				{#each panels as name (name)}
					{@const arrival = arrivals.times[name]}
					<li class="col-span-3 grid h-7 grid-cols-subgrid items-center text-sm">
						<span class="truncate text-ink-muted">
							{name}
							{#if arrival?.failed}
								<span class="ml-0.5 text-bad">failed</span>
							{/if}
						</span>
						<span class="relative h-full" aria-hidden="true">
							<span class="absolute inset-x-0 top-1/2 h-px bg-line"></span>
							{#if slowest}
								<span
									class="absolute inset-y-0 border-l border-dashed border-line-strong"
									style:left={percent(slowest)}
								></span>
							{/if}
							{#if arrival}
								<span
									in:grow
									class={[
										'absolute top-1/2 left-0 h-2 origin-left -translate-y-1/2 rounded-r-[4px]',
										arrival.failed ? 'bg-bad' : 'bg-brand'
									]}
									style:width={percent(arrival.at)}
								></span>
							{/if}
						</span>
						<span class="text-right font-medium whitespace-nowrap tabular-nums">
							{arrival ? `${arrival.at.toFixed(0)} ms` : ''}
						</span>
					</li>
				{/each}
				<li
					class="col-span-3 grid grid-cols-subgrid pt-1 text-xs text-ink-subtle tabular-nums"
					aria-hidden="true"
				>
					<span></span>
					<span class="flex justify-between"><span>0</span><span>{scale} ms</span></span>
				</li>
			</ul>
			<figcaption class="mt-2 text-xs text-pretty text-ink-subtle">
				The dashed line marks the slowest panel. Had load awaited every promise, the whole page
				would have waited for it.
			</figcaption>
		</figure>
	{/if}
</ClientOnly>
