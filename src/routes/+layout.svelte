<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import AccountButton from '#lib/auth/AccountButton.svelte';
	import AdminButton from '#lib/auth/AdminButton.svelte';
	import { showMarker } from '#lib/auth/marker.js';
	import { settleEarlyRejections } from '#lib/browser-errors.js';
	import { keepTyped, putBackTyped } from '#lib/forms/typed.js';
	import Hud from '#lib/hud/Hud.svelte';
	import { markHydrated } from '#lib/stable/hydration.svelte.js';
	import { WAIT_FLAG } from '#lib/stable/late.js';
	import { restoreScrollOnReload } from '#lib/stable/scroll.js';
	import AccentPicker from '#lib/theme/AccentPicker.svelte';
	import ThemeSwitch from '#lib/theme/ThemeSwitch.svelte';
	import { afterNavigate, onNavigate, snapshot } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		markHydrated();
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

	// The header's account control goes by `data-signed-in` on <html>, which the boot script in
	// app.html sets from the marker cookie when a page loads. A move within the site loads no
	// page, and may be the very one that signed the visitor in, so the cookie is read again
	// after each. The two readings must agree: see src/lib/auth/marker.ts.
	afterNavigate(({ type }) => {
		if (type !== 'enter') showMarker();
	});

	// The pages that sign a visitor in fill the window themselves, with no header over them
	// (src/routes/(auth)/+layout.svelte).
	const bare = $derived(page.route.id?.startsWith('/(auth)') ?? false);

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
	{#if !bare}
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
					three controls. It needs 413px, measured with the fallback font in WebKit, the
					widest of the three engines where the window keeps no room for a scrollbar, which
					is every phone (Inter needs 396px there). Chromium on a desktop keeps 15px for
					one and needs 418px. So the name shows from 420px, and under that a 320px phone
					does not scroll sideways. An administrator's header has the admin button too,
					2.125rem + 2px and a gap of 0.5rem more (44px), so for them the name shows from
					464px, the same margin over the 457px it then needs. That figure is the sum, and
					has not been measured as the first one was.
				-->
					<span class="max-[26.25rem]:sr-only [:root[data-admin]_&]:max-[29rem]:sr-only"
						>Team Collaborator</span
					>
				</a>
				<!--
				A fixed width, written out as what it holds: the theme switch (5.625rem + 2px), the
				accent button and the account control (2.125rem + 2px each), and two gaps of 0.5rem.
				Sized by its contents, it would be drawn narrower if the first paint came before the
				buttons had arrived, and the switch would then move left: the shift ThemeSwitch's own
				fixed width is there to prevent. The account control is one size whoever is looking,
				so the sum is the same signed in and signed out.

				For an administrator it holds the admin button as well, and a third gap. Which header
				it is is settled by the boot script before the first frame, as the button itself is
				(src/lib/auth/AdminButton.svelte), so the wider width is never seen arriving either.
			-->
				<div
					class="flex w-[calc(10.875rem+6px)] shrink-0 items-center gap-2 [:root[data-admin]_&]:w-[calc(13.5rem+8px)]"
				>
					<ThemeSwitch />
					<AccentPicker />
					<AdminButton />
					<AccountButton />
				</div>
			</div>
		</header>
	{/if}

	<!--
		Focusable from script only, so that following the skip link moves focus here as well as the
		view. While the readout is switched on, the bottom padding keeps the last line clear of it,
		as it is taller on a phone. Gone with the readout, by the same attribute and so before the
		first frame. The pages with no header fill the window edge to edge, and keep clear of the
		readout themselves.
	-->
	<main
		id="content"
		tabindex="-1"
		class={[
			'flex-1 scroll-mt-14 outline-none',
			!bare && '[:root[data-readout]_&]:pb-32 [:root[data-readout]_&]:sm:pb-24',
			bare && 'flex flex-col'
		]}
	>
		{@render children()}
	</main>
</div>

<!--
	The readout, rendered with every page so that for someone who has switched it on it is on
	screen at first paint. For everybody else it is hidden, by CSS (see src/lib/hud/Hud.svelte).
-->
<Hud />
