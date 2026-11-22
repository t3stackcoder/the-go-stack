<!--
	The one way to put a <textarea> on a page. A test (src/markup.test.ts) forbids a bare one
	anywhere else.

	A field takes what the server sends as its default (`defaultValue`), not as its value, so that
	hydration leaves alone whatever the visitor typed while the page was still loading (see
	src/lib/forms/address-form.ts). For an <input> that is all there is to it. For a <textarea>,
	Svelte 5.59 writes no text into the server's HTML when it is given only a default: the box
	arrives empty. Without JavaScript a refused form came back with its note gone, and an edit form
	showed a blank box until hydration.

	So the server is given the text as a value, which it writes as the element's content, and the
	browser is given only the default. Reading `browser` while rendering is otherwise forbidden on
	this site, because it makes the browser's first render differ from the server's (see
	src/lib/stable/hydration.svelte.ts). It is safe in this one place: an undefined value makes
	hydration leave the element alone, so nothing is redrawn.

	This works around a fault in Svelte and does not fix it. When Svelte renders a textarea's
	default itself, the `value` line can go, and the component and its rule with it.
-->
<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { browser } from '$app/env';

	let {
		defaultValue = '',
		ref = $bindable(null),
		...rest
	}: Omit<HTMLTextareaAttributes, 'value' | 'defaultValue' | 'bind:value'> & {
		/** Where the field starts: what the server holds, or what was typed and refused. */
		defaultValue?: string;
		/** The element, for code that has to focus or measure it. */
		ref?: HTMLTextAreaElement | null;
	} = $props();
</script>

<textarea
	bind:this={ref}
	{...rest}
	value={browser ? undefined : defaultValue}
	{defaultValue}
></textarea>
