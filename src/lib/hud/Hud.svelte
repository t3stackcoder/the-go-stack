<!--
	The readout pinned to the bottom of every page: what this page cost, measured live. It is shown
	to someone signed in who has switched it on, on their preferences page
	(src/routes/account/preferences), in development and in production alike.

	Whether it shows is decided the way the header's admin button is, and for the same reason: most
	pages are built once for everybody, so no script here can decide it without the readout
	flashing in after hydration. It is in every page's HTML, hidden, and CSS shows it by
	`data-readout` on <html>, which the boot script in app.html sets before the first frame from
	the marker cookie (src/lib/auth/marker.ts). It measures from hydration whether it is shown or
	not, so that switched on part way through a visit it has the whole visit's figures to show.

	Everything but the values is in the server's HTML: the frame, the cells and their labels, and a
	small loader where each value will be. The values are revealed together, a moment after
	measuring begins, by fading them in over the loaders. Both are in the page from the start,
	stacked in the same place, so the reveal inserts nothing and moves nothing: the readout must not
	cause the layout shift it reports. The pause is deliberate. The figures settle over the first
	few frames (the downloads are reported a little after hydration), and shown at once they
	flickered through partial values.

	On a page that ships no JavaScript nothing is revealed, so the loaders pulse a few times and
	then stand still, as placeholders, instead of promising values that will never come.

	For the same reason as above the cells never come and go. One the browser cannot measure reads
	"n/a" rather than leaving the grid, and is never shown as zero. The cells are columns of a fixed
	grid, with left-aligned text, so values that change constantly cannot nudge their neighbours.

	Five cells do not fit across a phone, so the grid has six columns there: three cells take two
	each on the first row, and the other two share the second. From the `sm` breakpoint up, all five
	sit in one row.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Reserve from '#lib/stable/Reserve.svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { kilobytes, PageMetrics, responseTime, shiftScore } from './metrics.svelte.js';

	type Tone = 'plain' | 'good' | 'bad';

	/** How long after measuring begins the values are revealed. */
	const REVEAL_AFTER_MS = 300;
	/** Not known (yet): shown only if a value is still missing when revealed. */
	const PENDING = '–';
	/** This browser cannot measure it. */
	const UNMEASURED = 'n/a';

	// Measuring starts when this mounts, which is when hydration finishes. Until then the server's
	// HTML is what shows, and the first client render must produce exactly that.
	const metrics = new PageMetrics();
	let revealed = $state(false);

	onMount(() => {
		metrics.start(performance.now());
		const reveal = setTimeout(() => (revealed = true), REVEAL_AFTER_MS);
		return () => clearTimeout(reveal);
	});

	// Worked out here rather than in branches of the markup, so that each cell stays the same
	// element from first paint on, and the reveal is a fade of what is already there.
	let shift = $derived.by((): [string, Tone] => {
		if (metrics.layoutShift === undefined) return [UNMEASURED, 'plain'];
		return [shiftScore(metrics.layoutShift), metrics.layoutShift === 0 ? 'good' : 'bad'];
	});

	let response = $derived.by((): [string, Tone] => {
		if (metrics.slowestResponse === undefined) return [UNMEASURED, 'plain'];
		// Before the first click, tap or key press there is nothing to report yet.
		if (metrics.slowestResponse === null) return [PENDING, 'plain'];
		// 200 ms is the line the Interaction to Next Paint metric draws for a good response.
		const ms = metrics.slowestResponse;
		return [responseTime(ms), ms <= 200 ? 'good' : 'bad'];
	});

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

{#snippet cell(label: string, value: string, tone: Tone = 'plain')}
	<!-- The first three cells fill the first row on a phone; the fourth starts the second. -->
	<div
		class="col-span-3 border-l border-line pl-3 first:border-l-0 first:pl-0 nth-[-n+3]:col-span-2 max-sm:nth-4:border-l-0 max-sm:nth-4:pl-0 sm:col-span-1 sm:nth-[-n+3]:col-span-1"
	>
		<dt class="truncate text-[0.625rem] leading-4 tracking-wide text-ink-subtle uppercase">
			{label}
		</dt>
		<!-- The value and its loader share one grid cell, so either can show without moving anything. -->
		<dd class="grid text-xs leading-4 font-medium tabular-nums">
			<span
				class={[
					'value col-start-1 row-start-1 truncate',
					tone === 'good' && 'text-good',
					tone === 'bad' && 'text-bad',
					revealed && 'shown'
				]}
			>
				<!-- Until then the text is a dash too, so nothing unmeasured is read out either. -->
				{revealed ? value : PENDING}
			</span>
			<!-- The wrapper fades; the bar inside pulses. On one element the pulse would override the fade. -->
			<span
				aria-hidden="true"
				class={['loader col-start-1 row-start-1 flex items-center', revealed && 'gone']}
			>
				<span class="pulse h-2 w-10 rounded-full bg-line-strong"></span>
			</span>
		</dd>
	</div>
{/snippet}

<!--
	`grid` when shown: a reserved box is a grid (layout.css), and `hidden` takes that away. Never
	on paper: the rule that shows it outranks a plain `print:hidden`, so it is kept to the screen.
-->
<Reserve
	class="pointer-events-none fixed inset-x-0 bottom-4 z-20 mx-auto hidden h-22 w-[calc(100vw-1.5rem)] sm:h-12 sm:w-120 lg:right-6 lg:left-auto lg:mx-0 [:root[data-readout]_&]:not-print:grid"
>
	<aside
		aria-label="Live measurements of this page"
		class="pointer-events-auto flex items-center rounded-2xl border border-line bg-surface/90 px-4 shadow-lg backdrop-blur"
	>
		<dl aria-busy={!revealed} class="grid w-full grid-cols-6 gap-y-2 sm:grid-cols-5">
			{@render cell(
				'JS sent',
				metrics.scriptBytes > 0 ? `${kilobytes(metrics.scriptBytes)} KB` : PENDING
			)}

			{#if navigation}
				{@render cell('Navigated', `${navigation.ms.toFixed(0)} ms`)}
				{@render cell(
					'Fetched',
					`+${kilobytes(metrics.scriptBytes - navigation.scriptBytesBefore)} KB`
				)}
			{:else}
				{@render cell(
					'Hydrated',
					metrics.hydratedAt === undefined ? PENDING : `${metrics.hydratedAt.toFixed(0)} ms`
				)}
				{@render cell(
					'Server',
					metrics.serverMs === undefined ? 'prerendered' : `${metrics.serverMs.toFixed(1)} ms`
				)}
			{/if}

			{@render cell('Shift', shift[0], shift[1])}
			{@render cell('Response', response[0], response[1])}
		</dl>
	</aside>
</Reserve>

<style>
	/* Hidden until revealed, and then faded in over the loader as it fades out. */
	.value {
		opacity: 0;
		transition: opacity 250ms ease-out;
	}

	.value.shown {
		opacity: 1;
	}

	/*
	 * A few pulses and then still: where nothing is ever revealed (a page without JavaScript), a
	 * loader that pulsed for ever would promise values that never come.
	 */
	.pulse {
		animation: skeleton-pulse 1.6s ease-in-out 4;
	}

	.loader {
		transition: opacity 250ms ease-out;
	}

	.loader.gone {
		opacity: 0;
	}
</style>
