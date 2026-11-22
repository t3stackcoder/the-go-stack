<!--
	Data that arrives after the page does, in a box reserved for it.

	Pass a promise returned un-awaited from a server `load`. The page is sent immediately with the
	placeholder in place, and the value is streamed into the same response when it resolves.

	Every way it can go wrong ends in the same box, so none of them can shift the page: the promise
	rejects, or its value arrives and cannot be rendered. The second is caught here and not left to
	the page, because it happens after the page has rendered, where nothing else would catch it.
	Uncaught, it left the placeholder pulsing for good. Either way the error has been through the
	error hooks by the time it gets here, so what is shown is the safe message, and the error
	itself is on record.

	One thing is not handled, because only the caller can: a promise that never settles. The
	placeholder stays and the response stays open, for as long as the visitor does. Put a time limit
	on a slow dependency where it is called (`AbortSignal.timeout`, for a fetch).

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
		/** Shown on failure, with what the error hooks made of it. Defaults to a plain notice. */
		failed?: Snippet<[unknown]>;
	} = $props();
</script>

{#snippet failure(error: unknown)}
	{#if failed}
		{@render failed(error)}
	{:else}
		<p role="alert" class="grid place-items-center text-sm text-ink-muted">
			This section could not be loaded.
		</p>
	{/if}
{/snippet}

<Reserve class={className}>
	{#await promise}
		{#if placeholder}
			{@render placeholder()}
		{:else}
			<div class="skeleton"></div>
		{/if}
	{:then value}
		<svelte:boundary failed={failure}>
			<div class="reserve-content">{@render children(value)}</div>
		</svelte:boundary>
	{:catch error}
		{@render failure(error)}
	{/await}
</Reserve>
