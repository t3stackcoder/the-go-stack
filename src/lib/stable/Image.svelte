<!--
	The one way to put an image on a page. Its box is sized before any of the image has arrived, so
	the image cannot move what is around it. A test (src/markup.test.ts) forbids a bare <img>
	anywhere else.

	An image file in this repository is imported with `?enhanced`. The build reads its dimensions
	and writes it as AVIF, WebP and its original format, so there is nothing to declare:

	    import ridge from '#lib/assets/ridge.jpg?enhanced';
	    <Image src={ridge} alt="A ridge at dusk" />

	An image only known by its address, such as one from a database or another site, must come with
	the width and height of the box to hold open for it. The type check enforces that:

	    <Image src={photo.url} width={photo.width} height={photo.height} alt={photo.caption} />

	The box is binding. If the file turns out to be a different shape from the one declared, it is
	cropped to fill the box; the box does not change to fit the file.
-->
<script lang="ts">
	import type { Picture } from '@sveltejs/enhanced-img';
	import type { ClassValue } from 'svelte/elements';

	type Source =
		| { /** A `?enhanced` import. */ src: Picture; width?: never; height?: never }
		| {
				/** The image's address. */
				src: string;
				/** The shape of the box to reserve. Normally the image's own pixel dimensions. */
				width: number;
				height: number;
		  };

	const props: Source & {
		/** What the image shows, for people who cannot see it. Empty for pure decoration. */
		alt: string;
		/**
		 * Set on an image that is part of the first paint. It is then fetched at once and ahead of
		 * other downloads. Every other image waits until the visitor scrolls near it.
		 */
		priority?: boolean;
		/**
		 * How wide the image is displayed, in the form of the HTML attribute. Needed when the import
		 * lists widths (`?w=480;960&enhanced`), so the browser can pick the smallest file that fits.
		 */
		sizes?: string;
		/** Styles the image. Its width may be set here; its shape comes from its dimensions. */
		class?: ClassValue;
	} = $props();

	/** Reserved when a caller that bypassed the type check supplies no usable dimensions. */
	const FALLBACK = { width: 3, height: 2 };

	const image = $derived.by(() => {
		const { src, width = 0, height = 0 } = props;

		if (typeof src !== 'string') {
			const { img, sources } = src;
			return { src: img.src, width: img.w, height: img.h, sources: Object.entries(sources) };
		}

		if (width > 0 && height > 0) return { src, width, height, sources: [] };

		// Data can lie where types cannot follow it. The space is reserved regardless, and the
		// mistake is reported instead of being left to show up as a layout shift.
		console.warn(
			`[stable] Image "${src}" was given width ${props.width} and height ${props.height}. ` +
				`A ${FALLBACK.width}:${FALLBACK.height} box was reserved for it instead. Pass its real dimensions.`
		);
		return { src, ...FALLBACK, sources: [] };
	});
</script>

<picture>
	{#each image.sources as [format, srcset] (format)}
		<source {srcset} sizes={props.sizes} type="image/{format}" />
	{/each}
	<!--
		`width` and `height` let the browser reserve the shape before the file arrives. The explicit
		aspect ratio makes that shape hold afterwards as well: on their own, the attributes yield to
		the file's real proportions once it has loaded.

		In the dark theme an image is dimmed a little, so that a bright one does not glare beside
		dark surfaces. A filter is not a colour, so it cannot be a token with a light and a dark
		value: it is what the `dark:` variant in layout.css is for.
	-->
	<img
		src={image.src}
		width={image.width}
		height={image.height}
		alt={props.alt}
		sizes={props.sizes}
		loading={props.priority ? 'eager' : 'lazy'}
		fetchpriority={props.priority ? 'high' : 'auto'}
		decoding={props.priority ? 'auto' : 'async'}
		style:aspect-ratio="{image.width} / {image.height}"
		class={['bg-sunken object-cover dark:brightness-90', props.class]}
	/>
</picture>
