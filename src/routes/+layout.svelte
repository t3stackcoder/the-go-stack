<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { settleEarlyRejections } from '#lib/browser-errors.js';
	import Hud from '#lib/hud/Hud.svelte';
	import { startMetrics } from '#lib/hud/metrics.svelte.js';
	import { chapters } from '#lib/site/chapters.js';
	import { markHydrated } from '#lib/stable/hydration.svelte.js';
	import ThemeSwitch from '#lib/theme/ThemeSwitch.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		markHydrated();
		startMetrics();
		settleEarlyRejections();
	});

	// Cross-fade between pages instead of a hard cut. Shallow navigations change no content, and
	// people who ask for reduced motion get the hard cut they asked for.
	onNavigate((navigation) => {
		if (navigation.shallow || !document.startViewTransition) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		// Staying on the same route only changes its query string (a search term, an answer on the
		// Verdict page). That is an update to the page in front of you, not a new page to fade to.
		if (navigation.from?.route.id === navigation.to?.route.id) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	const isCurrent = (path: string) =>
		page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
</script>

<!--
	The first thing a keyboard reaches: a way past the navigation that every page repeats. It is out
	of sight until it has focus, and then sits over the header, so showing it moves nothing.
-->
<a
	href="#content"
	class="sr-only rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30"
>
	Skip to content
</a>

<div class="flex min-h-dvh flex-col">
	<header class="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6">
			<a
				href={resolve('/')}
				class="shrink-0 font-display text-[0.9375rem] font-semibold tracking-tight"
			>
				The case for SvelteKit
			</a>
			<ThemeSwitch />
		</div>

		<!-- A plain scrolling strip rather than a menu: it needs no state, so it needs no script. -->
		<nav aria-label="Chapters" class="mx-auto max-w-6xl overflow-x-auto px-6">
			<ol class="flex h-10 items-center gap-5 text-sm whitespace-nowrap">
				{#each chapters as chapter (chapter.path)}
					<li>
						<a
							href={resolve(chapter.path)}
							aria-current={isCurrent(chapter.path) ? 'page' : undefined}
							class="flex items-baseline gap-1.5 text-ink-muted hover:text-ink aria-[current]:text-ink"
						>
							<span class="font-mono text-xs text-ink-subtle">{chapter.number}</span>
							{chapter.title}
						</a>
					</li>
				{/each}
			</ol>
		</nav>
	</header>

	<!-- Focusable from script only, so that following the skip link moves focus here as well as the view. -->
	<main id="content" tabindex="-1" class="flex-1 scroll-mt-24 outline-none">
		{@render children()}
	</main>

	<!-- The bottom padding keeps the last line clear of the pinned readout, which is taller on a phone. -->
	<footer class="border-t border-line pb-32 sm:pb-24">
		<p class="mx-auto max-w-6xl px-6 pt-8 text-sm text-ink-subtle">
			Built with SvelteKit, Svelte, Tailwind CSS and Inter. Every number on this site is measured in
			your browser, and every code sample is imported from the file that runs.
		</p>
	</footer>
</div>

<Hud />
