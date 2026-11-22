<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { settleEarlyRejections } from '#lib/browser-errors.js';
	import { keepTyped, putBackTyped } from '#lib/forms/typed.js';
	import Hud from '#lib/hud/Hud.svelte';
	import { startMetrics } from '#lib/hud/metrics.svelte.js';
	import { markHydrated } from '#lib/stable/hydration.svelte.js';
	import { WAIT_FLAG } from '#lib/stable/late.js';
	import { restoreScrollOnReload } from '#lib/stable/scroll.js';
	import AccentPicker from '#lib/theme/AccentPicker.svelte';
	import ThemeSwitch from '#lib/theme/ThemeSwitch.svelte';
	import { onNavigate, snapshot } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		markHydrated();
		startMetrics();
		settleEarlyRejections();
		restoreScrollOnReload();

		// A page come back to by Back or Forward is often the browser's own copy of it, as it
		// first arrived, and anything saved since is not on it. Measured in Chromium and Firefox:
		// a party added to a list, the site left by a full page load, Back pressed, and the party
		// was missing from the list 3 times of 3, though the server had it. So such a page asks
		// for its data again. The code that asks is fetched only then, and a reload that fails
		// leaves the page as it is.
		const [arrival] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
		if (arrival?.type === 'back_forward') {
			void import('#lib/forms/reload.svelte.js').then(({ reloadData }) => reloadData());
		}
	});

	// What a visitor has typed into a form is still there when they come back to the page, as it
	// would be in a browser left to itself. Registered here, once, so that no page with a form
	// can forget to (see src/lib/forms/typed.ts).
	snapshot({ id: 'typed', capture: keepTyped, restore: putBackTyped });

	// Cross-fade between pages instead of a hard cut. Shallow navigations change no content, and
	// people who ask for reduced motion get the hard cut they asked for.
	onNavigate((navigation) => {
		if (navigation.shallow || !document.startViewTransition) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		// Staying on the same route only changes its query string (a search term, an answer on the
		// Verdict page). That is an update to the page in front of you, not a new page to fade to.
		if (navigation.from?.route.id === navigation.to?.route.id) return;

		// Not in Safari's engine, which is every browser on an iPhone. Its test build, on
		// Windows, has broken on the cross-fade in two ways. A cross-fade away from a page that
		// fits in the window crashed the tab, 3 runs of 3. And once any cross-fade had run,
		// going Back to a page that loads data left the tab not answering: 22 tries of 50 across
		// five pages, and none of 15 with the cross-fade off. A visitor coming back to a form
		// found a page they could not type into. Real Safari has not been tried. Until it has,
		// a hard cut that works is the better of the two.
		if (navigator.vendor.startsWith('Apple')) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	// This page at the address that asks the server to wait for its slow data: its own, with the
	// flag added to whatever query it has.
	const whole = () =>
		`${page.url.pathname}${page.url.search ? `${page.url.search}&` : '?'}${WAIT_FLAG}=1`;
</script>

<!--
	A page that streams has late values still to come, and it takes JavaScript to put them on the
	page. A browser without it is sent on to the same address with a flag added, and for that
	address the server waits and sends the page whole (see src/lib/server/streaming.ts). With
	JavaScript the tag does nothing.

	A browser acts on the tag only once the response it came in has ended, which for a streamed
	page is when the last value has settled. Measured in three browsers: a page whose slowest
	value takes 3 s was whole after 6 s, the streamed response and then the one that waits. So the
	first such page costs a visitor without JavaScript both, and the time limit `streaming` is
	given bounds each of them.
-->
<svelte:head>
	{#if page.data.streams}
		<noscript><meta http-equiv="refresh" content="0; url={whole()}" /></noscript>
	{/if}
</svelte:head>

<!--
	The first thing a keyboard reaches: a way past the navigation that every page repeats. It is out
	of sight until it has focus, and then sits over the header, so showing it moves nothing.
-->
<a
	href="#content"
	class="sr-only rounded-lg bg-brand px-4 py-2 font-semibold text-brand-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30"
>
	Skip to content
</a>

<div class="flex min-h-dvh flex-col">
	<header class="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-6">
			<a
				href={resolve('/team-collaborator')}
				class="flex shrink-0 items-center gap-2.5 font-display text-[0.9375rem] font-semibold tracking-tight"
			>
				<!-- The same mark as static/favicon.svg: two people, side by side. -->
				<span class="grid size-7 place-items-center rounded-lg bg-brand text-brand-ink">
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						width="16"
						height="16"
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
				</span>
				<!--
					Out of sight, though still read out, on a window too narrow for it beside the
					controls: 369px, measured with the fallback font in WebKit, the widest of the three
					engines (Inter in Chromium needs 353px). Without that, a 320px phone scrolled sideways.
				-->
				<span class="max-[23.125rem]:sr-only">Team Collaborator</span>
			</a>
			<!--
				A fixed width, written out as what it holds: the theme switch (5.625rem + 2px), a gap of
				0.5rem and the accent button (2.125rem + 2px). Sized by its contents, it would be drawn
				narrower if the first paint came before the button had arrived, and the switch would
				then move left: the shift ThemeSwitch's own fixed width is there to prevent.
			-->
			<div class="flex w-[calc(8.25rem+4px)] shrink-0 items-center gap-2">
				<ThemeSwitch />
				<AccentPicker />
			</div>
		</div>
	</header>

	<!--
		Focusable from script only, so that following the skip link moves focus here as well as the
		view. The bottom padding keeps the last line clear of the pinned readout, taller on a phone.
	-->
	<main id="content" tabindex="-1" class="flex-1 scroll-mt-14 pb-32 outline-none sm:pb-24">
		{@render children()}
	</main>
</div>

<Hud />
