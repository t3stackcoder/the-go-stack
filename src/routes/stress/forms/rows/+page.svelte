<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// What was typed and refused, or failing that what the server holds. Each field takes it as its
	// default, so the browser keeps every value and no script runs when one is edited.
	const rows = $derived(form?.rows ?? data.rows);

	const field = 'h-8 w-full rounded border border-line-strong bg-surface px-2';
</script>

<svelte:head>
	<title>Stress: a plain form of {data.rows.length} rows</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A plain form of {data.rows.length} rows
	</h1>

	<!-- A refusal leaves the fields as they are: every row that was typed is still wanted. -->
	<form
		method="POST"
		action="?/save&n={data.rows.length}"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
		class="mt-6 text-sm"
	>
		<div class="flex items-center gap-4">
			<button class="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">Save</button>
			<p data-status role="status" class="h-5 truncate">{form?.message ?? ''}</p>
		</div>

		<!-- Fixed layout: a message arriving in the last column cannot change the width of the others. -->
		<table class="mt-4 w-full table-fixed text-left tabular-nums">
			<thead>
				<tr class="border-b border-line">
					<th class="py-1">Name</th>
					<th>Price</th>
					<th>Stock</th>
					<th>Refused because</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row, index (index)}
					<tr class="h-10 border-b border-line">
						<td class="pr-2">
							<input name="name" aria-label="Name" defaultValue={row.name} class={field} />
						</td>
						<td class="pr-2">
							<input name="price" aria-label="Price" defaultValue={row.price} class={field} />
						</td>
						<td class="pr-2">
							<input name="stock" aria-label="Stock" defaultValue={row.stock} class={field} />
						</td>
						<td data-error class="truncate text-bad">{form?.errors?.[index] ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</form>
</div>
