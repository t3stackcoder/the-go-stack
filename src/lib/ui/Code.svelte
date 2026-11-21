<!--
	Shows the source of a real file in this repository.

	    import source from './Counter.svelte?highlight';
	    <Code html={source} file="src/lib/demo/Counter.svelte" />

	Only `?highlight` imports should be passed in: they are produced at build time from files in
	this repository (see plugins/highlight.ts), which is what makes rendering them as HTML safe.
-->
<script lang="ts">
	let {
		html,
		file,
		collapsed
	}: {
		/** A `?highlight` import. */
		html: string;
		/** The file's path, shown above the code. */
		file?: string;
		/**
		 * For long files: the label of a control that reveals the code, which starts hidden. It is a
		 * native disclosure element, so it needs no script.
		 */
		collapsed?: string;
	} = $props();
</script>

{#snippet block()}
	<figure class="code overflow-hidden rounded-2xl border border-line bg-surface">
		{#if file}
			<figcaption
				class="flex h-11 items-center border-b border-line bg-sunken px-4 font-mono text-xs text-ink-muted"
			>
				{file}
			</figcaption>
		{/if}
		<div class="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-6">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- built from repository files at build time, never from user input -->
			{@html html}
		</div>
	</figure>
{/snippet}

{#if collapsed}
	<details class="group">
		<summary
			class="cursor-pointer rounded-lg border border-line bg-surface px-4 py-3 text-sm font-medium group-open:mb-4"
		>
			{collapsed}
		</summary>
		{@render block()}
	</details>
{:else}
	{@render block()}
{/if}
