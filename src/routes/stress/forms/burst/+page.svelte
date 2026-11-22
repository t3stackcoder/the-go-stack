<script lang="ts">
	import { untrack } from 'svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The field keeps what was typed, so the next number can be sent at once. The rule for a
	// second send is fixed when the form is set up, so it is read once: another rule is another
	// page load.
	const save = saveForm({
		answer: () => form,
		again: untrack(() => data.again),
		after: 'keep'
	});
</script>

<svelte:head>
	<title>Stress: a form, sent again before its answer</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A form, sent again before its answer: {data.again}
	</h1>

	<div class="mt-6 flex items-end gap-3 text-sm">
		<form
			method="POST"
			action="?/save&again={data.again}"
			{@attach save.attach}
			class="flex items-end gap-3"
		>
			<label>
				<span class="font-medium">A number, 1 to 9</span>
				<input
					name="value"
					type="number"
					min="1"
					max="9"
					defaultValue={save.answer?.values?.value ?? '1'}
					aria-invalid={save.answer?.errors?.value ? 'true' : undefined}
					aria-describedby="value-error"
					class="mt-1.5 block h-10 w-32 rounded-lg border border-line-strong bg-surface px-3 aria-[invalid]:border-bad"
				/>
			</label>
			<button
				data-busy={save.busy}
				aria-disabled={save.busy}
				class="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink aria-disabled:cursor-progress"
			>
				Save
			</button>
		</form>

		<!-- A plain post and a full page load, so the page starts again as well as the server. -->
		<form method="POST" action="?/reset&again={data.again}">
			<button class="h-10 rounded-lg border border-line bg-surface px-4 font-medium">Reset</button>
		</form>
	</div>

	<!-- Fixed rows: what they say changes with every answer, and the space they take must not. -->
	<p id="value-error" data-error class="mt-1 h-5 truncate text-sm text-bad">
		{save.answer?.errors?.value ?? ''}
	</p>
	<p
		data-status
		data-state={save.status}
		role="status"
		class={['h-10 text-sm', save.failed && 'text-bad']}
	>
		{save.message}
	</p>

	<dl class="mt-2 grid max-w-xl grid-cols-[14rem_minmax(0,1fr)] gap-y-2 text-sm tabular-nums">
		<dt class="text-ink-muted">The page was last told</dt>
		<dd data-told class="h-5 truncate">
			{save.answer?.saved ? `saved ${save.answer.saved}` : ''}
		</dd>
		<dt class="text-ink-muted">The server holds</dt>
		<dd data-held class="h-5 truncate">{data.held}</dd>
		<dt class="text-ink-muted">Arrived at the server</dt>
		<dd data-arrivals class="h-5 truncate">
			{data.arrivals
				.map(
					({ value, finished, abandoned }) =>
						`${value}${finished ? '' : ' (running)'}${abandoned ? ' (abandoned)' : ''}`
				)
				.join(', ')}
		</dd>
	</dl>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
