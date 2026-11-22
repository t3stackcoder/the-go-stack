<script lang="ts">
	import { untrack } from 'svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import Textarea from '#lib/forms/Textarea.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// `?limit=` shortens the wait for an answer, so `?as=never` need not take eight seconds. It is
	// fixed when the form is set up, so it is read once.
	const save = saveForm({ answer: () => form, limit: untrack(() => data.limit) });

	const field = 'mt-1.5 w-full rounded-lg border border-line-strong bg-surface px-3';
</script>

<svelte:head>
	<title>Stress: a form, an action's answers</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A form, answered: {data.as ?? 'saved'}
	</h1>

	<!-- The query is repeated: without JavaScript the answer lands on the action's address. -->
	<form
		method="POST"
		action="?/send{data.as ? `&as=${data.as}` : ''}{data.limit ? `&limit=${data.limit}` : ''}"
		{@attach save.attach}
		class="mt-6 max-w-md text-sm"
	>
		<label for="title" class="font-medium">Title</label>
		<input
			id="title"
			name="title"
			defaultValue={save.answer?.values?.title ?? ''}
			aria-invalid={save.answer?.errors?.title ? 'true' : undefined}
			aria-describedby="title-error"
			class={[field, 'h-10 aria-[invalid]:border-bad']}
		/>
		<!-- Always present and one line tall, so a message appearing here cannot move anything. -->
		<p id="title-error" data-error class="mt-1 h-5 truncate text-bad">
			{save.answer?.errors?.title ?? ''}
		</p>

		<label for="note" class="mt-3 block font-medium">Note</label>
		<Textarea
			id="note"
			name="note"
			rows={2}
			defaultValue={save.answer?.values?.note ?? ''}
			aria-invalid={save.answer?.errors?.note ? 'true' : undefined}
			aria-describedby="note-error"
			class={[field, 'py-2 aria-[invalid]:border-bad']}
		/>
		<p id="note-error" class="mt-1 h-5 truncate text-bad">{save.answer?.errors?.note ?? ''}</p>

		<button
			data-busy={save.busy}
			aria-disabled={save.busy}
			class="mt-3 h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink aria-disabled:cursor-progress"
		>
			Send
		</button>

		<!-- Two lines: the longest thing it has to say fills both in a narrow window. -->
		<p
			data-status
			data-state={save.status}
			role="status"
			class={['mt-3 h-10', save.failed && 'text-bad']}
		>
			{save.message || (data.arrived ? 'Arrived by redirect.' : '')}
		</p>
	</form>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
