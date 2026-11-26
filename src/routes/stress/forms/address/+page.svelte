<script lang="ts">
	import { addressForm } from '#lib/forms/address-form.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const sameTags = (ticked: FormDataEntryValue[]) =>
		ticked.length === data.tags.length && data.tags.every((tag) => ticked.includes(tag));

	let form: HTMLFormElement;
	addressForm(
		() => form,
		(fields) =>
			fields.get('q') === data.q &&
			sameTags(fields.getAll('tag')) &&
			fields.get('sort') === data.sort &&
			fields.get('per') === data.per &&
			fields.has('only') === data.only
	);

	const here = resolve('/stress/forms/address');

	const send = (event: Event & { currentTarget: HTMLInputElement | HTMLSelectElement }) =>
		event.currentTarget.form?.requestSubmit();

	const field = 'mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3';
</script>

<svelte:head>
	<title>Stress: a form of every kind of field, kept in the address</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		Every kind of field, kept in the address
	</h1>

	<!-- As on the search page: every change is sent, and replaces the history entry. -->
	<form
		bind:this={form}
		method="GET"
		data-sveltekit-reset={false}
		data-sveltekit-replacestate
		class="mt-6 grid max-w-3xl gap-x-6 gap-y-4 text-sm sm:grid-cols-2"
	>
		<!-- Carried along, so a slow page stays slow after the form is sent. -->
		{#if data.slow}
			<input type="hidden" name="slow" value={data.slow} />
		{/if}

		<label>
			Text
			<input name="q" defaultValue={data.q} autocomplete="off" oninput={send} class={field} />
		</label>

		<label>
			Select
			<select name="per" defaultValue={data.per} onchange={send} class={field}>
				<option value="10">10</option>
				<option value="25">25</option>
				<option value="50">50</option>
			</select>
		</label>

		<fieldset class="flex gap-4">
			<legend class="sr-only">Checkbox group</legend>
			{#each ['a', 'b', 'c'] as const as tag (tag)}
				<label class="flex items-center gap-2">
					<input
						name="tag"
						type="checkbox"
						value={tag}
						defaultChecked={data.tags.includes(tag)}
						onchange={send}
						class="size-4"
					/>
					{tag}
				</label>
			{/each}
		</fieldset>

		<fieldset class="flex gap-4">
			<legend class="sr-only">Radio group</legend>
			{#each ['new', 'old', 'best'] as const as sort (sort)}
				<label class="flex items-center gap-2">
					<input
						name="sort"
						type="radio"
						value={sort}
						defaultChecked={data.sort === sort}
						onchange={send}
						class="size-4"
					/>
					{sort}
				</label>
			{/each}
		</fieldset>

		<label class="flex items-center gap-2">
			<input
				name="only"
				type="checkbox"
				defaultChecked={data.only}
				onchange={send}
				class="size-4"
			/>
			Checkbox
		</label>

		<noscript>
			<button type="submit" class="h-10 rounded-lg bg-brand px-4 font-semibold text-brand-ink">
				Send
			</button>
		</noscript>
	</form>

	<h2 class="mt-8 text-sm font-medium">What the address says</h2>
	<!-- One line, clipped: the text changes with every edit, and the space it takes must not. -->
	<pre
		data-address
		class="mt-2 h-10 truncate rounded-lg border border-line p-2 text-sm"
	>{JSON.stringify({
		q: data.q,
		tags: data.tags,
		sort: data.sort,
		per: data.per,
		only: data.only
	})}</pre>

	<p class="mt-4 flex gap-4 text-sm">
		<a
			data-link
			href="{here}?q=linked&tag=b&tag=c&sort=best&per=50&only=on{data.slow
				? `&slow=${data.slow}`
				: ''}"
			class="text-brand-text underline underline-offset-2"
		>
			A link to another state
		</a>
		<a
			data-start
			href="{here}{data.slow ? `?slow=${data.slow}` : ''}"
			class="text-brand-text underline underline-offset-2"
		>
			Start again
		</a>
	</p>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
