<script lang="ts">
	import Dashboard from '#lib/demo/data/Dashboard.svelte';
	import DemoFrame from '#lib/demo/data/DemoFrame.svelte';
	import Panel from '#lib/demo/data/Panel.svelte';
	import panelSource from '#lib/demo/data/Panel.svelte?highlight';
	import serverSource from './+page.server.ts?highlight';
	import pageSource from './+page.svelte?highlight';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DemoFrame
	path="/data/streaming"
	files={[
		{ html: serverSource, file: 'src/routes/data/streaming/+page.server.ts' },
		{ html: pageSource, file: 'src/routes/data/streaming/+page.svelte' },
		{ html: panelSource, file: 'src/lib/demo/data/Panel.svelte' }
	]}
>
	<Dashboard panels={['Catalog', 'Stock', 'Prices', 'Delivery', 'Rating']}>
		<!-- A panel takes a plain value or a promise: the page does not care which. -->
		<Panel name="Catalog" data={data.catalog} />
		<Panel name="Stock" data={data.stock} />
		<Panel name="Prices" data={data.prices} />
		<Panel name="Delivery" data={data.delivery} />
		<Panel name="Rating" data={data.rating} />
	</Dashboard>
</DemoFrame>
