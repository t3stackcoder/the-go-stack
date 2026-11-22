<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The request in flight. With `?multi=abort` a new submission abandons it, and its answer is
	// then never applied. Bookkeeping only, so it is not reactive.
	let latest: AbortController | undefined;

	const save: SubmitFunction = ({ controller }) => {
		if (data.multi === 'abort') latest?.abort();
		latest = controller;

		// The field keeps what was typed, so the next number can be sent at once.
		return ({ update }) => update({ reset: false });
	};
</script>

<svelte:head>
	<title>Stress: a plain form, sent again before its answer</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A plain form, sent again before its answer: {data.multi}
	</h1>

	<div class="mt-6 flex items-end gap-3 text-sm">
		<form
			method="POST"
			action="?/save&multi={data.multi}"
			use:enhance={save}
			class="flex items-end gap-3"
		>
			<label>
				<span class="font-medium">A number, 1 to 9</span>
				<input
					name="value"
					type="number"
					min="1"
					max="9"
					defaultValue="1"
					class="mt-1.5 block h-10 w-32 rounded-lg border border-line-strong bg-surface px-3"
				/>
			</label>
			<button class="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">Save</button>
		</form>

		<!-- A plain post and a full page load, so the page starts again as well as the server. -->
		<form method="POST" action="?/reset&multi={data.multi}">
			<button class="h-10 rounded-lg border border-line bg-surface px-4 font-medium">Reset</button>
		</form>
	</div>

	<!-- Fixed rows: what they say changes with every answer, and the space they take must not. -->
	<dl class="mt-6 grid max-w-xl grid-cols-[14rem_minmax(0,1fr)] gap-y-2 text-sm tabular-nums">
		<dt class="text-ink-muted">The page was last told</dt>
		<dd data-told class="h-5 truncate">{form?.saved ? `saved ${form.saved}` : ''}</dd>
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
