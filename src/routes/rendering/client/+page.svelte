<script lang="ts">
	import ModeFrame from '#lib/demo/rendering/ModeFrame.svelte';
	import source from './+page.ts?highlight';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<ModeFrame
	path="/rendering/client"
	summary="The server sends an empty shell. The browser downloads the app, fetches the data, and builds the page itself."
	notice={[
		'View the page source: the body is empty. Nothing you see here was in the HTML.',
		'Reload and the page is blank until the JavaScript arrives and the catalog request returns.',
		'When it does appear, it appears whole. The layout shift is still 0.',
		'This suits screens behind a login, where search engines and first paint matter less.'
	]}
	products={data.products}
	{source}
	file="src/routes/rendering/client/+page.ts"
/>
