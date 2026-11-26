<!--
	The billing page: the visitor's plan and where they pay for it, how much of each meter they
	have used, and a way to try the meter. Laid out as the account page is: on a wide window each
	section is a row, what it is on the left and its form on the right, and on a phone one under
	another, full width.

	Every form is a plain POST to its own action in +page.server.ts, so all of it works before the
	page has hydrated and without JavaScript. Upgrade and Manage billing are never sent in place:
	they leave the site for Polar either way, as the buttons that connect a provider do on the
	account page, and are left to the browser. What they were answered, when they did not leave,
	is the page. The meter's form is sent in place once hydrated (`saveForm`), and the page's data
	is loaded again after it, so the meter above shows the use.

	Nothing on the page moves, whatever is pressed. Every message has its line waiting for it: one
	under the field, two for each form's status, which hold the longest sentence that can be said
	there (#lib/billing/messages.ts). Each meter's bar is drawn at its full size from the start,
	and only what is filled in changes. It is a plain bar and not the progress component under
	src/lib/components/ui: that one would bring bits-ui to this page, and its classes are not
	among those the stylesheet is built from (src/routes/layout.css).
-->
<script lang="ts">
	import { GENERIC } from '#lib/auth/messages.js';
	import Submit from '#lib/forms/Submit.svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const use = saveForm({
		answer: () => (form?.action === 'use' ? form : undefined),
		after: 'keep',
		refusal: 'Not counted.'
	});

	const useRefused = $derived(use.answer?.refused ? use.answer : undefined);
	/** What the field offers first: what was last sent, refused or counted, as a page load forgets. */
	const units = $derived(useRefused ? useRefused.values.units : (use.answer?.units ?? '1'));

	interface Said {
		words: string;
		bad: boolean;
	}
	const QUIET: Said = { words: '', bad: false };

	/**
	 * What Upgrade or Manage billing was answered, when it did not leave the site: a refusal, or
	 * that there is nothing to manage yet. Sent the browser's own way, the answer is the page.
	 */
	const planSaid = $derived<Said>(
		form?.action === 'upgrade' || form?.action === 'manage'
			? { words: form.message ?? GENERIC, bad: form.refused === true }
			: QUIET
	);

	const AMOUNTS = ['1', '10', '100'] as const;

	/** The look of a button that is not the helper's: Submit's own, for a form left to the browser. */
	const SOLID_BUTTON =
		'h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink active:translate-y-px';
	const QUIET_BUTTON =
		'h-10 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:border-ink-subtle active:translate-y-px';
</script>

<svelte:head>
	<title>Billing · Team Collaborator</title>
</svelte:head>

{#snippet status(said: Said)}
	<!-- Always present, and two lines tall, which holds the longest thing it can say. -->
	<p role="status" class={['mt-3 h-10 text-sm', said.bad ? 'text-bad' : 'text-ink-muted']}>
		{said.words}
	</p>
{/snippet}

{#snippet heading(id: string, title: string, about: string)}
	<div>
		<h2 {id} class="font-display text-lg font-semibold tracking-tight">{title}</h2>
		<p class="mt-1 text-sm text-pretty text-ink-muted">{about}</p>
	</div>
{/snippet}

<div class="mx-auto max-w-4xl px-6 pt-10 sm:pt-14">
	<h1 class="font-display text-2xl font-semibold tracking-tight sm:text-4xl">Billing</h1>
	<p class="mt-2 text-ink-muted">Your plan, and how much of it you have used.</p>

	<section
		aria-labelledby="plan-title"
		class="mt-10 grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{#if data.subscribed}
			{@render heading('plan-title', 'Plan', "Invoices, and cancelling, are on Polar's pages.")}
			<div class="max-w-md">
				<p class="font-medium">Your subscription is active.</p>
				<p class="mt-1 mb-4 text-sm text-ink-muted">
					{#if data.periodEnd}
						This period ends <time datetime={data.periodEnd.iso}>{data.periodEnd.text}</time>.
					{:else}
						Polar has not said when this period ends.
					{/if}
				</p>
				<!-- Sent the browser's own way: it leaves the site for Polar. -->
				<form method="POST" action="?/manage">
					<button type="submit" class={[QUIET_BUTTON, 'w-full sm:w-auto']}>Manage billing</button>
				</form>
				{@render status(planSaid)}
			</div>
		{:else}
			{@render heading('plan-title', 'Plan', "You pay on Polar's page, and come back here.")}
			<div class="max-w-md">
				<p class="font-medium">You do not subscribe to a plan.</p>
				<p class="mt-1 mb-4 text-sm text-ink-muted">
					Upgrade for an allowance of API calls each period.
				</p>
				<!-- Sent the browser's own way: it leaves the site for Polar. -->
				<form method="POST" action="?/upgrade">
					<button type="submit" class={[SOLID_BUTTON, 'w-full sm:w-auto']}>Upgrade</button>
				</form>
				{@render status(planSaid)}
			</div>
		{/if}
	</section>

	{#if data.subscribed}
		<section
			aria-labelledby="usage-title"
			class="grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
		>
			{@render heading(
				'usage-title',
				'Usage',
				'What you have used this period, of the most you may use in it.'
			)}
			<ul class="max-w-md divide-y divide-line border-y border-line">
				{#each data.meters as meter (meter.key)}
					<li class="py-4">
						<div class="flex h-6 items-baseline justify-between gap-3">
							<p class="truncate font-medium">{meter.label}</p>
							<p class="shrink-0 text-sm text-ink-muted">
								{meter.limit === null
									? `${meter.used} used, with no limit`
									: `${meter.used} of ${meter.limit} used`}
							</p>
						</div>
						<!-- The words above say it all. The bar shows it, and is not read out. -->
						<div class="mt-2 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
							{#if meter.share !== null}
								<div class="h-full rounded-full bg-brand" style:width="{meter.share * 100}%"></div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section
		aria-labelledby="try-title"
		class="grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{@render heading(
			'try-title',
			'Try the meter',
			"Counts API calls by hand, to see the meter work. In a real product they are counted by the product's own API."
		)}
		<form method="POST" action="?/use" class="max-w-md" {@attach use.attach}>
			<label for="units" class="text-sm font-medium">How many to count</label>
			<!-- Its message's line is always there, as a Field's is (#lib/forms/Field.svelte). -->
			<select
				id="units"
				name="units"
				defaultValue={units}
				aria-invalid={useRefused?.errors.units ? 'true' : undefined}
				aria-describedby="units-error"
				class="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 aria-[invalid]:border-bad"
			>
				{#each AMOUNTS as amount (amount)}
					<option value={amount}>{amount}</option>
				{/each}
			</select>
			<p id="units-error" class="mt-1 h-5 truncate text-sm text-bad">
				{useRefused?.errors.units ?? ''}
			</p>
			<Submit label="Count" working="Counting" busy={use.busy} class="w-full sm:w-auto" />
			{@render status({ words: use.message, bad: use.failed })}
		</form>
	</section>
</div>
