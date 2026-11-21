<!--
	Theme control. It deliberately has no script.

	Clicks are handled by the theme boot script in app.html, and which option looks (and reads as)
	selected is derived in CSS from the `data-theme` attribute on <html>. The server cannot know the
	stored choice, so anything rendered from component state here would be wrong in the HTML and
	corrected after hydration: a visible flicker. Deriving it in CSS makes it right at first paint,
	on every kind of page, including pages that ship no JavaScript.
-->
<script lang="ts" module>
	const options = [
		{ value: 'system', label: 'System theme' },
		{ value: 'light', label: 'Light theme' },
		{ value: 'dark', label: 'Dark theme' }
	] as const;
</script>

<div
	role="group"
	aria-label="Theme"
	class="flex h-8 items-center gap-0.5 rounded-full border border-line bg-sunken p-0.5"
>
	{#each options as option (option.value)}
		<button
			type="button"
			data-theme-set={option.value}
			title={option.label}
			class="grid size-6.5 place-items-center rounded-full text-ink-subtle hover:text-ink"
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

	:global(:root:not([data-theme])) [data-theme-set='system'],
	:global(:root[data-theme='light']) [data-theme-set='light'],
	:global(:root[data-theme='dark']) [data-theme-set='dark'] {
		background-color: var(--color-surface);
		color: var(--color-ink);
		box-shadow: 0 0 0 1px var(--color-line);
	}

	:global(:root:not([data-theme])) [data-theme-set='system'] .selected,
	:global(:root[data-theme='light']) [data-theme-set='light'] .selected,
	:global(:root[data-theme='dark']) [data-theme-set='dark'] .selected {
		display: block;
	}
</style>
