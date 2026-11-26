<!--
	The controls and readouts around the heatmap. Every number shown is measured here, in the
	visitor's browser, by `measure` (for the DOM writes and update time) and by the browser's own
	frame timestamps (for the frame rate).
-->
<script lang="ts">
	import { distinct } from './distinct.js';
	import Heatmap from './Heatmap.svelte';
	import { measure, type UpdateCost } from './measure.js';

	const RATES = [1, 10, 100, 1000];
	/** Readouts are averaged over this long while running, so they can be read rather than flicker. */
	const WINDOW_MS = 500;

	// The component's exports, written out so that tools outside the Svelte compiler can type them.
	let heatmap: { size: number; warm(indices: number[]): void; reset(): void };
	let perFrame = $state(100);
	let running = $state(false);
	let last = $state<UpdateCost & { averaged: boolean }>();
	let fps = $state<number>();
	let announcement = $state('');

	const count = (value: number) => value.toLocaleString('en-GB');
	// performance.now() is coarsened in most browsers, so times below 0.1 ms are not claimed.
	const milliseconds = (ms: number) => (ms < 0.1 ? '<0.1' : ms.toFixed(1));

	function once(update: () => void) {
		const cost = measure(update);
		last = { ...cost, averaged: false };
		fps = undefined;
		announcement = `${count(cost.nodes)} DOM nodes written in ${milliseconds(cost.ms)} ms.`;
	}

	function toggle() {
		running = !running;
		if (running) {
			announcement = 'Running.';
		} else if (last) {
			announcement = `Stopped. ${count(last.nodes)} DOM nodes written per frame, ${milliseconds(last.ms)} ms per update.`;
		}
	}

	// The one effect in this chapter's demos. It talks to something outside Svelte, the browser's
	// frame clock: it starts a loop when `running` becomes true, and its cleanup stops it again.
	$effect(() => {
		if (!running) return;

		let frames = 0;
		let total = 0;
		let windowStart = performance.now();

		let id = requestAnimationFrame(function frame(now) {
			// Cells are picked before the timer starts, so only the update itself is measured.
			const indices = distinct(perFrame, heatmap.size);
			const cost = measure(() => heatmap.warm(indices));
			frames += 1;
			total += cost.ms;

			if (now - windowStart >= WINDOW_MS) {
				last = { nodes: cost.nodes, ms: total / frames, averaged: true };
				fps = (frames * 1000) / (now - windowStart);
				frames = 0;
				total = 0;
				windowStart = now;
			}
			id = requestAnimationFrame(frame);
		});

		return () => cancelAnimationFrame(id);
	});
</script>

{#snippet readout(label: string, value: string | undefined, unit: string, detail: string)}
	<div class="min-w-0 border-l border-line pl-3 first:border-l-0 first:pl-0 sm:pl-4">
		<dt class="line-clamp-2 h-8 text-xs leading-4 text-ink-muted sm:h-4">{label}</dt>
		<dd class="mt-1 truncate font-display text-xl font-semibold tabular-nums sm:text-3xl">
			{value ?? '–'}<span class="ml-0.5 text-sm font-medium text-ink-muted sm:ml-1">
				{value ? unit : ''}
			</span>
		</dd>
		<dd class="mt-0.5 line-clamp-2 h-8 text-xs leading-4 text-ink-subtle sm:h-4">{detail}</dd>
	</div>
{/snippet}

<div class="flex flex-wrap items-end gap-x-6 gap-y-4">
	<fieldset>
		<legend class="text-sm font-medium">Cells changed per frame</legend>
		<div class="mt-2 grid grid-cols-4 gap-1 rounded-lg border border-line bg-sunken p-1">
			{#each RATES as rate (rate)}
				<label
					class="relative cursor-pointer rounded-md px-3 py-1.5 text-center text-sm text-ink-muted tabular-nums has-checked:bg-surface has-checked:font-semibold has-checked:text-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-brand"
				>
					<input type="radio" name="per-frame" value={rate} bind:group={perFrame} class="sr-only" />
					{count(rate)}
				</label>
			{/each}
		</div>
	</fieldset>

	<div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
		<button
			type="button"
			aria-pressed={running}
			onclick={toggle}
			class="col-span-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink sm:w-24"
		>
			{running ? 'Stop' : 'Start'}
		</button>
		<button
			type="button"
			disabled={running}
			onclick={() => {
				const indices = distinct(1, heatmap.size);
				once(() => heatmap.warm(indices));
			}}
			class="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium whitespace-nowrap disabled:opacity-50 sm:px-4"
		>
			Change one cell
		</button>
		<button
			type="button"
			disabled={running}
			onclick={() => once(() => heatmap.reset())}
			class="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium whitespace-nowrap disabled:opacity-50 sm:px-4"
		>
			Cool all
		</button>
	</div>
</div>

<div class="mt-6">
	<Heatmap bind:this={heatmap} />
</div>

<dl class="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-5 sm:gap-4">
	{@render readout(
		'DOM nodes written',
		last && count(last.nodes),
		'',
		last?.averaged ? 'in the last frame' : 'by the last update'
	)}
	{@render readout(
		'Update time',
		last && milliseconds(last.ms),
		'ms',
		last?.averaged ? 'per frame, averaged' : 'assignment to DOM'
	)}
	{@render readout('Frame rate', fps?.toFixed(0), 'fps', 'while running')}
</dl>

<p class="sr-only" aria-live="polite">{announcement}</p>
