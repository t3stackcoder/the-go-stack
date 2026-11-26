<!--
	One field of a form that saves: its label, the input, and the line under it where the server's
	message for it is shown. It is the markup src/lib/forms/save-form.svelte.ts leaves to the page,
	written once.

	The message's line is always there and one line tall, so a message arriving moves nothing. It
	is cut short with an ellipsis sooner than be allowed to wrap or to push the page sideways, and
	the sentences shown in it are written to fit (see src/lib/auth/messages.ts for the ones the
	account pages use). The message is tied to the input for a screen reader, and marks it invalid.

	The input takes what the server sent as its default and is otherwise left to the browser:
	there is no `value` here to bind, for the reasons the helper gives. So text typed before the
	page has hydrated stays where it was typed.

	The browser still checks the field before the form is sent (`required`, `type`, `minlength`),
	and still refuses to send it. What it is not left to do is say so: its bubble differs in every
	browser, in looks and in words, and cannot be styled. The field says it instead, in the site's
	tooltip (`.tooltip` in src/routes/layout.css, the one its hints use), in red, pointing at the
	input. The tooltip lies over the page and takes no room in it, so it moves nothing either. Before the page has hydrated, and with no JavaScript, the bubble is
	the browser's own, which is the same check with different looks.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue, HTMLInputAttributes } from 'svelte/elements';

	// Any attribute of an input, bar what the field sets for itself. The three handlers are the
	// tooltip's, below: one passed in would be dropped without a word, so none can be.
	type Props = Omit<
		HTMLInputAttributes,
		'value' | 'class' | 'id' | 'oninvalid' | 'oninput' | 'onblur'
	> & {
		name: string;
		label: string;
		/** The server's message for this field, if it turned it down. */
		error?: string;
		/**
		 * What the field says when the browser turns it down, by what is wrong: nothing in it, not
		 * the kind of thing asked for (an email address), or too short. Best the server's own
		 * sentence for the same fault, so the visitor is told one thing whoever catches it.
		 */
		faults?: { missing?: string; mismatch?: string; short?: string };
		/** What the field holds on arrival: what the server sent back, or what it has saved. */
		defaultValue?: string;
		/** Something to stand at the end of the label's line, such as a link. */
		aside?: Snippet;
		class?: ClassValue;
	};

	let {
		label,
		error,
		faults,
		defaultValue = '',
		aside,
		class: className,
		...input
	}: Props = $props();

	const uid = $props.id();

	/** What the tooltip says, while it is showing. */
	let fault = $state('');

	function sayFault(event: Event & { currentTarget: HTMLInputElement }) {
		// This is what keeps the browser's bubble away. The form is still not sent.
		event.preventDefault();

		// Every field at fault is told, in order. Only the first speaks and takes the keyboard,
		// as the browser would have had it: one thing to put right at a time.
		const field = event.currentTarget;
		if (field.form?.querySelector('input:invalid, select:invalid, textarea:invalid') !== field) {
			return;
		}

		const { valueMissing, typeMismatch, tooShort } = field.validity;
		const own = valueMissing
			? faults?.missing
			: typeMismatch
				? faults?.mismatch
				: tooShort
					? faults?.short
					: undefined;
		// The browser's sentence where the page wrote none: a fault is never left unexplained.
		fault = own ?? field.validationMessage;
		field.focus();
	}

	/** The tooltip goes when the visitor starts to put it right, or leaves the field. */
	function hush() {
		fault = '';
	}
</script>

<div class={className}>
	<div class="flex items-baseline justify-between gap-3">
		<label for="{uid}-input" class="text-sm font-medium">{label}</label>
		{@render aside?.()}
	</div>
	<div class="relative mt-1.5">
		<input
			{...input}
			id="{uid}-input"
			{defaultValue}
			aria-invalid={error || fault ? 'true' : undefined}
			aria-describedby="{uid}-error"
			oninvalid={sayFault}
			oninput={hush}
			onblur={hush}
			class="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 placeholder:text-ink-subtle aria-[invalid]:border-bad"
		/>
		{#if fault}
			<!--
				An alert, so that it is read out when it appears: the keyboard may already be in
				the field, and a description is only read on the way in. Over what follows, and
				above the fields after this one, which are positioned too.
			-->
			<p role="alert" class="tooltip top-full left-3 mt-2.5 max-w-[calc(100%-1.5rem)] text-bad">
				{fault}
			</p>
		{/if}
	</div>
	<p id="{uid}-error" class="mt-1 h-5 truncate text-sm text-bad">{error ?? ''}</p>
</div>
