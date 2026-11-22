<script lang="ts">
	import DemoFrame from '#lib/demo/data/DemoFrame.svelte';
	import { addressForm } from '#lib/forms/address-form.js';
	import formSource from '#lib/forms/address-form.ts?highlight';
	import type { PageProps } from './$types';
	import pageSource from './+page.svelte?highlight';
	import serverSource from './+page.server.ts?highlight';

	let { data }: PageProps = $props();

	// The box takes the query as its default, not its value, so what a visitor types while the
	// page is still loading survives hydration. `addressForm` then sends it, and shows the
	// address's query again after a link or Back.
	let form: HTMLFormElement;
	addressForm(
		() => form,
		(fields) => fields.get('q') === data.query
	);
</script>

<DemoFrame
	path="/data/search"
	files={[
		{ html: serverSource, file: 'src/routes/data/search/+page.server.ts' },
		{ html: pageSource, file: 'src/routes/data/search/+page.svelte' },
		{ html: formSource, file: 'src/lib/forms/address-form.ts' }
	]}
>
	<!--
		A plain GET form: without JavaScript, the browser loads `?q=…` itself. With it, SvelteKit
		makes the same request as a client-side navigation. `reset={false}` keeps focus and scroll
		where they are, and `replacestate` stops every keystroke adding a history entry.
	-->
	<form
		bind:this={form}
		method="GET"
		role="search"
		data-sveltekit-reset={false}
		data-sveltekit-replacestate
	>
		<label for="q" class="text-sm font-medium">Search by code, phrase or kind</label>
		<div class="mt-2 flex gap-2">
			<input
				id="q"
				name="q"
				type="search"
				defaultValue={data.query}
				placeholder="Try 404 or “not”"
				autocomplete="off"
				spellcheck="false"
				oninput={(event) => event.currentTarget.form?.requestSubmit()}
				class="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2"
			/>
			<button class="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
				Search
			</button>
		</div>
	</form>

	<p class="mt-4 h-5 text-sm text-ink-muted tabular-nums" aria-live="polite">
		{data.results.length} of {data.total} status codes
	</p>

	<!-- A fixed height, scrolled inside: the results can change, the space they take cannot. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrolling box needs focus to scroll by keyboard) -->
	<div
		role="region"
		aria-label="Results"
		tabindex="0"
		class="mt-2 h-80 overflow-y-auto rounded-lg border border-line"
	>
		<ul>
			<!-- Keyed by position: rows stay put and only their text changes, so nothing slides. -->
			{#each data.results as status, row (row)}
				<li
					class="grid h-10 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 border-b border-line px-3 text-sm sm:grid-cols-[3rem_minmax(0,1fr)_6rem]"
				>
					<span class="font-mono font-semibold text-accent-text">{status.code}</span>
					<span class="truncate">{status.phrase}</span>
					<span class="hidden text-xs text-ink-subtle sm:block">{status.kind}</span>
				</li>
			{:else}
				<li class="p-3 text-sm text-ink-muted">No status code matches “{data.query}”.</li>
			{/each}
		</ul>
	</div>
</DemoFrame>
