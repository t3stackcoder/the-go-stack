<!--
	The last step of deleting an account: what deleting means, and one button that does it. The
	visitor arrives by the link in an email, signed in (the server saw to that).

	A link that is no good gets the same page with the button out of reach and the reason in its
	status line. The button is still there, so the page is the same height either way, and a
	refusal from the server (a link that has been used) takes the same line.
-->
<script lang="ts">
	import Submit from '#lib/forms/Submit.svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const save = saveForm({ answer: () => form, after: 'keep' });
	const usable = $derived(data.token !== null);
</script>

<svelte:head>
	<title>Delete your account · Team Collaborator</title>
</svelte:head>

<div class="mx-auto max-w-md px-6 pt-10 sm:pt-14">
	<h1 class="font-display text-3xl font-semibold tracking-tight">Delete your account</h1>
	<p class="mt-3 text-ink-muted">Deleting it cannot be undone. When you press the button:</p>
	<ul class="mt-3 mb-7 list-disc space-y-1 pl-5 text-ink-muted">
		<li>your name, address and password are removed;</li>
		<li>every provider you sign in with is disconnected;</li>
		<li>you are signed out everywhere, here included.</li>
	</ul>

	<!-- The token travels in the address, as it arrived, and is never a field: see the action. -->
	<form
		method="POST"
		action="?/confirm{data.token ? `&token=${encodeURIComponent(data.token)}` : ''}"
		{@attach save.attach}
	>
		<!-- With no usable link the button is dimmed and cannot be reached. -->
		<div inert={!usable} class={[!usable && 'opacity-50']}>
			<Submit
				label="Delete my account"
				working="Deleting"
				busy={save.busy}
				variant="danger"
				class="w-full"
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
		Changed your mind?
		<a
			href={resolve('/account')}
			class="font-medium text-brand-text underline-offset-3 hover:underline"
		>
			Keep my account
		</a>
	</p>
</div>
