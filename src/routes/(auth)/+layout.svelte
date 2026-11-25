<!--
	The frame the account's own pages share: signing in and up, asking for a new password and
	choosing one. They fill the window with no site header (the root layout leaves it off for this
	group), because there is one thing to do on them.

	On a wide window it is a split screen. The form is on the left, under a small link home, and
	the right half is a panel in the accent colour with the mark, the name and a few words. The
	panel is the visitor's own accent, like everything else in that colour.

	A phone is not that squeezed. The panel is gone, and what it was for, saying whose page this
	is, is done by a strip across the top in the same colour, which is also the link home. The
	form starts under it and is not centred in the height: a form in the middle of a phone's
	screen has the keyboard come up over it.

	Nothing a visitor types can make the page wider. A grid's column, and a flex item, is by
	default at least as wide as the longest thing in it that cannot be broken, and an email
	address cannot be: measured with a long one in the "check your inbox" panel, the form's
	column grew from 272px to 407px at a 320px window and the page scrolled sideways. So every
	box from the window down to the form is told that it may be narrower than what it holds
	(`minmax(0, 1fr)`, `min-w-0`), and what does not fit is cut short where it stands.

	When it is switched on, the readout is pinned to the foot of the window
	(src/lib/hud/Hud.svelte), over the form's column on a narrow window, so that column keeps clear
	of it. On a wide one the readout sits over the panel, and nothing needs to move.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<!-- The same mark as static/favicon.svg and the site header: two people, side by side. -->
{#snippet mark(size: number)}
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		width={size}
		height={size}
		fill="none"
		stroke="currentColor"
		stroke-width="2.25"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<circle cx="9" cy="8" r="4" />
		<path d="M2 21a7 7 0 0 1 14 0" />
		<path d="M16 4.13a4 4 0 0 1 0 7.75M22 21a7 7 0 0 0-4.5-6.53" />
	</svg>
{/snippet}

<div class="grid flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
	<div
		class="flex min-w-0 flex-col [:root[data-readout]_&]:pb-32 [:root[data-readout]_&]:sm:pb-24 [:root[data-readout]_&]:lg:pb-0"
	>
		<header
			class="flex h-14 shrink-0 items-center bg-brand px-6 text-brand-ink lg:h-20 lg:bg-transparent lg:px-10 lg:text-ink"
		>
			<a
				href={resolve('/team-collaborator')}
				class="flex items-center gap-2.5 font-display text-[0.9375rem] font-semibold tracking-tight"
			>
				<span
					class="grid size-7 place-items-center rounded-lg bg-white/20 lg:bg-brand lg:text-brand-ink"
				>
					{@render mark(16)}
				</span>
				Team Collaborator
			</a>
		</header>

		<div
			class="flex flex-1 justify-center px-6 pt-10 pb-10 lg:items-center lg:px-10 lg:pt-0 lg:pb-20"
		>
			<div class="w-full max-w-sm min-w-0">{@render children()}</div>
		</div>
	</div>

	<aside
		class="relative hidden overflow-hidden bg-brand px-16 text-brand-ink lg:flex lg:flex-col lg:justify-center xl:px-24"
	>
		<!-- Light from the top corner, so that the panel is not one flat sheet of colour. -->
		<div
			aria-hidden="true"
			class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,oklch(1_0_0/0.18),transparent_55%)]"
		></div>
		<div class="relative max-w-md">
			<span class="grid size-20 place-items-center rounded-3xl bg-white/15 ring-1 ring-white/25">
				{@render mark(44)}
			</span>
			<p class="mt-10 font-display text-5xl leading-[1.05] font-semibold tracking-tight">
				Team Collaborator
			</p>
			<p class="mt-6 text-xl leading-relaxed text-pretty">
				One place for the work your team does together. Sign in to pick up where you left off.
			</p>
		</div>
	</aside>
</div>
