<!--
	The preferences page: one row for each choice, what it is on the left and its control on the
	right, each half the width on a wide window. Each choice is kept with the account.

	The readout's switch is shadcn-svelte's (src/lib/components/ui/switch), in a form that posts
	the state it asks for: "on" while it is off, "off" while it is on, never a flip, because a
	press can reach the server twice. How the press is sent depends on how far the page has got:

	- Until the page has hydrated, and without JavaScript, the switch is the form's submit button,
	  so a press, by pointer or by key, sends the form the browser's own way: a page load, with
	  the new choice on it.
	- Once hydrated it is a plain button. The switch then handles the press itself, and handles
	  Enter and Space too, which it keeps from becoming a click. So the form is sent from the
	  switch's change, and `saveForm` sends it in place. Left a submit button, a click would be
	  sent twice, by the browser and from here, and a key press not at all.

	The switch and the readout change at once, on the assumption that the server will agree.
	Once the answer and the reloaded data are on the page, both are put back to what the server
	holds: the switch to the page's data, the readout to the marker, which came with the answer
	(src/lib/server/auth/call.ts). So a refusal rolls itself back, and a success stays as it was.
-->
<script lang="ts">
	import { showMarker } from '#lib/auth/marker.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import { hydration } from '#lib/stable/hydration.svelte.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let readoutForm = $state<HTMLFormElement>();
	/** The choice on its way to the server. Shown until the server's answer is on the page. */
	let asked = $state<boolean>();
	const showReadout = $derived(asked ?? data.showReadout);

	const readout = saveForm({
		answer: () => form,
		// A switch can be pressed again before the first press is answered. The last one wins.
		again: 'replace',
		after: 'keep',
		sending: (fields) => {
			asked = fields.get('showReadout') === 'true';
			const root = document.documentElement;
			if (asked) root.dataset.readout = '';
			else delete root.dataset.readout;
			return () => {
				asked = undefined;
				showMarker();
			};
		}
	});
</script>

<svelte:head>
	<title>Preferences · Team Collaborator</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-6 pt-10 sm:pt-14">
	<h1 class="font-display text-2xl font-semibold tracking-tight sm:text-4xl">Preferences</h1>
	<p class="mt-2 text-ink-muted">
		Kept with your account, so they follow you to every browser you sign in on.
	</p>

	<section
		aria-labelledby="readout-title"
		class="mt-10 grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-2"
	>
		<div>
			<h2 id="readout-title" class="font-display text-lg font-semibold tracking-tight">
				Readout
			</h2>
			<p class="mt-1 text-sm text-pretty text-ink-muted">
				A bar pinned to the foot of every page, measuring the page you are on.
			</p>
		</div>

		<form method="POST" action="?/readout" bind:this={readoutForm} {@attach readout.attach}>
			<input type="hidden" name="showReadout" value={String(!showReadout)} />
			<div class="flex items-center justify-between gap-6 rounded-xl border border-line p-4">
				<div class="min-w-0">
					<label for="readout-switch" class="font-medium">Show the readout</label>
					<p id="readout-about" class="mt-1 text-sm text-pretty text-ink-muted">
						Live page speed stats.
					</p>
				</div>
				<Switch
					id="readout-switch"
					type={hydration.done ? 'button' : 'submit'}
					checked={showReadout}
					onCheckedChange={() => readoutForm?.requestSubmit()}
					aria-describedby="readout-about"
				/>
			</div>
			<!-- Always present, and two lines tall, which holds the longest thing it can say. -->
			<p
				role="status"
				class={['mt-3 h-10 text-sm', readout.failed ? 'text-bad' : 'text-ink-muted']}
			>
				{readout.message}
			</p>
		</form>
	</section>
</div>
