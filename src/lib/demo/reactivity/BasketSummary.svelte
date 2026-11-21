<!--
	A separate component. Its only link to the shelf is the same
	import: both read and change one basket, so they cannot
	disagree.
-->
<script lang="ts">
	import { basket } from './basket.svelte.js';
</script>

<p class="font-display text-2xl font-semibold tabular-nums" aria-live="polite">
	{basket.count}
	{basket.count === 1 ? 'item' : 'items'} · ${basket.total}
</p>

<!-- Tall enough for every product: adding never moves the page. -->
<ul class="mt-4 h-44 space-y-1">
	{#each basket.lines as line (line.product.id)}
		<li class="flex h-10 items-center gap-3 text-sm">
			<span class="w-8 text-ink-muted tabular-nums">{line.quantity} ×</span>
			<span class="min-w-0 flex-1 truncate">{line.product.name}</span>
			<button
				type="button"
				onclick={() => basket.remove(line.product)}
				aria-label="Remove one {line.product.name}"
				class="size-8 rounded-lg border border-line bg-surface hover:border-line-strong"
			>
				−
			</button>
		</li>
	{:else}
		<li class="flex h-10 items-center text-sm text-ink-subtle">
			Empty. Add something from the shelf.
		</li>
	{/each}
</ul>

<button
	type="button"
	onclick={() => basket.clear()}
	disabled={basket.count === 0}
	class="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium disabled:opacity-50"
>
	Empty the basket
</button>
