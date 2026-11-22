<!--
	One field of every kind, each taking what the server holds as its default and none bound to
	state. Under the form the page prints what the server was sent, as the action received it.
-->
<script lang="ts">
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import Textarea from '#lib/forms/Textarea.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// It edits what the server holds, so a save leaves the fields as they are.
	const save = saveForm({ answer: () => form, after: 'keep' });

	// Where each field starts: what was typed and refused, or failing that what the server holds.
	const start = $derived(save.answer?.values ?? data.held);

	const field = 'mt-1.5 w-full rounded-lg border border-line-strong bg-surface px-3';
</script>

<svelte:head>
	<title>Stress: every kind of field, entered before hydration</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		Every kind of field: {data.refuses ? 'refused' : 'saved'}
	</h1>

	<!-- The query is repeated: without JavaScript the answer lands on the action's address. -->
	<form
		method="POST"
		action="?/save{data.refuses ? '&as=refused' : ''}"
		{@attach save.attach}
		class="mt-6 grid max-w-3xl gap-x-6 gap-y-4 text-sm sm:grid-cols-2"
	>
		<label>
			Text
			<input name="text" defaultValue={start.text} class={[field, 'h-10']} />
		</label>

		<label>
			Number
			<input name="count" type="number" defaultValue={start.count} class={[field, 'h-10']} />
		</label>

		<label class="sm:col-span-2">
			Text area
			<Textarea name="notes" rows={2} defaultValue={start.notes} class={[field, 'py-2']} />
		</label>

		<label class="flex items-center gap-2">
			<input name="agree" type="checkbox" defaultChecked={start.agree} class="size-4" />
			Checkbox
		</label>

		<fieldset class="flex gap-4">
			<legend class="sr-only">Radio group</legend>
			{#each ['small', 'medium', 'large'] as const as size (size)}
				<label class="flex items-center gap-2">
					<input
						name="size"
						type="radio"
						value={size}
						defaultChecked={start.size === size}
						class="size-4"
					/>
					{size}
				</label>
			{/each}
		</fieldset>

		<fieldset class="flex gap-4 sm:col-span-2">
			<legend class="sr-only">Checkbox group</legend>
			{#each ['wrap', 'card', 'rush'] as const as extra (extra)}
				<label class="flex items-center gap-2">
					<input
						name="extras"
						type="checkbox"
						value={extra}
						defaultChecked={start.extras.includes(extra)}
						class="size-4"
					/>
					{extra}
				</label>
			{/each}
		</fieldset>

		<label>
			Select
			<select name="colour" defaultValue={start.colour} class={[field, 'h-10']}>
				<option value="red">red</option>
				<option value="green">green</option>
				<option value="blue">blue</option>
			</select>
		</label>

		<label>
			Select, multiple
			<select name="days" multiple size="3" defaultValue={start.days} class={[field, 'py-1']}>
				<option value="mon">mon</option>
				<option value="tue">tue</option>
				<option value="wed">wed</option>
			</select>
		</label>

		<div class="flex items-center gap-4 sm:col-span-2">
			<button
				data-busy={save.busy}
				aria-disabled={save.busy}
				class="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink aria-disabled:cursor-progress"
			>
				Save
			</button>
			<p
				data-status
				data-state={save.status}
				role="status"
				class={['h-5 truncate', save.failed && 'text-bad']}
			>
				{save.message}
			</p>
		</div>

		<!--
			What the server said about each field it turned down. One line for them all: the fields
			are the subject here, and their messages only have to be on the page.
		-->
		<p data-errors class="h-5 truncate text-bad sm:col-span-2">
			{Object.entries(save.answer?.errors ?? {})
				.map(([field, reason]) => `${field}: ${reason}`)
				.join(' ')}
		</p>
	</form>

	<h2 class="mt-8 text-sm font-medium">What the server was sent</h2>
	<!-- One line, clipped: the text changes with every save, and the space it takes must not. -->
	<pre data-sent class="mt-2 h-10 truncate rounded-lg border border-line p-2 text-sm">{save.answer
			?.saved
			? JSON.stringify(save.answer.saved)
			: ''}</pre>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
