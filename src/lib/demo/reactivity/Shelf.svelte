<!--
	Lists products and adds them to the basket. No basket is
	passed in and there is no provider above it: it imports the
	module, and that import is the whole connection.
-->
<script lang="ts">
	import { createCatalog } from '#lib/demo/catalog.js';
	import { basket } from './basket.svelte.js';

	const products = createCatalog(4);
</script>

<ul class="divide-y divide-line">
	{#each products as product (product.id)}
		<li class="flex items-center gap-3 py-3">
			<span
				class="size-9 shrink-0 rounded-lg"
				style:background="oklch(0.72 0.14 {product.hue})"
				aria-hidden="true"
			></span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm font-medium">{product.name}</span>
				<span class="block truncate text-xs text-ink-muted tabular-nums">
					${product.price} · {basket.quantityOf(product)} in basket
				</span>
			</span>
			<button
				type="button"
				onclick={() => basket.add(product)}
				aria-label="Add {product.name} to the basket"
				class="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-line-strong"
			>
				Add
			</button>
		</li>
	{/each}
</ul>
