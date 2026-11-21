<script lang="ts">
	import type { Product } from './catalog.js';

	let { products }: { products: Product[] } = $props();

	const swatch = (hue: number) =>
		`linear-gradient(135deg in oklch, oklch(0.78 0.13 ${hue}), oklch(0.6 0.17 ${hue + 50}))`;
</script>

<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
	{#each products as product (product.id)}
		<li class="overflow-hidden rounded-xl border border-line bg-surface">
			<div class="aspect-[4/3]" style:background={swatch(product.hue)}></div>
			<div class="p-3">
				<p class="truncate text-sm font-medium">{product.name}</p>
				<p class="mt-0.5 flex justify-between text-sm text-ink-muted">
					<span>{product.category}</span>
					<span class="tabular-nums">${product.price}</span>
				</p>
			</div>
		</li>
	{/each}
</ul>
