<!--
	Shown in place of any page that cannot be: one that does not exist, or one whose code failed.
	It renders inside the root layout, so the navigation, the theme and the readout all stay.

	The message comes from the error hooks (src/hooks.server.ts and src/hooks.client.ts), which
	replace anything unexpected with a sentence that is safe to show and a reference to quote.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const missing = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{missing ? 'Page not found' : 'Something went wrong'} · Team Collaborator</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-20 pb-12 sm:pt-28">
	<p class="font-mono text-sm text-brand-text">Error {page.status}</p>
	<h1
		class="mt-5 max-w-3xl font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]"
	>
		{missing ? 'There is no page at this address' : 'This page could not be shown'}
	</h1>
	<p class="mt-6 max-w-2xl text-xl leading-relaxed text-pretty text-ink-muted">
		{missing
			? 'The link that brought you here is wrong or out of date. Everything on this site can be reached from the start.'
			: page.error?.message}
	</p>
	{#if page.error?.reference}
		<p class="mt-4 font-mono text-sm text-ink-subtle">Reference {page.error.reference}</p>
	{/if}
	<p class="mt-10">
		<a
			href={resolve('/team-collaborator')}
			class="inline-block rounded-lg bg-brand px-5 py-3 font-semibold text-brand-ink"
		>
			Back to the start
		</a>
	</p>
</div>
