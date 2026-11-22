<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Every option but one is left as Superforms ships it: the question is what a form gets
	// unasked. The one is `onError`. Left alone, Superforms throws an action's error in the browser.
	// Measured so: the form said "Sending." for good, the visitor was told nothing, and the browser
	// reported an error of its own beside the one the server had already recorded. The error has
	// been through the error hooks by the time it gets here, so its message is the one meant for
	// the visitor, and a fault carries the reference it was recorded under.
	// Superforms takes the form once, here, and follows later answers through the page itself.
	// svelte-ignore state_referenced_locally
	const { form, errors, message, enhance, delayed, timeout } = superForm(data.form, {
		onError({ result }) {
			const { message: text, reference } = result.error as App.Error;
			$message = reference ? `${text} Reference ${reference}.` : text;
		}
	});

	const field = 'mt-1.5 w-full rounded-lg border border-line-strong bg-surface px-3';
</script>

<svelte:head>
	<title>Stress: Superforms, an action's answers</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		Superforms, answered: {data.as ?? 'saved'}
	</h1>

	<form
		method="POST"
		action="?/send{data.as ? `&as=${data.as}` : ''}"
		use:enhance
		class="mt-6 max-w-md text-sm"
	>
		<label for="title" class="font-medium">Title</label>
		<input
			id="title"
			name="title"
			bind:value={$form.title}
			aria-invalid={$errors.title ? 'true' : undefined}
			aria-describedby="title-error"
			class={[field, 'h-10 aria-[invalid]:border-bad']}
		/>
		<!-- Always present and one line tall, so a message appearing here cannot move anything. -->
		<p id="title-error" data-error class="mt-1 h-5 truncate text-bad">{$errors.title?.[0] ?? ''}</p>

		<label for="note" class="mt-3 block font-medium">Note</label>
		<textarea id="note" name="note" rows="2" bind:value={$form.note} class={[field, 'py-2']}
		></textarea>

		<button class="mt-4 h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">Send</button>

		<p data-status role="status" class="mt-3 h-5 truncate">
			{#if $timeout}
				No answer yet.
			{:else if $delayed}
				Sending.
			{:else if $message}
				{$message}
			{:else if data.arrived}
				Arrived by redirect.
			{/if}
		</p>
	</form>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
