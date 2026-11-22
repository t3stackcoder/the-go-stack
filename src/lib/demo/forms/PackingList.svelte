<!--
	The packing list. Every control is a plain HTML form that posts to an action in
	routes/forms/+page.server.ts, and works with no JavaScript at all. Once the page has hydrated,
	`saveForm` upgrades the same forms in place: there is no second version for when script runs.

	The two fields take what the server sends back as their defaults (`defaultValue`), not as their
	values. Hydration then leaves alone whatever the visitor typed while the page was still loading.
-->
<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import type { ActionData } from '../../../routes/forms/$types';
	import { MAX_QUANTITY, MAX_TEXT, type Item } from './packing.js';

	let { items, form }: { items: Item[]; form: ActionData } = $props();

	const uid = $props.id();
	let textInput: HTMLInputElement;

	// What the visitor has asked for and the server has not yet answered, laid over the server's
	// data. When the answer arrives the overlay is removed and the server's version is what remains,
	// so a refusal rolls itself back: there is no undo code to write.
	const packing = new SvelteMap<number, boolean>();
	const removing = new SvelteSet<number>();
	const shown = $derived(
		items
			.filter((item) => !removing.has(item.id))
			.map((item) => ({ ...item, packed: packing.get(item.id) ?? item.packed }))
	);
	const packed = $derived(shown.filter((item) => item.packed).length);

	// The form that adds an item. It is sent once at a time, and emptied for the next item once
	// the server has taken this one. After a refusal, focus goes to the field that was turned down.
	const add = saveForm({
		answer: () => (form?.action === 'add' ? form : undefined),
		// The server logs every attempt, the ones it turns down included, so the log beside the
		// list is out of date after a refusal as well as after a save.
		reload: 'always',
		// On to the next item, unless the visitor has already gone somewhere else. Without
		// scrolling: if they have moved down the page to read, that is where they stay.
		saved: (_form, stayed) => {
			if (stayed) textInput.focus({ preventScroll: true });
		}
	});

	// The two forms on every row: the tick and the cross. Each row's forms are sent and answered
	// on their own. A second press of a tick abandons the first, whose answer is never applied.
	const rows = saveForm({
		answer: () => (form?.action === 'toggle' || form?.action === 'delete' ? form : undefined),
		again: 'replace',
		reload: 'always',
		sending: (fields, formElement) => {
			const id = Number(fields.get('id'));
			const wanted = fields.get('packed');

			if (wanted !== null) {
				packing.set(id, wanted === 'true');
				return () => packing.delete(id);
			}

			// This row and its button are about to disappear. Keep keyboard focus on the list.
			if (formElement.contains(document.activeElement)) {
				const row = formElement.closest('li');
				const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
				(neighbour?.querySelector<HTMLElement>('[data-remove]') ?? textInput).focus();
			}
			removing.add(id);
			return () => removing.delete(id);
		}
	});

	// The row whose tick the server refused. Not while that row has a request in flight, so a
	// repeat refusal plays its animation again.
	const refused = $derived.by(() => {
		if (!rows.failed || rows.answer?.action !== 'toggle') return undefined;
		const id = Number(rows.answer.values.id);
		return packing.has(id) ? undefined : id;
	});
</script>

<section id="packing-list" aria-labelledby="{uid}-title" class="scroll-mt-28">
	<h3 id="{uid}-title" class="font-display text-xl font-semibold tracking-tight">
		A long weekend away
	</h3>
	<p class="mt-1 text-sm text-ink-muted tabular-nums">{packed} of {shown.length} packed</p>
	<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
		<div
			class="h-full origin-left rounded-full bg-accent transition-transform duration-300"
			style:transform="scaleX({shown.length ? packed / shown.length : 0})"
		></div>
	</div>

	<form
		method="POST"
		action="?/add#packing-list"
		{@attach add.attach}
		class="mt-6 grid grid-cols-[6rem_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]"
	>
		<div class="col-span-2 sm:col-span-1">
			<label for="{uid}-text" class="text-sm font-medium">Item</label>
			<input
				bind:this={textInput}
				id="{uid}-text"
				name="text"
				defaultValue={add.answer?.values.text ?? ''}
				required
				maxlength={MAX_TEXT}
				autocomplete="off"
				placeholder="Sun cream"
				aria-invalid={add.answer?.errors.text ? 'true' : undefined}
				aria-describedby="{uid}-text-error"
				class="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 placeholder:text-ink-subtle aria-[invalid]:border-bad"
			/>
			<!-- Always present and one line tall, so a message appearing here cannot move anything. -->
			<p id="{uid}-text-error" class="mt-1 h-5 text-sm whitespace-nowrap text-bad">
				{add.answer?.errors.text ?? ''}
			</p>
		</div>

		<div>
			<label for="{uid}-quantity" class="text-sm font-medium">How many</label>
			<input
				id="{uid}-quantity"
				name="quantity"
				type="number"
				inputmode="numeric"
				defaultValue={add.answer?.values.quantity ?? '1'}
				required
				min="1"
				max={MAX_QUANTITY}
				aria-invalid={add.answer?.errors.quantity ? 'true' : undefined}
				aria-describedby="{uid}-quantity-error"
				class="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 tabular-nums aria-[invalid]:border-bad"
			/>
			<p id="{uid}-quantity-error" class="mt-1 h-5 text-sm whitespace-nowrap text-bad">
				{add.answer?.errors.quantity ?? ''}
			</p>
		</div>

		<!-- Both labels share one grid cell, so the button is as wide as the longer one throughout. -->
		<button
			type="submit"
			aria-disabled={add.busy}
			class="mt-6.5 grid h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink aria-disabled:cursor-progress"
		>
			<span class={['self-center [grid-area:1/1]', add.busy && 'invisible']}>Add to list</span>
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
			answer came. Always present, and tall enough for the longest of them on a phone.
		-->
		<p
			role="status"
			class={['col-span-full h-10 text-sm sm:h-5', add.failed ? 'text-bad' : 'text-ink-muted']}
		>
			{add.message}
		</p>
	</form>

	<!--
		A fixed height that holds the full list, so adding or removing a row never moves what is
		below it. The ruled background shows the space that is left.
	-->
	<div
		class="mt-2 box-content h-120 overflow-y-auto rounded-xl border border-line bg-[repeating-linear-gradient(to_bottom,transparent_0_calc(3rem-1px),var(--color-line)_calc(3rem-1px)_3rem)]"
	>
		{#if shown.length === 0}
			<p class="grid h-full place-items-center text-sm text-ink-subtle">
				Nothing to pack. Add something above.
			</p>
		{:else}
			<ul aria-label="Things to pack">
				{#each shown as item (item.id)}
					<li
						class={[
							'flex h-12 items-center gap-1 border-b border-line bg-surface pr-1.5',
							refused === item.id && 'refused'
						]}
					>
						<form
							method="POST"
							action="?/toggle#packing-list"
							{@attach rows.attach}
							class="h-full min-w-0 flex-1"
						>
							<input type="hidden" name="id" value={item.id} />
							<input type="hidden" name="packed" value={String(!item.packed)} />
							<button
								aria-pressed={item.packed}
								class="flex h-full w-full items-center gap-3 rounded-lg pl-3.5 text-left"
							>
								<span
									class={[
										'grid size-5 shrink-0 place-items-center rounded-md border',
										item.packed
											? 'border-accent bg-accent text-accent-ink'
											: 'border-line-strong bg-surface',
										refused === item.id && 'border-bad',
										packing.has(item.id) && 'animate-pulse'
									]}
									aria-hidden="true"
								>
									{#if item.packed}{@render icon('m3.5 8.5 3 3 6-7')}{/if}
								</span>
								<span class="sr-only">Packed:</span>
								<span
									class={['truncate', item.packed && 'text-ink-subtle line-through']}
									title={item.text}
								>
									{item.text}
								</span>
								<span class="shrink-0 text-sm text-ink-subtle tabular-nums">
									<span aria-hidden="true">×{item.quantity}</span>
									<span class="sr-only">, quantity {item.quantity}</span>
								</span>
							</button>
						</form>

						<form method="POST" action="?/delete#packing-list" {@attach rows.attach}>
							<input type="hidden" name="id" value={item.id} />
							<button
								data-remove
								class="grid size-9 place-items-center rounded-lg text-ink-subtle hover:bg-sunken hover:text-ink"
							>
								{@render icon('M4.5 4.5l7 7M11.5 4.5l-7 7')}
								<span class="sr-only">Remove {item.text}</span>
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- What became of the last tick or removal: the server's refusal, or a request that failed. -->
	<p role="status" class={['mt-3 h-10 text-sm', rows.failed ? 'text-bad' : 'text-ink-muted']}>
		{rows.message}
	</p>
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
