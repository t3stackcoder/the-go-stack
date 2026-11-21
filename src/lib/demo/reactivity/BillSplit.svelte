<!--
	Three pieces of state and two values derived from them. Move
	a slider and everything that depends on it follows. There is
	no setter to call and no dependency list to keep up to date.
-->
<script lang="ts">
	let bill = $state(84);
	let tip = $state(12);
	let people = $state(3);

	// Derived values are plain expressions. Svelte notes what they
	// read, and works them out again only when that has changed.
	const total = $derived(bill * (1 + tip / 100));
	const each = $derived(total / people);
</script>

<div
	class="grid gap-4 text-sm tabular-nums accent-accent *:grid *:grid-cols-[4.5rem_1fr_3rem] *:items-center *:gap-4"
>
	<label>
		Bill
		<input type="range" min="10" max="300" bind:value={bill} />
		<span aria-hidden="true">{bill}</span>
	</label>
	<label>
		Tip
		<input type="range" min="0" max="25" bind:value={tip} />
		<span aria-hidden="true">{tip}%</span>
	</label>
	<label>
		People
		<input type="range" min="1" max="12" bind:value={people} />
		<span aria-hidden="true">{people}</span>
	</label>
</div>

<dl class="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 tabular-nums">
	<div>
		<dt class="text-sm text-ink-muted">Total with tip</dt>
		<dd class="font-display text-3xl font-semibold">{total.toFixed(2)}</dd>
	</div>
	<div>
		<dt class="text-sm text-ink-muted">Each pays</dt>
		<dd class="font-display text-3xl font-semibold text-accent-text">{each.toFixed(2)}</dd>
	</div>
</dl>
