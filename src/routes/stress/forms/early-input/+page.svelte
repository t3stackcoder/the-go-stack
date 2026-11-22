<!--
	Question: what does a form bound to plain state keep of what a visitor entered before the page
	had hydrated?

	The twin of /stress/superforms/early-input, with the same fields bound to a `$state` object and
	no library between them. Each field starts from a value the server rendered, so one that
	hydration set back is plain to see. Under the form the page prints what the state holds.
-->
<script lang="ts">
	const values = $state({
		text: 'server',
		count: 3,
		notes: 'server',
		agree: false,
		size: 'medium',
		extras: ['card'],
		colour: 'green',
		days: ['tue']
	});

	const field = 'mt-1.5 w-full rounded-lg border border-line-strong bg-surface px-3';
</script>

<svelte:head>
	<title>Stress: bound state, input given before hydration</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		Bound state: input given before hydration
	</h1>

	<form method="POST" class="mt-6 grid max-w-3xl gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
		<label>
			Text
			<input name="text" bind:value={values.text} class={[field, 'h-10']} />
		</label>

		<label>
			Number
			<input name="count" type="number" bind:value={values.count} class={[field, 'h-10']} />
		</label>

		<label class="sm:col-span-2">
			Text area
			<textarea name="notes" rows="2" bind:value={values.notes} class={[field, 'py-2']}></textarea>
		</label>

		<label class="flex items-center gap-2">
			<input name="agree" type="checkbox" bind:checked={values.agree} class="size-4" />
			Checkbox
		</label>

		<fieldset class="flex gap-4">
			<legend class="sr-only">Radio group</legend>
			{#each ['small', 'medium', 'large'] as const as size (size)}
				<label class="flex items-center gap-2">
					<input name="size" type="radio" value={size} bind:group={values.size} class="size-4" />
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
						bind:group={values.extras}
						class="size-4"
					/>
					{extra}
				</label>
			{/each}
		</fieldset>

		<label>
			Select
			<select name="colour" bind:value={values.colour} class={[field, 'h-10']}>
				<option value="red">red</option>
				<option value="green">green</option>
				<option value="blue">blue</option>
			</select>
		</label>

		<label>
			Select, multiple
			<select name="days" multiple size="3" bind:value={values.days} class={[field, 'py-1']}>
				<option value="mon">mon</option>
				<option value="tue">tue</option>
				<option value="wed">wed</option>
			</select>
		</label>
	</form>

	<h2 class="mt-8 text-sm font-medium">What the state holds</h2>
	<!-- One line, clipped: the text changes with every edit, and the space it takes must not. -->
	<pre
		data-store
		class="mt-2 h-10 truncate rounded-lg border border-line p-2 text-sm">{JSON.stringify(
			values
		)}</pre>

	<p class="mt-6 text-sm text-ink-muted">This sentence must not move.</p>
</div>
