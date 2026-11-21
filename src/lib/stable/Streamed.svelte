<!--
	Data that arrives after the page does, in a box reserved for it.

	Pass a promise returned un-awaited from a server `load`. The page is sent immediately with the
	placeholder in place, and the value is streamed into the same response when it resolves. A
	failure is rendered in the same box, so a rejected promise cannot shift the page either.

	Not for pages with `csr = false`: without JavaScript a streamed value has nothing to render it.
-->
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Reserve from './Reserve.svelte';

	let {
		promise,
		class: className,
		children,
		placeholder,
		failed
	}: {
		promise: Promise<T>;
		/** Sizes the reserved box. Must fix its height: `h-48`, `aspect-video`, and so on. */
		class: ClassValue;
		children: Snippet<[T]>;
		/** Shown while pending. Defaults to a skeleton filling the box. */
		placeholder?: Snippet;
		/** Shown on rejection. Defaults to a plain notice. */
		failed?: Snippet<[unknown]>;
	} = $props();
</script>

<Reserve class={className}>
	{#await promise}
		{#if placeholder}
			{@render placeholder()}
		{:else}
			<div class="skeleton"></div>
		{/if}
	{:then value}
		<div class="reserve-content">{@render children(value)}</div>
	{:catch error}
		{#if failed}
			{@render failed(error)}
		{:else}
			<p role="alert" class="grid place-items-center text-sm text-ink-muted">
				This section could not be loaded.
			</p>
		{/if}
	{/await}
</Reserve>
