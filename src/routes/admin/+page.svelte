<!--
	The admin area's front page: one card for each thing the visitor's role lets them do here. The
	server says which (./+page.server.ts). For now that is the health check.
-->
<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Admin · Team Collaborator</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-6 pt-10 sm:pt-14">
	<h1 class="font-display text-2xl font-semibold tracking-tight sm:text-4xl">Admin</h1>
	<p class="mt-2 text-ink-muted">What your role lets you look after.</p>

	<ul class="mt-8 grid gap-3 sm:grid-cols-2">
		{#if data.tools.health}
			<li>
				<a
					href={resolve('/admin/health')}
					class="flex items-center gap-4 rounded-xl border border-line bg-surface p-4 hover:border-line-strong"
				>
					<span
						class="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text"
					>
						<Activity size={18} strokeWidth={1.75} aria-hidden="true" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block font-medium">Health check</span>
						<span class="block text-sm text-ink-muted">
							See which services are running, and start or stop them.
						</span>
					</span>
					<ChevronRight size={16} class="shrink-0 text-ink-subtle" aria-hidden="true" />
				</a>
			</li>
		{:else}
			<li class="text-ink-muted">Nothing here is open to your role yet.</li>
		{/if}
	</ul>
</div>
