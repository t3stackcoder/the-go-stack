<!--
	The passenger list. Every control is a plain HTML form that posts to an action in
	routes/forms/+page.server.ts, and works with no JavaScript at all. Once the page has hydrated,
	`saveForm` upgrades the same forms in place: there is no second version for when script runs.

	The two fields take what the server sends back as their defaults (`defaultValue`), not as their
	values. Hydration then leaves alone whatever the visitor typed while the page was still loading.
-->
<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import ClientOnly from '#lib/stable/ClientOnly.svelte';
	import type { ActionData } from '../../../routes/forms/$types';
	import {
		MAX_NAME,
		MAX_PARTY,
		type Mood,
		type Party,
		refuseWithout,
		SEATS,
		seatsTaken,
		type Tally
	} from './boat.js';

	let {
		parties,
		tally,
		mood,
		form
	}: { parties: Party[]; tally: Tally; mood: Mood; form: ActionData } = $props();

	const uid = $props.id();
	let nameInput: HTMLInputElement;
	let rowList = $state<HTMLElement>();

	// What the visitor has asked for and the server has not yet answered, laid over the server's
	// data. When the answer arrives the overlay is removed and the server's version is what remains,
	// so a refusal rolls itself back: there is no undo code to write.
	const boarding = new SvelteMap<number, boolean>();
	const leaving = new SvelteSet<number>();
	const shown = $derived(
		parties
			.filter((party) => !leaving.has(party.id))
			.map((party) => ({ ...party, aboard: boarding.get(party.id) ?? party.aboard }))
	);
	const taken = $derived(seatsTaken(shown));

	// The server's mood travels with every form, beside the action's name. A form posts to its own
	// address and not to the page's, so the page's query has to be said again.
	const server = $derived(mood === 'prompt' ? '' : `&server=${mood}`);

	// The form that adds a party. It is sent once at a time, and emptied for the next party once
	// the server has taken this one. After a refusal, focus goes to the field that was turned down.
	const add = saveForm({
		answer: () => (form?.action === 'add' ? form : undefined),
		// The server writes down every request, the ones it turns down included, so the ledger
		// beside the list is out of date after a refusal as well as after a save.
		reload: 'always',
		sending: () => {
			run = undefined;
		},
		// On to the next party, unless the visitor has already gone somewhere else. Without
		// scrolling: if they have moved down the page to read, that is where they stay.
		saved: (_form, stayed) => {
			if (stayed) nameInput.focus({ preventScroll: true });
		}
	});

	// The two forms on every row: the tick and the cross. Each row's forms are sent and answered
	// on their own. A second press of a tick takes the place of the first: the first is left to
	// finish, what it is answered is not shown, and the newest press is sent when it has.
	const rows = saveForm({
		answer: () => (form?.action === 'aboard' || form?.action === 'remove' ? form : undefined),
		again: 'replace',
		reload: 'always',
		sending: (fields, formElement) => {
			if (!hammering) run = undefined;

			const id = Number(fields.get('id'));
			const wanted = fields.get('aboard');

			if (wanted !== null) {
				boarding.set(id, wanted === 'true');
				return () => boarding.delete(id);
			}

			// This row and its button are about to disappear. Keep keyboard focus on the list.
			if (formElement.contains(document.activeElement)) {
				const row = formElement.closest('li');
				const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
				(neighbour?.querySelector<HTMLElement>('[data-remove]') ?? nameInput).focus();
			}
			leaving.add(id);
			return () => leaving.delete(id);
		}
	});

	// The row the server would not change. Not while that row has a request in flight, so a
	// repeat refusal plays its animation again.
	const refused = $derived.by(() => {
		if (!rows.failed || !rows.answer) return undefined;
		const id = Number(rows.answer.values.id);
		return boarding.has(id) || leaving.has(id) ? undefined : id;
	});

	// A row leaves the page the moment its cross is pressed, and the row below moves up under
	// the pointer. Measured before this: a double-click on one cross removed two rows, the second
	// click landing on the row that had taken its place. So the second click of a double-click
	// does nothing. Nor does a key held down, whose repeats would follow focus down the list.
	const once = (event: MouseEvent | KeyboardEvent) => {
		if (event instanceof KeyboardEvent ? event.repeat : event.detail > 1) event.preventDefault();
	};

	// The hammer: every tick but the skipper's, pressed seven times at uneven gaps, all the rows
	// at once. An odd number, so each row should end the other way up from where it began. What
	// the server made of it is read from its own tally, before and after.
	const PRESSES = 7;
	let hammering = $state(false);
	let run = $state.raw<{ presses: number; rows: number; before: Tally }>();

	const requests = (count: Tally) =>
		count.saved + count['turned-down'] + count.broke + count.abandoned;
	const heard = $derived(
		run && {
			reached: requests(tally) - requests(run.before),
			saved: tally.saved - run.before.saved,
			abandoned: tally.abandoned - run.before.abandoned
		}
	);

	function hammer() {
		const ticks = Array.from(rowList?.querySelectorAll<HTMLFormElement>('form[data-hammer]') ?? []);
		if (hammering || rows.busy || mood === 'broken' || ticks.length === 0) return;

		run = { presses: ticks.length * PRESSES, rows: ticks.length, before: { ...tally } };
		hammering = true;

		let last = 0;
		for (const tick of ticks) {
			let at = 0;
			for (let press = 0; press < PRESSES; press += 1) {
				at += 20 + Math.random() * 100;
				// From the prototype. Called on the form itself, a field named `requestSubmit` would
				// be found in place of the method.
				setTimeout(() => HTMLFormElement.prototype.requestSubmit.call(tick), at);
			}
			last = Math.max(last, at);
		}
		setTimeout(() => (hammering = false), last);
	}
</script>

<!-- Every form's action ends here, so a browser that loads the answer whole lands on the list. -->
<section id="passengers" aria-labelledby="{uid}-title" class="scroll-mt-28">
	<h3 id="{uid}-title" class="font-display text-xl font-semibold tracking-tight">
		The boat to the island
	</h3>
	<p class="mt-1 text-sm text-ink-muted tabular-nums">{taken} of {SEATS} seats taken</p>
	<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
		<div
			class="h-full origin-left rounded-full bg-brand transition-transform duration-300"
			style:transform="scaleX({taken / SEATS})"
		></div>
	</div>

	<form
		method="POST"
		action="?/add{server}#passengers"
		{@attach add.attach}
		class="mt-6 grid grid-cols-[7rem_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]"
	>
		<div class="col-span-2 sm:col-span-1">
			<label for="{uid}-name" class="text-sm font-medium">Name of the party</label>
			<input
				bind:this={nameInput}
				id="{uid}-name"
				name="name"
				defaultValue={add.answer?.values.name ?? ''}
				required
				maxlength={MAX_NAME}
				autocomplete="off"
				placeholder="Marchetti"
				aria-invalid={add.answer?.errors.name ? 'true' : undefined}
				aria-describedby="{uid}-name-error"
				class="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 placeholder:text-ink-subtle aria-[invalid]:border-bad"
			/>
			<!-- Always present and one line tall, so a message appearing here cannot move anything. -->
			<p id="{uid}-name-error" class="mt-1 h-5 text-sm whitespace-nowrap text-bad">
				{add.answer?.errors.name ?? ''}
			</p>
		</div>

		<div>
			<label for="{uid}-seats" class="text-sm font-medium">Seats</label>
			<input
				id="{uid}-seats"
				name="seats"
				type="number"
				inputmode="numeric"
				defaultValue={add.answer?.values.seats ?? '1'}
				required
				min="1"
				max={MAX_PARTY}
				aria-invalid={add.answer?.errors.seats ? 'true' : undefined}
				aria-describedby="{uid}-seats-error"
				class="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 tabular-nums aria-[invalid]:border-bad"
			/>
			<p id="{uid}-seats-error" class="mt-1 h-5 text-sm whitespace-nowrap text-bad">
				{add.answer?.errors.seats ?? ''}
			</p>
		</div>

		<!-- Both labels share one grid cell, so the button is as wide as the longer one throughout. -->
		<button
			type="submit"
			aria-disabled={add.busy}
			class="mt-6.5 grid h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink aria-disabled:cursor-progress"
		>
			<span class={['self-center [grid-area:1/1]', add.busy && 'invisible']}>Add to the list</span>
			<span
				class={['flex items-center justify-center gap-2 [grid-area:1/1]', !add.busy && 'invisible']}
			>
				<!-- Spins only while visible: a hidden spinner would still be working, and moving. -->
				<span
					class={[
						'size-3.5 rounded-full border-2 border-current border-t-transparent',
						add.busy && 'animate-spin'
					]}
					aria-hidden="true"
				></span>
				Adding
			</span>
		</button>

		<!--
			What became of the form as a whole: that it is slow, that it could not be sent, that no
			answer came. Always present, and two lines tall, which holds the longest of them.
		-->
		<p
			role="status"
			class={['col-span-full h-10 text-sm', add.failed ? 'text-bad' : 'text-ink-muted']}
		>
			{add.message}
		</p>
	</form>

	<!--
		What became of the last tick or removal: the server's refusal, or a request that failed.
		Above the list and not under it, where it once was. Measured there, without JavaScript: the
		page that answered a refused tick landed on the list with this line below the foot of the
		window, and the visitor was shown a list that had not changed and no reason why.
	-->
	<p role="status" class={['h-10 text-sm', rows.failed ? 'text-bad' : 'text-ink-muted']}>
		{rows.message}
	</p>

	<!--
		A fixed height that holds a full boat, so adding or removing a row never moves what is
		below it. The ruled background shows the space that is left.
	-->
	<div
		class="mt-2 box-content h-120 overflow-y-auto rounded-xl border border-line bg-[repeating-linear-gradient(to_bottom,transparent_0_calc(3rem-1px),var(--color-line)_calc(3rem-1px)_3rem)]"
	>
		{#if shown.length === 0}
			<p class="grid h-full place-items-center text-sm text-ink-subtle">
				Nobody is listed. Add a party above.
			</p>
		{:else}
			<ul bind:this={rowList} aria-label="Parties on the list">
				{#each shown as party (party.id)}
					<li
						class={[
							'flex h-12 items-center gap-1 border-b border-line bg-surface pr-1.5',
							refused === party.id && 'refused'
						]}
					>
						<!-- The skipper's tick is left out of the hammer: the server refuses to change it. -->
						<form
							method="POST"
							action="?/aboard{server}#passengers"
							data-hammer={refuseWithout(party) ? undefined : ''}
							{@attach rows.attach}
							class="h-full min-w-0 flex-1"
						>
							<input type="hidden" name="id" value={party.id} />
							<input type="hidden" name="aboard" value={String(!party.aboard)} />
							<button
								type="submit"
								aria-pressed={party.aboard}
								class="flex h-full w-full items-center gap-3 rounded-lg pl-3.5 text-left"
							>
								<span
									class={[
										'grid size-5 shrink-0 place-items-center rounded-md border',
										party.aboard
											? 'border-brand bg-brand text-brand-ink'
											: 'border-line-strong bg-surface',
										refused === party.id && 'border-bad',
										boarding.has(party.id) && 'animate-pulse'
									]}
									aria-hidden="true"
								>
									{#if party.aboard}
										{@render icon('m3.5 8.5 3 3 6-7')}
									{/if}
								</span>
								<span class="sr-only">Aboard:</span>
								<span class="min-w-0" data-tip={party.name} data-tip-at="start">
									<span class="block truncate">{party.name}</span>
								</span>
								<span class="shrink-0 text-sm text-ink-subtle tabular-nums">
									<span aria-hidden="true">×{party.seats}</span>
									<span class="sr-only">
										, {party.seats}
										{party.seats === 1 ? 'seat' : 'seats'}
									</span>
								</span>
							</button>
						</form>

						<form method="POST" action="?/remove{server}#passengers" {@attach rows.attach}>
							<input type="hidden" name="id" value={party.id} />
							<button
								type="submit"
								data-remove
								onclick={once}
								onkeydown={once}
								class="grid size-9 place-items-center rounded-lg text-ink-subtle hover:bg-sunken hover:text-ink"
							>
								{@render icon('M4.5 4.5l7 7M11.5 4.5l-7 7')}
								<span class="sr-only">Remove {party.name}</span>
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!--
		The hammer needs script to press anything, so until the page has hydrated its place is held
		by a placeholder, which says as much to a browser that will never run one.
	-->
	<ClientOnly class="mt-4 h-28 sm:h-16">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
			<button
				type="button"
				onclick={hammer}
				aria-disabled={hammering || rows.busy || mood === 'broken'}
				class="h-10 shrink-0 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:border-ink-subtle aria-disabled:cursor-not-allowed aria-disabled:text-ink-subtle"
			>
				Hammer the ticks
			</button>
			<p role="status" class="h-15 text-sm text-ink-muted tabular-nums sm:h-16">
				{#if mood === 'broken'}
					Not while the server breaks: every press would be one more fault in its log.
				{:else if !run || !heard}
					Presses every tick but the skipper’s {PRESSES} times, at uneven gaps, all rows at once.
				{:else if hammering}
					Pressing {run.presses} times on {run.rows} {run.rows === 1 ? 'row' : 'rows'}.
				{:else if rows.busy}
					{run.presses} presses on {run.rows}
					{run.rows === 1 ? 'row' : 'rows'}. Waiting for the last answers.
				{:else}
					{run.presses} presses on {run.rows}
					{run.rows === 1 ? 'row' : 'rows'}. The server was sent {heard.reached} of them, one at a
					time for each row, and saved {heard.saved}{heard.abandoned
						? `. ${heard.abandoned} were abandoned unwritten`
						: ''}.
				{/if}
			</p>
		</div>
	</ClientOnly>
</section>

{#snippet icon(path: string)}
	<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
		<path d={path} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
	</svg>
{/snippet}

<style>
	/* A refusal shakes its row. Transform only: the row is never moved out of its place. */
	.refused {
		animation: refuse 360ms ease-in-out;
	}

	@keyframes refuse {
		20%,
		60% {
			transform: translateX(-4px);
		}
		40%,
		80% {
			transform: translateX(4px);
		}
	}
</style>
