<!-- A framed, live demonstration, with a title bar that says what it is. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	let {
		title,
		note,
		class: className,
		children
	}: {
		title: string;
		/** Short context shown at the right of the title bar. */
		note?: string;
		/** Applied to the body, for layout. */
		class?: ClassValue;
		children: Snippet;
	} = $props();
</script>

<figure class="overflow-hidden rounded-2xl border border-line bg-surface">
	<figcaption
		class="flex h-11 items-center justify-between gap-4 border-b border-line bg-sunken px-4 text-sm"
	>
		<span class="flex items-center gap-2 truncate font-medium">
			<span class="size-2 shrink-0 rounded-full bg-brand" aria-hidden="true"></span>
			{title}
		</span>
		{#if note}
			<span class="shrink-0 text-ink-subtle">{note}</span>
		{/if}
	</figcaption>
	<div class={['p-5 sm:p-6', className]}> {@render children()} </div>
</figure>
