<!--
	Theme control. It deliberately has no script.

	Clicks, and the slide of a press dragged across the segments, are handled by the theme boot
	script in app.html. Which option looks (and reads as) selected, and where the thumb sits under
	it, is derived in CSS from the `data-theme` attribute on <html>. The server cannot know the
	stored choice, so anything rendered from component state here would be wrong in the HTML and
	corrected after hydration: a visible flicker. Deriving it in CSS makes it right at first paint,
	on every kind of page, including pages that ship no JavaScript.

	The group has a fixed width, written out as what it holds: three buttons of 1.625rem, two gaps
	of 0.125rem, two paddings of 0.25rem, and a border of 1px on each side. It is the first thing in the
	page that is pushed to the right, and a page's first paint can come while its HTML is still
	arriving. Sized by its contents, the group was then drawn with one button and moved left as the
	others turned up: a layout shift, recorded on 6 of 16 loads over a slow connection. Change the
	options, and the width has to be changed with them, and so do the thumb's offsets below.
-->
<script lang="ts" module>
	const options = [
		{ value: 'system', label: 'System theme' },
		{ value: 'light', label: 'Light theme' },
		{ value: 'dark', label: 'Dark theme' }
	] as const;
</script>

<!-- `touch-none`: a finger sliding across the switch changes the theme instead of scrolling the page. -->
<div
	role="group"
	aria-label="Theme"
	data-theme-group
	class="relative flex h-[calc(2.125rem+2px)] w-[calc(5.625rem+2px)] shrink-0 touch-none items-center gap-0.5 rounded-full border border-brand/25 bg-brand-soft p-1 select-none"
>
	<span
		aria-hidden="true"
		class="thumb pointer-events-none absolute top-1 left-1 size-6.5 rounded-full bg-brand"
	></span>
	{#each options as option (option.value)}
		<button
			type="button"
			data-theme-set={option.value}
			title={option.label}
			class="option relative grid size-6.5 place-items-center rounded-full text-ink-muted hover:text-ink"
		>
			<svg
				viewBox="0 0 16 16"
				width="14"
				height="14"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				{#if option.value === 'system'}
					<rect x="2" y="3" width="12" height="8" rx="1.5" />
					<path d="M5.5 14h5M8 11v3" />
				{:else if option.value === 'light'}
					<circle cx="8" cy="8" r="3" />
					<path
						d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"
					/>
				{:else}
					<path d="M13.5 9.5a6 6 0 0 1-7-7 6 6 0 1 0 7 7Z" />
				{/if}
			</svg>
			<span class="sr-only">{option.label}</span>
			<!-- Announced only for the active option; see the rules below. -->
			<span class="selected sr-only">(selected)</span>
		</button>
	{/each}
</div>

<style>
	.selected {
		display: none;
	}

	/*
	 * One step is a button and a gap: 1.625rem + 0.125rem. The thumb is placed before first paint
	 * like everything else here, and a transition runs only on a change, so it slides when the
	 * theme is changed and never on arrival. Reduced motion stops it (see layout.css).
	 */
	.thumb {
		box-shadow: 0 1px 3px oklch(0 0 0 / 0.25);
		transition: translate 300ms cubic-bezier(0.65, 0, 0.35, 1);
	}

	/* The selected icon changes colour in step with the thumb arriving under it. */
	.option {
		transition: color 300ms cubic-bezier(0.65, 0, 0.35, 1);
	}

	:global(:root[data-theme='light']) .thumb {
		translate: 1.75rem 0;
	}

	:global(:root[data-theme='dark']) .thumb {
		translate: 3.5rem 0;
	}

	:global(:root:not([data-theme])) [data-theme-set='system'],
	:global(:root[data-theme='light']) [data-theme-set='light'],
	:global(:root[data-theme='dark']) [data-theme-set='dark'] {
		color: var(--color-brand-ink);
	}

	:global(:root:not([data-theme])) [data-theme-set='system'] .selected,
	:global(:root[data-theme='light']) [data-theme-set='light'] .selected,
	:global(:root[data-theme='dark']) [data-theme-set='dark'] .selected {
		display: block;
	}
</style>
