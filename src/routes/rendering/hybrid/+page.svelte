<script lang="ts">
	import ModeFrame from '#lib/demo/rendering/ModeFrame.svelte';
	import ClientOnly from '#lib/stable/ClientOnly.svelte';
	import Streamed from '#lib/stable/Streamed.svelte';
	import source from './+page.server.ts?highlight';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<ModeFrame
	path="/rendering/hybrid"
	summary="The server sends finished HTML, then the browser hydrates it: the same components attach their behaviour to markup that is already on screen."
	notice={[
		'The catalog is readable before any JavaScript has run. Hydration adds behaviour; it does not add content.',
		'The stock figure is slow on purpose. The page did not wait for it: it streamed in over the same response.',
		'The viewport size cannot be known on the server. It appears after hydration, in space held open for it.',
		'The readout reports a layout shift of 0. Late content arrived, and nothing moved.'
	]}
	products={data.products}
	{source}
	file="src/routes/rendering/hybrid/+page.server.ts"
>
	<div class="grid gap-6 sm:grid-cols-2">
		<section class="rounded-2xl border border-line bg-surface p-5">
			<h2 class="text-sm font-medium text-ink-muted">Streamed from the server</h2>
			<Streamed value={data.stock} class="mt-2 h-10">
				{#snippet children(stock: Record<number, number>)}
					<p class="self-center text-2xl font-semibold tabular-nums">
						{Object.values(stock).reduce((total, units) => total + units, 0)}
						<span class="text-sm font-normal text-ink-muted">units in stock</span>
					</p>
				{/snippet}
			</Streamed>
		</section>

		<section class="rounded-2xl border border-line bg-surface p-5">
			<h2 class="text-sm font-medium text-ink-muted">Known only to the browser</h2>
			<ClientOnly class="mt-2 h-10">
				<p class="self-center text-2xl font-semibold tabular-nums">
					{window.innerWidth} × {window.innerHeight}
					<span class="text-sm font-normal text-ink-muted">viewport</span>
				</p>
			</ClientOnly>
		</section>
	</div>
</ModeFrame>
