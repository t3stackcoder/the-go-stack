<!--
	Chooses a new password, for a visitor who arrived by the link in an email. One form, in the
	frame the sign-in pages share.

	A link that is no good (expired, used, or not a link at all) gets the same page with the form
	out of reach and the reason in its status line, and a way to ask for another. The form is
	still there, so the page is the same height either way.
-->
<script lang="ts">
	import { FAULTS, REFUSAL } from '#lib/auth/messages.js';
	import Field from '#lib/forms/Field.svelte';
	import Submit from '#lib/forms/Submit.svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const save = saveForm({ answer: () => form, after: 'keep', refusal: REFUSAL.changed });
	const usable = $derived(data.token !== null);
</script>

<svelte:head>
	<title>Choose a new password · Team Collaborator</title>
</svelte:head>

<h1 class="font-display text-3xl font-semibold tracking-tight">Choose a new password</h1>
<p class="mt-2 mb-7 text-ink-muted">It signs your account out everywhere else.</p>

<!-- The token travels in the address, as it arrived, and is never a field: see the action. -->
<form
	method="POST"
	action="?/reset{data.token ? `&token=${encodeURIComponent(data.token)}` : ''}"
	{@attach save.attach}
>
	<!-- With no usable link the field and the button are dimmed and cannot be reached. -->
	<div inert={!usable} class={[!usable && 'opacity-50']}>
		<Field
			name="password"
			label="New password"
			type="password"
			autocomplete="new-password"
			faults={FAULTS.newPassword}
			required
			minlength={8}
			error={save.answer?.errors.password}
		/>
		<Submit
			label="Change password"
			working="Changing password"
			busy={save.busy}
			class="mt-1 w-full"
		/>
	</div>
	<!-- Always present, and two lines tall, which holds the longest thing it can say. -->
	<p
		role="status"
		class={[
			'mt-3 h-10 text-sm',
			save.failed || (!save.message && data.problem) ? 'text-bad' : 'text-ink-muted'
		]}
	>
		{save.message || (data.problem ?? '')}
	</p>
</form>

<p class="text-sm text-ink-muted">
	Need a new link?
	<a
		href={resolve('/(auth)/[mode=authMode]', { mode: 'forgot-password' })}
		class="font-medium text-brand-text underline-offset-3 hover:underline"
	>
		Ask for one
	</a>
</p>
