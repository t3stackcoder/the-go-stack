<script lang="ts">
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// A refusal leaves the fields as they are: every row that was typed is still wanted.
	const save = saveForm({ answer: () => form, after: 'keep' });

	// What was typed and refused, or failing that what the server holds. Each field takes it as its
	// default, so the browser keeps every value and no script runs when one is edited.
	const rows = $derived.by(() => {
		const typed = save.answer?.values;
		if (!typed) return data.rows;

		return typed.name.map((name, index) => ({
			name,
			price: typed.price[index] ?? '',
			stock: typed.stock[index] ?? ''
		}));
	});

	// One message a row: the first of its three fields that was turned down.
	const errors = $derived(save.answer?.errors ?? {});
	const refusal = (index: number) =>
		errors[`name.${index}`] ?? errors[`price.${index}`] ?? errors[`stock.${index}`];
	const refused = $derived(rows.filter((_, index) => refusal(index)).length);

	const field =
		'h-8 w-full rounded border border-line-strong bg-surface px-2 aria-[invalid]:border-bad';
</script>

<svelte:head>
	<title>Stress: a form of {data.rows.length} rows</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A form of {data.rows.length} rows
	</h1>

	<!-- The query is repeated: without JavaScript the answer lands on the action's address. -->
	<form
		method="POST"
		action="?/save&n={data.rows.length}"
		{@attach save.attach}
		class="mt-6 text-sm"
	>
		<div class="flex items-center gap-4">
			<button
				type="submit"
				data-busy={save.busy}
				aria-disabled={save.busy}
				class="h-10 rounded-lg bg-brand px-4 font-semibold text-brand-ink aria-disabled:cursor-progress"
			>
				Save
			</button>
			<p
				data-status
				data-state={save.status}
				role="status"
				class={['h-5 truncate', save.failed && 'text-bad']}
			>
				<!-- How many rows, in place of the helper's own words for a refusal of fields. -->
				{refused && save.failed ? `${refused} of ${rows.length} rows refused.` : save.message}
			</p>
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
					{@const described = refusal(index) ? `row-${index}-error` : undefined}
					<tr class="h-10 border-b border-line">
						<td class="pr-2">
							<input
								name="name"
								aria-label="Name"
								defaultValue={row.name}
								aria-invalid={errors[`name.${index}`] ? 'true' : undefined}
								aria-describedby={described}
								class={field}
							/>
						</td>
						<td class="pr-2">
							<input
								name="price"
								aria-label="Price"
								defaultValue={row.price}
								aria-invalid={errors[`price.${index}`] ? 'true' : undefined}
								aria-describedby={described}
								class={field}
							/>
						</td>
						<td class="pr-2">
							<input
								name="stock"
								aria-label="Stock"
								defaultValue={row.stock}
								aria-invalid={errors[`stock.${index}`] ? 'true' : undefined}
								aria-describedby={described}
								class={field}
							/>
						</td>
						<td id="row-{index}-error" data-error class="truncate text-bad">
							{refusal(index) ?? ''}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</form>
</div>
