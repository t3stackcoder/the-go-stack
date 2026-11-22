<!--
	A box whose size is decided before its content exists.

	Anything that arrives after first paint (streamed data, browser-only content) must be rendered
	inside one of these, and the box must be sized by its own classes, never by what is inside it:
	a fixed height, an aspect ratio, or a line count. The placeholder and the real content then
	occupy the same space, and swapping one for the other cannot move anything else on the page.

	Use `Streamed` or `ClientOnly` rather than this directly; they are this box plus the swap.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { reservation } from './reservation.js';

	let { class: className, children }: { class: ClassValue; children: Snippet } = $props();
</script>

<div data-reserve class={['reserve', className]} {@attach reservation}> {@render children()} </div>
