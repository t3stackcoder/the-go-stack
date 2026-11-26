<script lang="ts">
	import { type Outcome, questions } from '#lib/demo/verdict/decide.js';
	import { addressForm } from '#lib/forms/address-form.js';
	import Chapter from '#lib/ui/Chapter.svelte';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const answered = $derived(Object.keys(data.answers).length);

	// What is ticked belongs to the form, as it does with JavaScript switched off. The address
	// gives each radio its default (`defaultChecked` in the template) and the browser keeps what
	// the visitor ticks, so an answer given while the page was still loading survives hydration.
	// `addressForm` settles the moments when the form and the address disagree (Start again, Back,
	// an answer ticked before hydration).
	let form: HTMLFormElement;
	addressForm(
		() => form,
		(ticked) => questions.every(({ id }) => (ticked.get(id) ?? undefined) === data.answers[id])
	);

	const outcomes: Record<Outcome, { title: string; summary: string; next: string; tone: string }> =
		{
			yes: {
				title: 'Yes. Use it.',
				summary: 'Nothing in your answers argues against it, and several things argue for it.',
				next: 'Build one real page of your product with it this week, and hold it to the readout at the bottom of this screen.',
				tone: 'text-good'
			},
			cautious: {
				title: 'Yes, with your eyes open.',
				summary: 'It fits, but there are costs you should plan for rather than discover.',
				next: 'Run a time-boxed trial on one self-contained part of the product, and decide on the evidence.',
				tone: 'text-warn'
			},
			no: {
				title: 'Probably not.',
				summary:
					'In your situation the costs outweigh what you would gain. That is a perfectly good outcome: the right tool is the one that fits.',
				next: 'Stay with what you have. If the costs listed here change, ask again.',
				tone: 'text-bad'
			}
		};

	const outcome = $derived(data.verdict && outcomes[data.verdict.outcome]);
</script>

<Chapter
	path="/verdict"
	lede="Six questions about your project. The answer is not always yes, and the reasons are given either way."
>
	<!--
		A plain GET form: the answers live in the address, and the verdict is worked out on the
		server. With JavaScript it re-submits on every change, as a navigation that keeps your
		scroll position and focus and replaces the history entry instead of adding one.
	-->
	<form
		bind:this={form}
		method="GET"
		data-sveltekit-reset="false"
		data-sveltekit-replacestate
		class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]"
	>
		<div class="space-y-10">
			{#each questions as question, index (question.id)}
				<fieldset>
					<legend class="font-display text-xl font-semibold tracking-tight">
						<span class="mr-2 font-mono text-sm font-normal text-ink-subtle">0{index + 1}</span>
						{question.prompt}
					</legend>
					<div class="mt-4 space-y-2">
						{#each question.options as option (option.value)}
							<!-- The selected look comes from `:checked` in CSS, so it is right before hydration. -->
							<label
								class="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-4 hover:border-line-strong has-checked:border-brand has-checked:bg-brand-soft"
							>
								<input
									type="radio"
									name={question.id}
									value={option.value}
									defaultChecked={data.answers[question.id] === option.value}
									onchange={(event) => event.currentTarget.form?.requestSubmit()}
									class="mt-1 size-4 shrink-0 accent-brand"
								/>
								<span>{option.label}</span>
							</label>
						{/each}
					</div>
				</fieldset>
			{/each}

			<noscript>
				<button
					type="submit"
					class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink"
				>
					Show my verdict
				</button>
			</noscript>
		</div>

		<aside
			aria-live="polite"
			aria-label="Your verdict"
			class="min-h-112 rounded-2xl border border-line bg-surface p-6 lg:sticky lg:top-28"
		>
			{#if data.verdict && outcome}
				<p class="font-mono text-sm text-ink-subtle">Your verdict</p>
				<h2 class={['mt-2 font-display text-3xl font-semibold tracking-tight', outcome.tone]}>
					{outcome.title}
				</h2>
				<p class="mt-3 text-ink-muted">{outcome.summary}</p>

				{#if data.verdict.reasonsFor.length}
					<h3 class="mt-6 text-sm font-semibold">In its favour</h3>
					<ul class="mt-2 space-y-2 text-sm text-ink-muted">
						{#each data.verdict.reasonsFor as reason (reason)}
							<li class="flex gap-2.5">
								<span class="mt-2 size-1.5 shrink-0 rounded-full bg-good" aria-hidden="true"></span>
								{reason}
							</li>
						{/each}
					</ul>
				{/if}

				{#if data.verdict.reasonsAgainst.length}
					<h3 class="mt-6 text-sm font-semibold">Against it</h3>
					<ul class="mt-2 space-y-2 text-sm text-ink-muted">
						{#each data.verdict.reasonsAgainst as reason (reason)}
							<li class="flex gap-2.5">
								<span class="mt-2 size-1.5 shrink-0 rounded-full bg-bad" aria-hidden="true"></span>
								{reason}
							</li>
						{/each}
					</ul>
				{/if}

				<h3 class="mt-6 text-sm font-semibold">What to do next</h3>
				<p class="mt-2 text-sm text-ink-muted">{outcome.next}</p>

				<p class="mt-6 border-t border-line pt-4 text-sm text-ink-subtle">
					This verdict is in the address of this page. Send the link to whoever decides with you.
					<a href={resolve('/verdict')} class="text-brand-text underline underline-offset-2">
						Start again
					</a>
				</p>
			{:else}
				<p class="font-mono text-sm text-ink-subtle">Your verdict</p>
				<p class="mt-2 font-display text-3xl font-semibold tracking-tight tabular-nums">
					{answered} of {questions.length} answered
				</p>
				<div class="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken">
					<!-- Scaled rather than resized, so the bar animates without any layout work. -->
					<div
						class="h-full origin-left rounded-full bg-brand transition-transform duration-300"
						style:transform="scaleX({answered / questions.length})"
					></div>
				</div>
				<p class="mt-6 text-ink-muted">
					Answer every question and the verdict appears here, with the reasons for and against.
				</p>
				<p class="mt-3 text-sm text-ink-subtle">
					It is worked out on the server from the address of this page, so it works with JavaScript
					switched off, and the link can be shared.
				</p>
			{/if}
		</aside>
	</form>

	<section class="prose">
		<h2>And my own answer</h2>
		<p>
			For a web product built by a team that controls its own interface: yes. It is a short, direct
			route from an idea to a page that is server-rendered, fast, and fully interactive, and it asks
			for very little machinery to get there. This site is the evidence. It was built in a single
			sitting.
		</p>
		<p>
			The price is a smaller ecosystem and a framework that is still changing. If either of those
			decides things for you, <a href={resolve('/tradeoffs')}>chapter 06</a> was written for you,
			and you should believe it.
		</p>
		<p>
			If you are still undecided, do not take this site's word for it. Take one real page from your
			own product, build it here, and measure it. That will tell you more than any argument.
		</p>
	</section>

	<p>
		<a
			href={resolve('/rendering')}
			class="inline-block rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium hover:border-line-strong"
		>
			← Back to the beginning
		</a>
	</p>
</Chapter>
