<!--
	Asks for a link to choose a new password. One form, in the frame the sign-in pages share.

	What it says once it is sent does not depend on whether the address has an account: see the
	action. The sentence takes the two lines the form's status always has, so the page is the
	same height before and after.
-->
<script lang="ts">
	import { FAULTS, REFUSAL, SAID } from '#lib/auth/messages.js';
	import Field from '#lib/forms/Field.svelte';
	import Submit from '#lib/forms/Submit.svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	// The address stays in its field: the visitor may want to check what they typed.
	const save = saveForm({ answer: () => form, after: 'keep', refusal: REFUSAL.sent });
	const refused = $derived(save.answer?.refused ? save.answer : undefined);
	const asked = $derived(save.answer !== undefined && !save.failed);
</script>

<svelte:head>
	<title>Forgot your password · Team Collaborator</title>
</svelte:head>

<h1 class="font-display text-3xl font-semibold tracking-tight">Forgot your password?</h1>
<p class="mt-2 mb-7 text-ink-muted">
	Enter your address and we will send a link to choose a new one.
</p>

<form method="POST" action="?/send" {@attach save.attach}>
	<Field
		name="email"
		label="Email"
		type="email"
		faults={FAULTS.email}
		autocomplete="email"
		inputmode="email"
		autocapitalize="none"
		spellcheck={false}
		required
		defaultValue={refused?.values.email}
		error={refused?.errors.email}
	/>
	<Submit label="Send the link" working="Sending" busy={save.busy} class="mt-1 w-full" />
	<!-- Always present, and two lines tall, which holds the longest thing it can say. -->
	<p role="status" class={['mt-3 h-10 text-sm', save.failed ? 'text-bad' : 'text-ink-muted']}>
		{save.message || (asked ? SAID.resetAsked : '')}
	</p>
</form>

<p class="text-sm text-ink-muted">
	Remembered it?
	<a
		href={resolve('/(auth)/[mode=authMode]', { mode: 'sign-in' })}
		class="font-medium text-brand-text underline-offset-3 hover:underline"
	>
		Sign in
	</a>
</p>
