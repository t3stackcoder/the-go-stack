<!--
	What the server made of each request it acted on: how it arrived, and what became of it. The
	page says what it sent, and this is the other side of the story. A request that only repeats
	one already saved is not acted on, and is not here (see src/lib/forms/server/once.ts).
-->
<script lang="ts">
	import { MAX_LEDGER, type Entry, type Tally } from './boat.js';

	let { ledger, tally }: { ledger: Entry[]; tally: Tally } = $props();

	// A fixed number of slots, keyed by position rather than by entry: each slot stays where it is
	// and only its text changes, so a new entry at the top cannot push the older ones down.
	const slots = $derived(Array.from({ length: MAX_LEDGER }, (_, index) => ledger.at(index)));

	const verbs = { add: 'Add', aboard: 'Aboard', ashore: 'Ashore', remove: 'Remove' } as const;
	// `short` is the heading over a count, where the longer words would not fit.
	const outcomes = {
		saved: { label: 'Saved', short: 'Saved', tone: 'text-good' },
		'turned-down': { label: 'Turned down', short: 'Turned down', tone: 'text-warn' },
		broke: { label: 'Broke', short: 'Broke', tone: 'text-bad' },
		abandoned: { label: 'Abandoned, unwritten', short: 'Abandoned', tone: 'text-ink-muted' }
	} as const;

	const totals = $derived(
		(['saved', 'turned-down', 'abandoned', 'broke'] as const).map((key) => ({
			key,
			label: outcomes[key].short,
			count: tally[key]
		}))
	);
</script>

<section aria-labelledby="ledger-title">
	<h3 id="ledger-title" class="font-display text-xl font-semibold tracking-tight">
		The server’s ledger
	</h3>
	<p class="mt-1 text-sm text-ink-muted">Every request it acted on. Newest first.</p>

	<!-- Two rows of two, each of fixed size: a count changing its width cannot move its neighbours. -->
	<dl class="mt-4 grid grid-cols-2 rounded-xl border border-line">
		{#each totals as total (total.key)}
			<div class="h-14 border-line px-3.5 py-2 odd:border-r nth-[-n+2]:border-b">
				<dt class="truncate text-[0.625rem] leading-4 tracking-wide text-ink-subtle uppercase">
					{total.label}
				</dt>
				<dd class="text-base leading-6 font-semibold tabular-nums">{total.count}</dd>
			</div>
		{/each}
	</dl>

	<ol class="mt-3 divide-y divide-line rounded-xl border border-line">
		{#each slots as entry, index (index)}
			<li class="h-16 px-3.5 py-2.5 text-sm">
				{#if entry}
					<p class="flex gap-2">
						<span class="w-9 shrink-0 font-mono text-xs leading-5 text-ink-subtle tabular-nums">
							#{entry.seq}
						</span>
						<span class="truncate">
							{verbs[entry.action]}
							{entry.subject.trim() ? `“${entry.subject.trim()}”` : '(no name)'}
						</span>
					</p>
					<p class="mt-1 flex gap-2 pl-11 text-xs leading-5">
						<span
							class={[
								'w-20 shrink-0 rounded-md px-1.5 font-medium',
								entry.via === 'enhanced'
									? 'bg-accent-soft text-accent-text'
									: 'bg-sunken text-ink ring-1 ring-line ring-inset'
							]}
						>
							{entry.via === 'enhanced' ? 'Enhanced' : 'Plain post'}
						</span>
						<span class={['truncate font-medium', outcomes[entry.outcome].tone]}>
							{outcomes[entry.outcome].label}
						</span>
					</p>
				{:else if index === 0}
					<p class="leading-11 text-ink-subtle">Nothing yet. Use the list.</p>
				{/if}
			</li>
		{/each}
	</ol>
</section>
