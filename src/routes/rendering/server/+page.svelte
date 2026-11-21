<script lang="ts">
	import ModeFrame from '#lib/demo/rendering/ModeFrame.svelte';
	import type { PageProps } from './$types';
	import source from './+page.server.ts?highlight';

	let { data }: PageProps = $props();
</script>

<ModeFrame
	path="/rendering/server"
	summary="The server renders the page and sends finished HTML. No JavaScript is downloaded, so there is nothing to hydrate."
	notice={[
		'The readout at the bottom never wakes up. It is a Svelte component, and on this page no Svelte runs in your browser.',
		'View the page source: there is not a single script file in it.',
		'The theme switch still works. It is a few lines of inline script, not a framework.',
		'Links still work, as ordinary page loads.'
	]}
	products={data.products}
	{source}
	file="src/routes/rendering/server/+page.server.ts"
/>
