<!--
	Delivers the same late content to two small "pages" at once, one with a reservation and one
	without, and measures how far the text under each one moved.
-->
<script lang="ts">
	import Reserved from './Reserved.svelte';
	import Unreserved from './Unreserved.svelte';

	const MESSAGE = 'Your order has shipped. This notice arrived after the page did.';

	// Longer than the half second after a click during which browsers do not count movement as
	// layout shift, so the readout at the bottom of the screen records what happens here.
	const DELAY = 700;

	/** Nothing has been delivered yet: a promise that stays pending. */
	const waiting = new Promise<string>(() => {});

	let arrival = $state(waiting);
	let running = $state(false);
	let moved = $state<{ unreserved: number; reserved: number }>();

	let unreservedText = $state<HTMLElement>();
	let reservedText = $state<HTMLElement>();

	async function deliver() {
		if (!unreservedText || !reservedText) return;

		// Positions are relative to each small page, so scrolling during the wait does not count.
		const before = { unreserved: unreservedText.offsetTop, reserved: reservedText.offsetTop };

		moved = undefined;
		running = true;
		arrival = new Promise((resolve) => setTimeout(() => resolve(MESSAGE), DELAY));
		await arrival;
		// One frame, so the arrived content has been laid out before it is measured.
		await new Promise(requestAnimationFrame);

		moved = {
			unreserved: unreservedText.offsetTop - before.unreserved,
			reserved: reservedText.offsetTop - before.reserved
		};
		running = false;
	}

	function reset() {
		arrival = waiting;
		moved = undefined;
	}
</script>

{#snippet result(distance: number | undefined)}
	<p class="mt-3 flex h-6 items-center gap-2 text-sm">
		<span class="text-ink-muted">Text below moved</span>
		<span
			class={[
				'font-semibold tabular-nums',
				distance === 0 && 'text-good',
				distance !== undefined && distance !== 0 && 'text-bad'
			]}
		>
			{distance === undefined ? '…' : `${distance} px`}
		</span>
	</p>
{/snippet}

<div class="grid gap-6 sm:grid-cols-2">
	<div>
		<h3 class="text-sm font-medium">Without a reservation</h3>
		<div class="relative mt-3 h-56 space-y-3 overflow-hidden rounded-xl border border-line p-4">
			<p class="font-medium">Order 1042</p>
			<Unreserved {arrival} />
			<p bind:this={unreservedText} class="text-sm text-ink-muted">
				Imagine you are halfway through this sentence, or about to press a button just here, when
				the notice above turns up.
			</p>
		</div>
		<div aria-live="polite">{@render result(moved?.unreserved)}</div>
	</div>

	<div>
		<h3 class="text-sm font-medium">With a reservation</h3>
		<div class="relative mt-3 h-56 space-y-3 overflow-hidden rounded-xl border border-line p-4">
			<p class="font-medium">Order 1042</p>
			<Reserved {arrival} />
			<p bind:this={reservedText} class="text-sm text-ink-muted">
				Imagine you are halfway through this sentence, or about to press a button just here, when
				the notice above turns up.
			</p>
		</div>
		<div aria-live="polite">{@render result(moved?.reserved)}</div>
	</div>
</div>

<div class="mt-6 flex gap-3">
	<!-- A fixed width, so the label changing does not move the button beside it. -->
	<button
		type="button"
		onclick={deliver}
		disabled={running}
		class="w-52 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-ink disabled:opacity-60"
	>
		{running ? 'Arriving…' : 'Deliver the late content'}
	</button>
	<button
		type="button"
		onclick={reset}
		disabled={running}
		class="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium disabled:opacity-60"
	>
		Reset
	</button>
</div>
