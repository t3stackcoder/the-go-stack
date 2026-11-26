<!--
	Chooses how the server behaves. Each choice is a link to this page at another address
	(`?server=slow`), so it needs no script, and the choice is in the address where a reload, a
	bookmark and the forms' own posts all find it.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { MOODS, type Mood } from './boat.js';

	let { mood }: { mood: Mood } = $props();

	const moods = Object.entries(MOODS) as [Mood, (typeof MOODS)[Mood]][];
</script>

<nav aria-labelledby="server-mood-title">
	<h3 id="server-mood-title" class="text-sm font-medium">The server</h3>

	<!--
		A grid of equal columns: a choice is as wide as its share of the row, whatever it says, so
		choosing another cannot change the size of any of them.
	-->
	<ul
		class="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-line bg-sunken p-1 sm:grid-cols-5"
	>
		{#each moods as [key, { label }] (key)}
			<li class="last:max-sm:col-span-2">
				<!--
					The fragment brings a browser that loads the link whole back to the demo, and not to
					the top of the page. With script, `reset={false}` keeps focus and scroll where they
					are, and `replacestate` keeps each choice from adding to Back's list.
				-->
				<a
					href="{resolve('/forms')}{key === 'prompt' ? '' : `?server=${key}`}#bench"
					aria-current={key === mood ? 'true' : undefined}
					data-sveltekit-reset={false}
					data-sveltekit-replacestate
					class="grid h-9 place-items-center rounded-lg px-2 text-center text-sm text-ink-muted hover:text-ink aria-[current]:bg-surface aria-[current]:font-medium aria-[current]:text-ink aria-[current]:shadow-[0_0_0_1px_var(--color-line)]"
				>
					{label}
				</a>
			</li>
		{/each}
	</ul>

	<!-- Two lines until the page is wide, one from there up: room for the longest, so none moves the list. -->
	<p class="mt-2 h-10 text-sm text-ink-muted lg:h-5">{MOODS[mood].does}</p>
</nav>
