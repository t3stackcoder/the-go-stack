<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Stress: {data.rows.length} rows</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<h1 class="font-display text-3xl font-semibold tracking-tight">
		{data.rows.length} rows, {data.kind}
	</h1>

	<!-- Fixed layout: column widths that follow the content would change as the rows stream in. -->
	<table class="mt-6 w-full table-fixed text-left text-sm tabular-nums">
		<thead>
			<tr class="border-b border-line">
				<th class="py-1">Id</th>
				<th>Name</th>
				<th>Price</th>
				<th>Stock</th>
			</tr>
		</thead>
		<tbody>
			{#each data.rows as row (row.id)}
				<tr class="border-b border-line">
					<td class="py-1">{row.id}</td>
					<td>{row.name}</td>
					<td>{row.price}</td>
					<td>{row.stock}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
