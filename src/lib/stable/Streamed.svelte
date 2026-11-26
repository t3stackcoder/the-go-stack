<!--
	Data that arrives after the page does, in a box reserved for it.

	Pass what a server `load` got back from `streaming` (src/lib/server/streaming.ts). For most
	visitors that is a promise: the page is sent immediately with the placeholder in place, and the
	value is streamed into the same response when it settles. For a visitor without JavaScript it
	is what the promise settled as, because the server waited, and the value or the failure notice
	is in the HTML.

	Every way it can go wrong ends in the same box, so none of them can shift the page: the data
	fails, it takes longer than the time limit `streaming` was given, or its value arrives and
	cannot be rendered. The last is caught here and not left to the page, because it happens after
	the page has rendered, where nothing else would catch it. Uncaught, it left the placeholder
	pulsing for good. Either way the error has been recorded by the time it gets here, so what is
	shown is the safe message.

	When the page's data is loaded again where the visitor stands, as it is after every form
	submission, the box is given a new promise for what it is already showing. The value on show
	stays until the new one has settled, and is then replaced where it sits. Measured before this
	was so: a form posted beside a value that takes 800 ms blanked it for 800 ms each time, though
	nothing about it had changed. At a different address the promise is for something else, and its
	placeholder is shown at once.

	A bare promise from a `load` that did not go through `streaming` is shown too, but has neither
	the time limit nor the page without JavaScript: one that never settles leaves the placeholder
	up and the response open for as long as the visitor stays.
-->
<script lang="ts" generics="T">
	import { type Snippet, untrack } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { page } from '$app/state';
	import type { Late } from './late.js';
	import Reserve from './Reserve.svelte';

	let {
		value,
		class: className,
		children,
		placeholder,
		failed
	}: {
		value: Late<T>;
		/** Sizes the reserved box. Must fix its height: `h-48`, `aspect-video`, and so on. */
		class: ClassValue;
		children: Snippet<[T]>;
		/** Shown while pending. Defaults to a skeleton filling the box. */
		placeholder?: Snippet;
		/** Shown on failure, with what the error hooks made of it. Defaults to a plain notice. */
		failed?: Snippet<[unknown]>;
	} = $props();

	// What is on show. What the page gives takes its place at once, unless it is a promise for a
	// fresh copy of the value already on show, which waits out of sight until it has settled.
	let shown = $state.raw(untrack(() => value));
	// The address at which the value on show arrived, once one has. Bookkeeping, so not reactive.
	let arrivedAt: string | undefined;

	// Without the fragment, which a load function never sees: following a link to a heading on the
	// page does not make its data a different thing.
	const address = () => page.url.pathname + page.url.search;

	$effect(() => {
		const next = value;

		untrack(() => {
			// Already settled, on the server: there is nothing to wait for.
			if (!(next instanceof Promise)) {
				shown = next;
				arrivedAt = next.late === 'arrived' ? address() : undefined;
				return;
			}

			if (arrivedAt !== address()) shown = next;

			const settle = (arrived: boolean) => {
				// The page has given something newer since, and this one no longer matters.
				if (next !== value) return;
				shown = next;
				arrivedAt = arrived ? address() : undefined;
			};
			next.then(
				() => settle(true),
				() => settle(false)
			);
		});
	});
</script>

{#snippet arrival(arrived: T)}
	<svelte:boundary failed={failure}>
		<div class="reserve-content">{@render children(arrived)}</div>
	</svelte:boundary>
{/snippet}

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
	{#if !(shown instanceof Promise)}
		{#if shown.late === 'arrived'}
			{@render arrival(shown.value)}
		{:else}
			{@render failure(shown.error)}
		{/if}
	{:else}
		{#await shown}
			{#if placeholder}
				{@render placeholder()}
			{:else}
				<div class="skeleton"></div>
			{/if}
		{:then arrived}
			{@render arrival(arrived)}
		{:catch error}
			{@render failure(error)}
		{/await}
	{/if}
</Reserve>
