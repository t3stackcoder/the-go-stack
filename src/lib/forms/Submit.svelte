<!--
	The button that sends a form, and shows that it is on its way.

	Both labels share one grid cell, so the button is the size of the longer one throughout and
	showing the other changes nothing around it.

	The waiting label is not shown at once. A form answered quickly would flash it: on for a few
	frames and off again, which reads as a flicker and tells the visitor nothing. So it fades in
	a fifth of a second after the form leaves, and an answer that comes sooner is never seen to
	have been waited for. The press itself is acknowledged the moment it is made, by the button
	dipping, and the button is marked busy for a screen reader from the start. A visitor who asks
	for reduced motion gets the same pause and then a hard cut (see layout.css).

	`aria-disabled` and not `disabled`: a disabled button drops out of the keyboard's reach, and
	a visitor who was on it finds their focus gone. The helper ignores a second press by itself.
-->
<script lang="ts">
	import type { ClassValue, HTMLButtonAttributes } from 'svelte/elements';

	let {
		label,
		working,
		busy,
		variant = 'solid',
		class: className,
		...button
	}: Omit<HTMLButtonAttributes, 'type' | 'class' | 'disabled'> & {
		label: string;
		/** What it says while the form is on its way, such as "Signing in". */
		working: string;
		/** Whether the form is on its way: `save.busy`. */
		busy: boolean;
		/** `solid` is the form's main action, `quiet` one beside it, `danger` one that destroys. */
		variant?: 'solid' | 'quiet' | 'danger';
		class?: ClassValue;
	} = $props();
</script>

<button
	{...button}
	type="submit"
	aria-disabled={busy}
	class={[
		'submit grid h-10 rounded-lg px-4 text-sm font-semibold active:translate-y-px aria-disabled:cursor-progress',
		variant === 'solid' && 'bg-brand text-brand-ink',
		variant === 'quiet' && 'border border-line-strong bg-surface hover:border-ink-subtle',
		variant === 'danger' && 'border border-bad bg-surface text-bad hover:bg-sunken',
		className
	]}
>
	<span class="idle self-center [grid-area:1/1]">{label}</span>
	<span class="working flex items-center justify-center gap-2 [grid-area:1/1]">
		<!-- Spins only while the form is on its way: a hidden spinner would still be working. -->
		<span
			class={[
				'size-3.5 rounded-full border-2 border-current border-t-transparent',
				busy && 'animate-spin'
			]}
			aria-hidden="true"
		></span>
		{working}
	</span>
</button>

<style>
	/*
	 * The label that is not showing is hidden as well as transparent. Transparent alone, it is
	 * still read out, and the button's name would be both labels run together. `visibility`
	 * changes at the far end of the fade it is given, so it follows the opacity both ways.
	 */
	.idle,
	.working {
		transition:
			opacity 120ms ease-out,
			visibility 120ms;
	}

	.working {
		visibility: hidden;
		opacity: 0;
	}

	/* Only on the way in is there a wait. The way back, when the answer is here, is at once. */
	.submit[aria-disabled='true'] .idle,
	.submit[aria-disabled='true'] .working {
		transition-delay: 200ms;
	}

	.submit[aria-disabled='true'] .idle {
		visibility: hidden;
		opacity: 0;
	}

	.submit[aria-disabled='true'] .working {
		visibility: visible;
		opacity: 1;
	}
</style>
