<!--
	Accent colour picker. Like ThemeSwitch beside it, it deliberately has no script, for the same
	reason: the stored choice is put on <html> as `data-accent` by the boot script in app.html before
	first paint, and which swatch reads as selected is derived from that in CSS. Anything drawn from
	component state would be wrong in the server's HTML and corrected after hydration.

	The palette is a native popover. The browser opens and closes it, closes it on Escape or a press
	outside it, and returns focus to the button, all without JavaScript. CSS anchor positioning puts
	it under the button. A browser without anchor positioning shows it in the middle of the window,
	the popover's own default, which still works. It stays open after a choice, so colours can be
	compared one after another.

	Each swatch carries `data-accent` itself, so its `bg-brand` is its own colour in whichever theme
	is showing (see "Accents" in layout.css), and no colour is written twice.

	The button has a fixed size, so the controls beside it cannot move when it arrives.
-->
<script lang="ts" module>
	import Check from '@lucide/svelte/icons/check';
	import Palette from '@lucide/svelte/icons/palette';
	import { accents } from './accents.js';
</script>

<button
	type="button"
	popovertarget="accent-palette"
	title="Accent colour"
	class="trigger grid size-[calc(2.125rem+2px)] shrink-0 place-items-center rounded-full border border-brand/25 bg-brand-soft text-brand-text hover:text-ink"
>
	<Palette size={16} strokeWidth={1.75} aria-hidden="true" />
	<span class="sr-only">Accent colour</span>
</button>

<div
	id="accent-palette"
	popover
	class="palette rounded-xl border border-line bg-surface p-3 text-ink"
>
	<p id="accent-palette-label" class="mb-2 text-xs font-medium text-ink-muted">Accent colour</p>
	<div role="group" aria-labelledby="accent-palette-label" class="grid grid-cols-4 gap-1.5">
		{#each accents as accent (accent.value)}
			<button
				type="button"
				data-accent-set={accent.value}
				title={accent.label}
				class="grid size-9 place-items-center rounded-full hover:bg-sunken"
			>
				<span
					data-accent={accent.value}
					class="dot grid size-7 place-items-center rounded-full bg-brand text-brand-ink"
				>
					<span class="selected">
						<Check size={14} strokeWidth={3} aria-hidden="true" />
					</span>
				</span>
				<span class="sr-only">{accent.label}</span>
				<!-- Announced only for the active accent; see the rules below. -->
				<span class="selected sr-only">(selected)</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.trigger {
		anchor-name: --accent-trigger;
	}

	/* Below the button, its right edge under the button's. */
	@supports (position-area: bottom) {
		.palette {
			position-anchor: --accent-trigger;
			position-area: bottom span-left;
			margin: 0.5rem 0 0;
		}
	}

	.palette {
		box-shadow:
			0 10px 24px -6px oklch(0 0 0 / 0.18),
			0 2px 6px oklch(0 0 0 / 0.08);
	}

	.selected {
		display: none;
	}

	/* A ring in the swatch's own colour, apart from it by a gap of the palette's background. */
	.dot {
		transition: box-shadow 150ms ease-out;
	}

	:global(:root:not([data-accent])) [data-accent-set='orange'] .dot,
	:global(:root[data-accent='red']) [data-accent-set='red'] .dot,
	:global(:root[data-accent='amber']) [data-accent-set='amber'] .dot,
	:global(:root[data-accent='green']) [data-accent-set='green'] .dot,
	:global(:root[data-accent='teal']) [data-accent-set='teal'] .dot,
	:global(:root[data-accent='blue']) [data-accent-set='blue'] .dot,
	:global(:root[data-accent='purple']) [data-accent-set='purple'] .dot,
	:global(:root[data-accent='pink']) [data-accent-set='pink'] .dot {
		box-shadow:
			0 0 0 2px var(--color-surface),
			0 0 0 4px var(--color-brand);
	}

	:global(:root:not([data-accent])) [data-accent-set='orange'] .selected,
	:global(:root[data-accent='red']) [data-accent-set='red'] .selected,
	:global(:root[data-accent='amber']) [data-accent-set='amber'] .selected,
	:global(:root[data-accent='green']) [data-accent-set='green'] .selected,
	:global(:root[data-accent='teal']) [data-accent-set='teal'] .selected,
	:global(:root[data-accent='blue']) [data-accent-set='blue'] .selected,
	:global(:root[data-accent='purple']) [data-accent-set='purple'] .selected,
	:global(:root[data-accent='pink']) [data-accent-set='pink'] .selected {
		display: grid;
	}
</style>
