<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import DemoFrame from '#lib/demo/data/DemoFrame.svelte';
	import type { PageProps } from './$types';
	import pageSource from './+page.svelte?highlight';
	import serverSource from './+page.server.ts?highlight';

	// No type is written here: `PageProps` is generated from what `load` returns.
	let { data }: PageProps = $props();

	let refreshing = $state(false);

	// With JavaScript, re-run `load` and fetch only its data. Without, the form reloads the page.
	async function refresh(event: SubmitEvent) {
		event.preventDefault();
		refreshing = true;
		try {
			await refreshAll();
		} finally {
			refreshing = false;
		}
	}
</script>

{#snippet row(expression: string, value: string)}
	<dt
		class="truncate font-mono text-xs leading-6 text-ink-subtle not-first:mt-3 sm:text-sm sm:not-first:mt-0"
	>
		{expression}
	</dt>
	<dd class="truncate leading-6 font-medium tabular-nums">{value}</dd>
{/snippet}

<DemoFrame
	path="/data/typed"
	files={[
		{ html: serverSource, file: 'src/routes/data/typed/+page.server.ts' },
		{ html: pageSource, file: 'src/routes/data/typed/+page.svelte' }
	]}
>
	<dl class="grid gap-x-8 sm:grid-cols-[17rem_minmax(0,1fr)] sm:gap-y-2">
		{@render row('data.runtime.version', data.runtime.version)}
		{@render row('data.runtime.platform', data.runtime.platform)}
		{@render row('data.runtime.arch', data.runtime.arch)}
		{@render row('data.memory.residentBytes', `${(data.memory.residentBytes / 1e6).toFixed(1)} MB`)}
		{@render row('data.renderedAt.toISOString()', data.renderedAt.toISOString())}
		{@render row('data.renderedAt instanceof Date', String(data.renderedAt instanceof Date))}
	</dl>

	<form onsubmit={refresh} class="mt-6">
		<button
			disabled={refreshing}
			class="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
		>
			Run load again
		</button>
	</form>
</DemoFrame>
