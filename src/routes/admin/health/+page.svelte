<!--
	The health check: every service in compose.yaml, how it is, and Start and Stop beside it.

	The page arrives at once, and the list follows when Docker has answered, which takes a second
	or more (./+page.server.ts). Until then it shows the list's outline, with a spinner saying
	what it is waiting for. It is not a `Streamed` box, which reserves its height before its
	content exists: how many services there are is not known until Docker says. The list is the
	last thing on the page, so however long it turns out to be, its arriving moves nothing.

	Once a list is on show it stays on show. After a Start or a Stop the page's data is loaded
	again, and the list it had is kept, dimmed, with "Checking again" beside the count, until
	Docker's new answer replaces it. Blanked instead, it would go back to its outline for a second
	or more after every press, though most of it had not changed.

	Each service's buttons are plain forms, sent the browser's own way without JavaScript and in
	place with it (`saveForm`). Only the one that makes sense is offered: Start for a service that
	is stopped, Stop for one that is running. The other is shown, and disabled, so that the two
	stay where they are whichever the service is. The database has no Stop, and says why.

	What Docker says about a start or stop that failed is shown in full under the list: it is what
	names the port that is taken or the image that could not be fetched. It is under the list, and
	not above it, so that however long it is, it moves nothing the administrator is looking at.
-->
<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { untrack } from 'svelte';
	import Submit from '#lib/forms/Submit.svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** What Docker's answer comes to, once it has come. */
	type Arrived = Extract<(typeof data)['listing'], { late: 'arrived' }>['value'];

	/**
	 * What the page can show of a listing: Docker's answer, `failed` when there was none in time,
	 * or nothing yet. It is settled already for a visitor without JavaScript, whom the server
	 * waited for (src/lib/server/streaming.ts), and a promise for everyone else.
	 */
	const outcomeOf = (late: (typeof data)['listing']): Arrived | 'failed' | undefined =>
		late instanceof Promise ? undefined : late.late === 'arrived' ? late.value : 'failed';

	/** The listing on show: the latest that has arrived. */
	let shown = $state.raw(untrack(() => outcomeOf(data.listing)));
	/** Whether a newer listing than the one on show is on its way. */
	let checking = $state(untrack(() => data.listing instanceof Promise));

	$effect(() => {
		const next = data.listing;
		untrack(() => {
			if (!(next instanceof Promise)) {
				shown = outcomeOf(next);
				checking = false;
				return;
			}
			checking = true;
			const settle = (outcome: Arrived | 'failed') => {
				// The data has been loaded again since this was asked for, and this answer is old.
				if (next !== data.listing) return;
				shown = outcome;
				checking = false;
			};
			next.then(settle, () => settle('failed'));
		});
	});

	/**
	 * The services whose form is on its way, by name, so that the button pressed is the one seen
	 * to wait. Plain objects, as on the account page, for the reason it gives.
	 */
	const starting = $state<Record<string, true>>({});
	const stopping = $state<Record<string, true>>({});

	/** Which of the two was sent last, for the one status line they share. */
	let last = $state<'start' | 'stop'>(untrack(() => (form?.action === 'stop' ? 'stop' : 'start')));

	const marking = (kind: 'start' | 'stop', busy: Record<string, true>) => (fields: FormData) => {
		last = kind;
		const name = String(fields.get('service'));
		busy[name] = true;
		return () => {
			delete busy[name];
		};
	};

	// A start waits for the service to pass its health check, which is a few seconds when all is
	// well, and Compose gives a container ten seconds to stop. So neither is called slow until
	// it is well past that, and each waits for longer than the server will (src/lib/server/services.ts).
	const start = saveForm({
		answer: () => (form?.action === 'start' ? form : undefined),
		after: 'keep',
		refusal: 'Not started.',
		slow: 15_000,
		limit: 90_000,
		sending: marking('start', starting)
	});
	const stop = saveForm({
		answer: () => (form?.action === 'stop' ? form : undefined),
		after: 'keep',
		refusal: 'Not stopped.',
		slow: 15_000,
		limit: 40_000,
		sending: marking('stop', stopping)
	});

	const latest = $derived(last === 'start' ? start : stop);
	/** What the line says: the helper's news, or once it is done, what was done. */
	const said = $derived.by(() => {
		if (latest.message) return { words: latest.message, bad: latest.failed };
		const answer = latest.answer;
		if (!latest.busy && answer && 'said' in answer) return { words: answer.said, bad: false };
		return { words: '', bad: false };
	});

	const LOOK = {
		healthy: { label: 'Healthy', dot: 'bg-good', text: 'text-good' },
		starting: { label: 'Starting', dot: 'bg-warn', text: 'text-warn' },
		unhealthy: { label: 'Unhealthy', dot: 'bg-bad', text: 'text-bad' },
		stopped: { label: 'Stopped', dot: 'bg-bad', text: 'text-bad' }
	} as const;

	const services = $derived(shown && shown !== 'failed' && shown.ok ? shown.services : []);
	const healthy = $derived(services.filter((service) => service.condition === 'healthy').length);

	/**
	 * The rows of the outline shown while Docker is asked: as many as SERVICE_COUNT says
	 * compose.yaml has (src/env.ts), or none when it is not set. Nothing here can know the number
	 * sooner: asking Docker is the wait the outline stands in for.
	 */
	const outlineRows = $derived(Array.from({ length: data.serviceCount ?? 0 }, (_, row) => row));
	/** Whether SERVICE_COUNT is set and Docker lists a different number of services. */
	const miscounted = $derived(
		data.serviceCount !== undefined && services.length > 0 && data.serviceCount !== services.length
	);

	/** A row of the list, and of its outline, which must match it. */
	const ROW =
		'grid grid-cols-1 items-center gap-x-4 gap-y-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]';

	/**
	 * The look of a button that cannot be pressed: Submit's quiet one, faded.
	 *
	 * Every button in a row is 8rem wide, pressable or not, so that the columns line up whatever
	 * each service has. A Submit keeps both its labels in one cell, so the width has to hold the
	 * longer: "Stopping" and its spinner need 83px. At 6rem the padding left 64px for them, the
	 * cell ran out past the button's right edge, and "Stop" sat 10.5px right of centre. 8rem
	 * leaves 96px.
	 */
	const UNAVAILABLE =
		'h-10 w-32 cursor-not-allowed rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-subtle';
</script>

<svelte:head>
	<title>Health check · Admin · Team Collaborator</title>
</svelte:head>

{#snippet outline()}
	<div aria-busy="true">
		<p role="status" class="mt-8 flex h-5 items-center gap-2 text-sm text-ink-muted">
			<LoaderCircle size={14} class="animate-spin text-brand-text" aria-hidden="true" />
			Asking Docker how each service is
		</p>
		{#if outlineRows.length}
			<ul aria-hidden="true" class="mt-2 divide-y divide-line border-y border-line">
				{#each outlineRows as row (row)}
					<li class={ROW}>
						<div>
							<p class="flex h-6 items-center gap-2">
								<span class="skeleton size-2.5 rounded-full"></span>
								<span class="skeleton h-3 w-24"></span>
							</p>
							<p class="mt-1 flex h-5 items-center">
								<span class="skeleton h-2.5 w-52 max-w-full"></span>
							</p>
						</div>
						<div class="flex gap-2">
							<span class="skeleton h-10 w-32"></span>
							<span class="skeleton h-10 w-32"></span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/snippet}

<div class="mx-auto max-w-4xl px-6 pt-10 sm:pt-14">
	<a
		href={resolve('/admin')}
		class="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
	>
		<ArrowLeft size={14} aria-hidden="true" />
		Admin
	</a>

	<div class="mt-3 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="font-display text-2xl font-semibold tracking-tight sm:text-4xl">Health check</h1>
			<p class="mt-2 text-ink-muted">The services in compose.yaml, as Docker reports them.</p>
		</div>
		<!--
			A whole page load, with JavaScript or without: a link to the page it is on would
			otherwise be taken as a move to where the visitor already is, and ask for nothing new.
		-->
		<a
			href={resolve('/admin/health')}
			data-sveltekit-reload
			class="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:border-ink-subtle"
		>
			<RefreshCw size={14} aria-hidden="true" />
			Refresh
		</a>
	</div>

	{#if shown === undefined}
		{@render outline()}
	{:else if shown === 'failed'}
		<div role="alert" class="mt-8 rounded-xl border border-bad bg-surface p-4">
			<p class="font-medium text-bad">Docker did not answer in time.</p>
			<p class="mt-2 text-sm text-ink-muted">
				Refresh to ask again. If it keeps happening, check that Docker Desktop is running.
			</p>
		</div>
	{:else if !shown.ok}
		<div role="alert" class="mt-8 rounded-xl border border-bad bg-surface p-4">
			<p class="font-medium text-bad">{shown.problem.summary}</p>
			<pre
				class="mt-2 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-ink-muted"
			>{shown.problem.detail}</pre>
		</div>
	{:else}
		<p class="mt-8 flex h-5 items-center gap-2 text-sm">
			<span class="font-medium">{healthy} of {services.length} healthy</span>
			<span aria-hidden="true" class="text-ink-subtle">·</span>
			{#if checking}
				<span class="flex items-center gap-1.5 text-ink-muted">
					<LoaderCircle size={13} class="animate-spin" aria-hidden="true" />
					Checking again
				</span>
			{:else}
				<span class="text-ink-muted">Checked <time>{shown.checkedAt}</time> UTC</span>
			{/if}
		</p>

		<ul
			aria-busy={checking}
			class={[
				'mt-2 divide-y divide-line border-y border-line transition-opacity',
				checking && 'opacity-60'
			]}
		>
			{#each services as service (service.name)}
				{@const look = LOOK[service.condition]}
				{@const note = service.stopWithheld ? `withheld-${service.name}` : undefined}
				<li class={ROW}>
					<div class="min-w-0">
						<p class="flex flex-wrap items-center gap-x-2 font-medium">
							<span class={['size-2.5 shrink-0 rounded-full', look.dot]} aria-hidden="true"></span>
							{service.name}
							<span class={['text-sm', look.text]}>{look.label}</span>
						</p>
						<p class="mt-1 text-sm text-ink-muted">
							<!-- One expression, so the formatter cannot move the space around the dot. -->
							{[service.status, service.ports.join(', ')].filter(Boolean).join(' · ')}
						</p>
						{#if note}
							<p id={note} class="mt-1 text-sm text-pretty text-ink-subtle">
								{service.stopWithheld}
							</p>
						{/if}
					</div>

					<div class="flex gap-2">
						{#if data.mayControl && service.canStart}
							<form method="POST" action="?/start" {@attach start.attach}>
								<input type="hidden" name="service" value={service.name} />
								<Submit
									label="Start"
									working="Starting"
									busy={starting[service.name] === true}
									variant="quiet"
									aria-label="Start {service.name}"
									class="w-32"
								/>
							</form>
						{:else}
							<button type="button" disabled class={UNAVAILABLE}>Start</button>
						{/if}

						{#if data.mayControl && service.canStop}
							<form method="POST" action="?/stop" {@attach stop.attach}>
								<input type="hidden" name="service" value={service.name} />
								<Submit
									label="Stop"
									working="Stopping"
									busy={stopping[service.name] === true}
									variant="danger"
									aria-label="Stop {service.name}"
									class="w-32"
								/>
							</form>
						{:else}
							<button type="button" disabled aria-describedby={note} class={UNAVAILABLE}>
								Stop
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		{#if !data.mayControl}
			<p class="mt-3 text-sm text-ink-muted">
				Your role can see the services, but not start or stop them.
			</p>
		{/if}

		{#if miscounted}
			<p class="mt-3 text-sm text-warn">
				SERVICE_COUNT is {data.serviceCount}, but Docker lists {services.length}. Update it in .env
				so that the outline shown while this page loads matches.
			</p>
		{/if}

		<!-- Always present, so that what it comes to say moves nothing above it. -->
		<p
			role="status"
			class={[
				'mt-4 min-h-10 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap',
				said.bad ? 'text-bad' : 'text-ink-muted'
			]}
		>
			{said.words}
		</p>
	{/if}
</div>
