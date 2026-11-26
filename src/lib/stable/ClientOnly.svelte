<!--
	Content that can only be rendered in the browser, in a box reserved for it on the server.

	The server and the first client render both produce the placeholder, so hydration changes
	nothing. The content replaces it after hydration, inside the same reserved space.

	Without JavaScript the placeholder is all there will ever be, and unlike streamed data there is
	nothing the server could send in its place. So the placeholder says as much, in a line that
	only a browser without JavaScript shows. It lies over the placeholder and takes no space of
	its own.

	Not for pages with `csr = false`: they ship no JavaScript, so the placeholder would never be
	replaced.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { hydration } from './hydration.svelte.js';
	import Reserve from './Reserve.svelte';

	let {
		class: className,
		children,
		placeholder
	}: {
		/** Sizes the reserved box. Must fix its height: `h-48`, `aspect-video`, and so on. */
		class: ClassValue;
		children: Snippet;
		/** Shown until hydration. Defaults to a skeleton filling the box. */
		placeholder?: Snippet;
	} = $props();
</script>

<Reserve class={className}>
	{#if hydration.done}
		<div class="reserve-content">{@render children()}</div>
	{:else}
		{#if placeholder}
			{@render placeholder()}
		{:else}
			<div class="skeleton"></div>
		{/if}
		<!--
			Positioned, so that it is drawn over the placeholder. A skeleton's pulse puts it on a
			layer of its own, above anything after it that is not positioned: the line was there,
			the right size, and could not be seen.
		-->
		<noscript class="relative grid place-items-center truncate text-xs leading-4 text-ink-muted">
			Needs JavaScript.
		</noscript>
	{/if}
</Reserve>
