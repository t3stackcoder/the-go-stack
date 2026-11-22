<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Nested data is posted as JSON. A saved table keeps what was typed, as its twin does.
	// Superforms takes the form once, here, and follows later answers through the page itself.
	// svelte-ignore state_referenced_locally
	const { form, errors, message, enhance } = superForm(data.form, {
		dataType: 'json',
		resetForm: false
	});

	const field = 'h-8 w-full rounded border border-line-strong bg-surface px-2';
</script>

<svelte:head>
	<title>Stress: a Superforms form of {$form.rows.length} rows</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		A Superforms form of {$form.rows.length} rows
	</h1>

	<form method="POST" action="?/save&n={$form.rows.length}" use:enhance class="mt-6 text-sm">
		<div class="flex items-center gap-4">
			<button class="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">Save</button>
			<p data-status role="status" class="h-5 truncate">{$message ?? ''}</p>
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
				{#each $form.rows.keys() as index (index)}
					{@const refused = $errors.rows?.[index]}
					<tr class="h-10 border-b border-line">
						<td class="pr-2">
							<input aria-label="Name" bind:value={$form.rows[index].name} class={field} />
						</td>
						<td class="pr-2">
							<input
								aria-label="Price"
								type="number"
								step="any"
								bind:value={$form.rows[index].price}
								class={field}
							/>
						</td>
						<td class="pr-2">
							<input
								aria-label="Stock"
								type="number"
								bind:value={$form.rows[index].stock}
								class={field}
							/>
						</td>
						<td data-error class="truncate text-bad">
							{refused?.name?.[0] ?? refused?.price?.[0] ?? refused?.stock?.[0] ?? ''}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</form>
</div>
