<!--
	2,400 cells, each with its own reactive value. Changing one
	re-runs only the expression that reads it, which writes one
	CSS variable on one element. Nothing else is re-rendered or
	compared.
-->
<script lang="ts">
	export const size = 2400;

	// Deeply reactive: each cell's `heat` is tracked on its own.
	const cells = $state(Array.from({ length: size }, () => ({ heat: 0 })));

	/** Gives each listed cell a new heat between 0.2 and 1. */
	export function warm(indices: number[]) {
		// The whole update is an assignment. No setter, no copy.
		for (const index of indices) cells[index].heat = 0.2 + 0.8 * Math.random();
	}

	/** Cools every cell. A cell already at 0 does not change, so
	 * nothing is written for it. */
	export function reset() {
		for (const cell of cells) cell.heat = 0;
	}
</script>

<div class="heatmap" role="img" aria-label="A grid of 2,400 cells">
	{#each cells as cell, index (index)}
		<div style:--heat={cell.heat}></div>
	{/each}
</div>

<style>
	.heatmap {
		display: grid;
		grid-template-columns: repeat(40, minmax(0, 1fr));
		gap: 1px;
	}

	@media (width >= 48rem) {
		.heatmap {
			grid-template-columns: repeat(80, minmax(0, 1fr));
			gap: 2px;
		}
	}

	/* CSS turns the one number Svelte writes into a colour. */
	.heatmap > div {
		aspect-ratio: 1;
		border-radius: 2px;
		background: color-mix(
			in oklab,
			var(--color-accent) calc(var(--heat) * 100%),
			var(--color-line)
		);
	}
</style>
