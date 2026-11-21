<!-- What the server recorded about each submission, including how it arrived. -->
<script lang="ts">
	import { MAX_LOG, type Submission } from './packing.js';

	let { log }: { log: Submission[] } = $props();

	// A fixed number of slots, keyed by position rather than by entry: each slot stays where it is
	// and only its text changes, so a new entry at the top cannot push the older ones down.
	const slots = $derived(Array.from({ length: MAX_LOG }, (_, index) => log.at(index)));

	const verbs = { add: 'Add', pack: 'Pack', unpack: 'Unpack', remove: 'Remove' } as const;
	const outcomes = {
		saved: { label: 'Saved', tone: 'text-good' },
		invalid: { label: 'Invalid', tone: 'text-warn' },
		refused: { label: 'Refused', tone: 'text-bad' }
	} as const;
</script>

<section aria-labelledby="submission-log-title">
	<h3 id="submission-log-title" class="font-display text-xl font-semibold tracking-tight">
		Server log
	</h3>
	<p class="mt-1 text-sm text-ink-muted">How each submission reached the server. Newest first.</p>

	<ol class="mt-4 divide-y divide-line rounded-xl border border-line">
		{#each slots as entry, index (index)}
			<li class="h-16 px-3.5 py-2.5 text-sm">
				{#if entry}
					<p class="flex gap-2">
						<span class="w-9 shrink-0 font-mono text-xs leading-5 text-ink-subtle tabular-nums">
							#{entry.seq}
						</span>
						<span class="truncate">
							{verbs[entry.action]}
							{entry.subject.trim() ? `“${entry.subject.trim()}”` : '(nothing)'}
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
						<span class={['font-medium', outcomes[entry.outcome].tone]}>
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
