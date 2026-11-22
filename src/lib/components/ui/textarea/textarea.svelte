<!--
	Changed from shadcn-svelte's: it renders the site's own Textarea and takes `defaultValue` in
	place of `bind:value`. A bare <textarea> loses what a visitor typed (see
	src/lib/forms/Textarea.svelte), and src/markup.test.ts fails on one. Keep this if the CLI
	overwrites the file.
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import BaseTextarea from '#lib/forms/Textarea.svelte';
	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		'data-slot': dataSlot = 'textarea',
		...restProps
	}: ComponentProps<typeof BaseTextarea> & { 'data-slot'?: string } = $props();
</script>

<BaseTextarea
	bind:ref
	data-slot={dataSlot}
	class={cn(
		'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border bg-transparent px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 md:text-sm flex field-sizing-content min-h-16 w-full outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...restProps}
/>
