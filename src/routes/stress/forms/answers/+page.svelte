<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const field = 'mt-1.5 w-full rounded-lg border border-line-strong bg-surface px-3';
</script>

<svelte:head>
	<title>Stress: a plain form, an action's answers</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A plain form, answered: {data.as ?? 'saved'}
	</h1>

	<!-- `use:enhance` with no arguments: the question is what a form gets unasked. -->
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
			defaultValue={form?.values?.title ?? ''}
			aria-invalid={form?.errors?.title ? 'true' : undefined}
			aria-describedby="title-error"
			class={[field, 'h-10 aria-[invalid]:border-bad']}
		/>
		<!-- Always present and one line tall, so a message appearing here cannot move anything. -->
		<p id="title-error" data-error class="mt-1 h-5 truncate text-bad">
			{form?.errors?.title ?? ''}
		</p>

		<label for="note" class="mt-3 block font-medium">Note</label>
		<textarea
			id="note"
			name="note"
			rows="2"
			defaultValue={form?.values?.note ?? ''}
			class={[field, 'py-2']}></textarea>

		<button class="mt-4 h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">Send</button>

		<p data-status role="status" class="mt-3 h-5 truncate">
			{form?.message ?? (data.arrived ? 'Arrived by redirect.' : '')}
		</p>
	</form>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
