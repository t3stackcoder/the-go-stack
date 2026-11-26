<!--
	Where Polar sends a buyer back to: a page that waits for their subscription to be confirmed,
	and moves on to the billing page by itself once it is (./+page.server.ts).

	It looks again about once a second, for half a minute (#lib/billing/activation.ts):

	- With JavaScript, by loading its data again where it stands: `reloadData`, which asks
	  SvelteKit's `refreshAll` and keeps the page as it is if one look fails. A look that finds
	  the subscription is answered with a redirect to /billing, which SvelteKit follows. Each look
	  waits for the one before, and none is asked once the page has been left, however it was.
	- Without it, by refreshing itself: a <meta> refresh in a <noscript>, as the root layout does
	  for a page that streams. Each refresh counts one more look in the address, so that this too
	  stops after half a minute, and does not refresh for as long as the tab is left open.

	Then it stops, and says that it is taking longer than usual and that nothing more needs doing:
	the subscription is confirmed whether or not anybody is watching. The line that says so is
	there from the start, two lines tall, the link to billing is always there, and the spinner
	keeps its place once it has gone, so stopping moves nothing.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { LOOK_EVERY, LOOKS } from '#lib/billing/activation.js';
	import { reloadData } from '#lib/forms/reload.svelte.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Whether the page has stopped looking. Arrived at already by a page without JavaScript. */
	let late = $state(untrack(() => data.late));

	onMount(() => {
		if (late) return;

		// Half a minute by the clock, and not thirty looks: a look can take seconds to answer.
		const until = performance.now() + LOOKS * LOOK_EVERY;
		let left = false;
		let timer: ReturnType<typeof setTimeout>;

		const look = () => {
			timer = setTimeout(async () => {
				await reloadData();
				if (left) return;
				if (performance.now() >= until) late = true;
				else look();
			}, LOOK_EVERY);
		};
		look();

		return () => {
			left = true;
			clearTimeout(timer);
		};
	});
</script>

<svelte:head>
	<title>Confirming your payment · Team Collaborator</title>
	{#if !data.late}
		<noscript>
			<meta http-equiv="refresh" content="{LOOK_EVERY / 1000}; url={data.next}" />
		</noscript>
	{/if}
</svelte:head>

<div class="mx-auto max-w-md px-6 pt-10 sm:pt-14">
	<h1 class="font-display text-3xl font-semibold tracking-tight">Confirming your payment</h1>
	<p class="mt-3 text-ink-muted">
		This usually takes a moment. Once it is done, this page takes you to billing by itself.
	</p>

	<p class="mt-7 flex h-5 items-center gap-2 text-sm font-medium">
		<span
			class={[
				'size-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent text-brand-text',
				late ? 'invisible' : 'animate-spin'
			]}
			aria-hidden="true"
		></span>
		{late ? 'Stopped waiting' : 'Waiting for the payment to be confirmed'}
	</p>
	<!-- Always present, and two lines tall, which holds the longest thing it can say. -->
	<p role="status" class="mt-3 h-10 text-sm text-ink-muted">
		{late ? 'This is taking longer than usual. Nothing more needs doing.' : ''}
	</p>

	<p class="text-sm text-ink-muted">
		Your plan shows on the billing page once it is confirmed.
		<a
			href={resolve('/billing')}
			class="font-medium text-brand-text underline-offset-3 hover:underline"
		>
			Go to billing
		</a>
	</p>
</div>
