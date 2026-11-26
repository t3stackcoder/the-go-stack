<script lang="ts">
	import dune from '#lib/assets/demo/dune.jpg?enhanced';
	import moor from '#lib/assets/demo/moor.jpg?enhanced';
	// Shown almost as wide as the page, so it is built at several widths for the browser to choose from.
	import ridge from '#lib/assets/demo/ridge.jpg?w=480;800;1200;1600;2400&enhanced';
	import tide from '#lib/assets/demo/tide.jpg?enhanced';
	import Image from '#lib/stable/Image.svelte';
	import imageSource from '#lib/stable/Image.svelte?highlight';
	import Code from '#lib/ui/Code.svelte';
	import { resolve } from '$app/paths';
	import serverSource from './+page.server.ts?highlight';
	import pageSource from './+page.svelte?highlight';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const summary =
		'An image is the most common thing to arrive after the page it belongs to. Every image here had its box set aside before any of it was downloaded, so nothing around it moves when it lands.';

	const notice = [
		'The picture at the top is part of the first paint, so it is requested at once and ahead of other downloads. The others are requested only as you scroll near them.',
		'Every box was sized before its image arrived. For a file in the repository the dimensions are read during the build, so they cannot be forgotten or mistyped.',
		'The build wrote each of those files as AVIF, WebP and JPEG, and the wide one at five widths. Your browser chose one. A phone does not download the desktop file.',
		'The last picture is known only by data sent with this request: an address, a width and a height. The type check refuses an address without them.',
		'Reload with the network slowed down. The grey boxes fill in, and the readout’s layout shift stays at 0.'
	];

	const gallery = [
		{ picture: dune, alt: 'Layered dunes in ochre, under a pale sun', shape: '4 : 5' },
		{ picture: tide, alt: 'Layered hills in blue, under a pale sun', shape: '1 : 1' },
		{ picture: moor, alt: 'Layered hills in violet, under a pale sun', shape: '3 : 2' }
	];
</script>

<svelte:head>
	<title>Images that hold their place · The case for SvelteKit</title>
	<meta name="description" content={summary} />
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-10 pb-12">
	<a href={resolve('/stability')} class="font-mono text-sm text-brand-text hover:underline">
		← Chapter 05 · Stability
	</a>

	<header class="mt-8 max-w-3xl">
		<h1 class="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
			Images that hold their place
		</h1>
		<p class="mt-4 text-lg text-pretty text-ink-muted">{summary}</p>
	</header>

	<!-- High on the page on purpose: it has to be in the first paint to be what its caption says. -->
	<figure class="mt-8">
		<Image
			src={ridge}
			alt="Layered ridges in amber, under a pale sun"
			priority
			sizes="(min-width: 72rem) 69rem, calc(100vw - 3rem)"
			class="w-full rounded-2xl"
		/>
		<figcaption class="mt-3 text-sm text-ink-subtle">
			Part of the first paint: fetched at once, at whichever of five widths fits this screen.
		</figcaption>
	</figure>

	<section class="mt-10 max-w-3xl rounded-2xl border border-line bg-surface p-5">
		<h2 class="text-sm font-medium">What to notice</h2>
		<ul class="mt-3 space-y-2 text-ink-muted">
			{#each notice as item (item)}
				<li class="flex gap-3">
					<span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true"></span>
					<span>{item}</span>
				</li>
			{/each}
		</ul>
	</section>

	<h2 class="mt-16 font-display text-2xl font-semibold tracking-tight">
		Three shapes, three boxes
	</h2>
	<p class="mt-2 max-w-2xl text-ink-muted">
		Each of these was requested when you scrolled near it. Its box was already the right shape,
		because the build read the shape from the file.
	</p>
	<ul class="mt-6 grid items-start gap-4 sm:grid-cols-3">
		{#each gallery as { picture, alt, shape } (shape)}
			<li>
				<figure>
					<Image src={picture} {alt} class="w-full rounded-2xl" />
					<figcaption class="mt-3 font-mono text-xs text-ink-subtle">{shape}</figcaption>
				</figure>
			</li>
		{/each}
	</ul>

	<h2 class="mt-16 font-display text-2xl font-semibold tracking-tight">
		An image the build never saw
	</h2>
	<p class="mt-2 max-w-2xl text-ink-muted">
		This one is described by data loaded for this request, as an upload or a product photograph
		would be. Its width and height came with its address, and they are the box. If a file turns out
		to be some other shape, it is cropped to the box it was promised.
	</p>
	<figure class="mt-6 max-w-2xl">
		<Image
			src={data.photo.src}
			width={data.photo.width}
			height={data.photo.height}
			alt={data.photo.caption}
			class="w-full rounded-2xl"
		/>
		<figcaption class="mt-3 font-mono text-xs text-ink-subtle">
			{data.photo.width} × {data.photo.height}, from the load function
		</figcaption>
	</figure>

	<h2 class="mt-16 font-display text-2xl font-semibold tracking-tight">The code</h2>
	<p class="mt-2 max-w-2xl text-ink-muted">
		The component every image on this site goes through, and the files behind this page.
	</p>
	<div class="mt-6 max-w-4xl space-y-6">
		<Code html={imageSource} file="src/lib/stable/Image.svelte" />
		<Code html={serverSource} file="src/routes/stability/images/+page.server.ts" />
		<Code html={pageSource} file="src/routes/stability/images/+page.svelte" />
	</div>
</div>
