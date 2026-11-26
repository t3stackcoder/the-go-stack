<!--
	Signing in, signing up, and asking for a link to choose a new password: one page at three
	addresses, /sign-in, /sign-up and /forgot-password, whose three forms are panels that slide.
	They stand in a row, with signing in in the middle. Moving between them is a move within one
	route, so the page stays where it is and every form keeps what was typed into it.

	Every form here is plain HTML posting to an action in +page.server.ts, and works before the
	page has hydrated and with no JavaScript at all: sent that way, the answer is a page load.
	Once hydrated, `saveForm` sends the same forms in place. The provider buttons are never sent
	in place: they leave the site either way, and are left to the browser.

	The height does not change, whatever happens. That is three things:

	- The panels all lie in one grid cell. The cell is as tall as the tallest of them, at any
	  width and in any font, with no figure written down to go stale, so the page is the same
	  height at every address. A panel that is not showing is still laid out. It is only out of
	  sight, and `inert`, which takes it out of the keyboard's reach and a screen reader's.
	- Every message has a line waiting for it: one under each field, two for the form. They are
	  written to fit (src/lib/auth/messages.ts).
	- What follows a sign-up, "check your inbox", is one more panel in the same cell, shorter
	  than the form whose place it takes.

	The slide is `transform` and `opacity` and nothing else. Neither is layout: the browser moves
	a picture of the panel it has already drawn, the page's own measure of layout shift stays at
	nought, and a slow script cannot make it stutter. The stage clips what is off to the side. A
	visitor who asks for reduced motion gets a hard cut (layout.css).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { FAULTS, REFUSAL, SAID, sentenceFor } from '#lib/auth/messages.js';
	import ProviderMark from '#lib/auth/ProviderMark.svelte';
	import { providerName } from '#lib/auth/providers.js';
	import Field from '#lib/forms/Field.svelte';
	import Submit from '#lib/forms/Submit.svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form, params }: PageProps = $props();

	const signingIn = $derived(params.mode === 'sign-in');
	const signingUp = $derived(params.mode === 'sign-up');
	const forgetting = $derived(params.mode === 'forgot-password');

	const TITLES = {
		'sign-in': 'Sign in',
		'sign-up': 'Create an account',
		'forgot-password': 'Forgot your password'
	} as const;
	/** The page to go back to, as every address on this page carries it: `?next=…`, or nothing. */
	const next = $derived(data.query);

	/**
	 * Whether a form has been sent in place since the page arrived. What the page arrived to say
	 * (a provider's refusal, a notice from another page) is about how the visitor got here, and
	 * from then on it is old news: left up, it would show again each time a form was on its way
	 * and had nothing of its own to say.
	 */
	let sentSince = $state(false);
	const sending = () => {
		sentSince = true;
	};

	const signIn = saveForm({
		answer: () => (form?.action === 'signIn' ? form : undefined),
		after: 'keep',
		refusal: REFUSAL.signIn,
		sending
	});
	const signUp = saveForm({
		answer: () => (form?.action === 'signUp' ? form : undefined),
		after: 'keep',
		refusal: REFUSAL.signUp,
		sending
	});
	const resend = saveForm({
		answer: () => (form?.action === 'resend' ? form : undefined),
		after: 'keep',
		refusal: REFUSAL.sent,
		// The server takes half a second over this on purpose (see `slow` in the helper).
		slow: 1500,
		sending
	});
	// What this one says once it is sent does not depend on whether the address has an account:
	// see the action. The address stays in its field, for the visitor to check what they typed.
	const forgot = saveForm({
		answer: () => (form?.action === 'forgot' ? form : undefined),
		after: 'keep',
		refusal: REFUSAL.sent
	});

	/**
	 * The answer the page arrived with, if a form was sent the browser's own way. A move between
	 * the addresses empties `form`, and a field that nobody has typed in follows its default:
	 * without this, the address the server had sent back would vanish from its field on the way.
	 */
	const arrived = untrack(() => form);
	const arrivedSignIn = arrived?.action === 'signIn' ? arrived.values : undefined;
	const arrivedSignUp =
		arrived?.action === 'signUp' && arrived.refused ? arrived.values : undefined;
	const arrivedForgot =
		arrived?.action === 'forgot' && arrived.refused ? arrived.values : undefined;

	/** The sign-up's answer when it was turned down. Taken, it answers with the address instead. */
	const signUpRefused = $derived(signUp.answer?.refused ? signUp.answer : undefined);
	const forgotRefused = $derived(forgot.answer?.refused ? forgot.answer : undefined);
	/** Whether a link has been asked for, and the asking was taken. */
	const forgotAsked = $derived(forgot.answer !== undefined && !forgot.failed);

	/** The address a verification link has been sent to, once a sign-up has been taken. */
	const inbox = $derived.by(() => {
		for (const answer of [resend.answer, signUp.answer]) {
			if (!answer) continue;
			if (!answer.refused) return answer.sent;
			// A resend that was turned down is still about the address it was for.
			if (answer.action === 'resend') return answer.values.email;
		}
	});

	/** What the page arrived to say, or what a provider's button was answered. */
	const arrival = $derived.by(() => {
		if (sentSince) return undefined;
		if (form?.action === 'social') {
			return { words: form.message ?? sentenceFor('PROVIDER_NOT_FOUND'), bad: true };
		}
		return data.arrival;
	});

	/** What a form's status line says: its own news, and failing that the page's. */
	const said = (save: { message: string; failed: boolean }) =>
		save.message
			? { words: save.message, bad: save.failed }
			: (arrival ?? { words: '', bad: false });
	const signInSaid = $derived(said(signIn));
	const signUpSaid = $derived(said(signUp));

	// The keyboard goes to the first field of the form that is sliding in, and goes at once: the
	// visitor asked for this form, and can be typing while it arrives. The move between the
	// addresses keeps focus where it was, on a link in the panel that has just become inert,
	// which is nowhere: so unless focus is somewhere it can be used, it is put where they will
	// type next.
	//
	// At once, and not when the slide ends. The slide lands slowly, so the form looks settled
	// well before its half second is up, and a caret that waited for the end was seen to arrive
	// late; what was typed meanwhile went nowhere. `preventScroll` is what lets it be early: a
	// field that takes focus is otherwise scrolled into view, and this one is still on its way.
	//
	// "Nowhere" is the page itself, a panel that is out of reach, or the page's <main>. That
	// last is WebKit's: it does not give a link focus when it is pressed, and what takes it is
	// the nearest thing around the link that can, which is <main>. Measured there before this
	// was counted: the slide ended with the keyboard on nothing.
	let stage: HTMLElement;
	afterNavigate(({ type }) => {
		if (type === 'enter') return;

		const active = document.activeElement;
		const nowhere =
			!active || active === document.body || active.matches('main') || !!active.closest('[inert]');
		if (!nowhere) return;

		stage
			.querySelector<HTMLInputElement>('[data-at="here"] input:not([type="hidden"])')
			?.focus({ preventScroll: true });
	});
</script>

<svelte:head>
	<title>{TITLES[params.mode]} · Team Collaborator</title>
</svelte:head>

{#snippet providers()}
	{#if data.providers.length}
		<!-- Sent the browser's own way. The button's own name and value say which provider. -->
		<form method="POST" action="?/social{next ? `&${next.slice(1)}` : ''}">
			<div class="grid grid-cols-3 gap-2">
				<!--
					The hints of the first and the last are lined up with their own outer edges:
					under the middle, either would run past the stage, which clips.
				-->
				{#each data.providers as provider, at (provider)}
					<button
						type="submit"
						name="provider"
						value={provider}
						data-tip="Continue with {providerName(provider)}"
						data-tip-at={at === 0 ? 'start' : at === data.providers.length - 1 ? 'end' : undefined}
						class="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface text-sm font-medium hover:border-ink-subtle active:translate-y-px"
					>
						<ProviderMark {provider} />
						<span class="sr-only">Continue with</span>
						<!--
							The name is out of sight, though still read out, on a window too narrow for
							three of them in a row: see the note in the styles below.
						-->
						<span class="provider-name">{providerName(provider)}</span>
					</button>
				{/each}
			</div>
		</form>
		<div class="my-5 flex items-center gap-3 text-xs text-ink-subtle" role="separator">
			<span class="h-px flex-1 bg-line" aria-hidden="true"></span>
			or with email
			<span class="h-px flex-1 bg-line" aria-hidden="true"></span>
		</div>
	{/if}
{/snippet}

{#snippet status(words: string, bad: boolean)}
	<!-- Always present, and two lines tall, which holds the longest thing it can say. -->
	<p role="status" class={['mt-3 h-10 text-sm', bad ? 'text-bad' : 'text-ink-muted']}>{words}</p>
{/snippet}

<!--
	The stage is drawn 6px wider than its column on every side, and each panel is padded by the
	same, so the forms line up with the column and a focus ring at a panel's edge is inside the
	clip. Its one column may be narrower than what is in it, and so may each panel: see the note
	in the layout about what a long address did.
-->
<div bind:this={stage} class="stage -m-1.5 grid grid-cols-[minmax(0,1fr)] overflow-clip">
	<!-- The panels are written in the order they stand in, left to right. -->
	<section
		aria-labelledby="forgot-title"
		data-at={forgetting ? 'here' : 'left'}
		inert={!forgetting}
		class="panel min-w-0 p-1.5 [grid-area:1/1]"
	>
		<h1 id="forgot-title" class="font-display text-3xl font-semibold tracking-tight">
			Forgot your password?
		</h1>
		<p class="mt-2 mb-7 text-ink-muted">
			Enter your address and we will send a link to choose a new one.
		</p>

		<form method="POST" action="?/forgot{next ? `&${next.slice(1)}` : ''}" {@attach forgot.attach}>
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
				defaultValue={forgotRefused?.values.email ?? arrivedForgot?.email}
				error={forgotRefused?.errors.email}
			/>
			<Submit label="Send the link" working="Sending" busy={forgot.busy} class="mt-1 w-full" />
			{@render status(forgot.message || (forgotAsked ? SAID.resetAsked : ''), forgot.failed)}
		</form>

		<p class="text-sm text-ink-muted">
			Remembered it?
			<a
				href="{resolve('/(auth)/[mode=authMode]', { mode: 'sign-in' })}{next}"
				data-sveltekit-replacestate
				data-sveltekit-reset="false"
				class="font-medium text-brand-text underline-offset-3 hover:underline"
			>
				Sign in
			</a>
		</p>
	</section>

	<section
		aria-labelledby="sign-in-title"
		data-at={signingIn ? 'here' : forgetting ? 'right' : 'left'}
		inert={!signingIn}
		class="panel min-w-0 p-1.5 [grid-area:1/1]"
	>
		<h1 id="sign-in-title" class="font-display text-3xl font-semibold tracking-tight">
			Welcome back
		</h1>
		<p class="mt-2 mb-7 text-ink-muted">Sign in to your account.</p>

		{@render providers()}

		<form method="POST" action="?/signIn{next ? `&${next.slice(1)}` : ''}" {@attach signIn.attach}>
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
				defaultValue={signIn.answer?.values.email ?? arrivedSignIn?.email}
				error={signIn.answer?.errors.email}
			/>
			<Field
				name="password"
				label="Password"
				type="password"
				autocomplete="current-password"
				faults={FAULTS.password}
				required
				error={signIn.answer?.errors.password}
			>
				{#snippet aside()}
					<a
						href="{resolve('/(auth)/[mode=authMode]', { mode: 'forgot-password' })}{next}"
						data-sveltekit-replacestate
						data-sveltekit-reset="false"
						class="text-sm text-brand-text underline-offset-3 hover:underline"
					>
						Forgot it?
					</a>
				{/snippet}
			</Field>
			<Submit label="Sign in" working="Signing in" busy={signIn.busy} class="mt-1 w-full" />
			{@render status(signInSaid.words, signInSaid.bad)}
		</form>

		<p class="text-sm text-ink-muted">
			New here?
			<a
				href="{resolve('/(auth)/[mode=authMode]', { mode: 'sign-up' })}{next}"
				data-sveltekit-replacestate
				data-sveltekit-reset="false"
				class="font-medium text-brand-text underline-offset-3 hover:underline"
			>
				Create an account
			</a>
		</p>
	</section>

	<section
		aria-labelledby="sign-up-title"
		data-at={!signingUp ? 'right' : inbox ? 'under' : 'here'}
		inert={!signingUp || inbox !== undefined}
		class="panel min-w-0 p-1.5 [grid-area:1/1]"
	>
		<h1 id="sign-up-title" class="font-display text-3xl font-semibold tracking-tight">
			Create your account
		</h1>
		<p class="mt-2 mb-7 text-ink-muted">Join your team in a minute.</p>

		{@render providers()}

		<form method="POST" action="?/signUp{next ? `&${next.slice(1)}` : ''}" {@attach signUp.attach}>
			<Field
				name="name"
				label="Name"
				faults={FAULTS.name}
				autocomplete="name"
				required
				maxlength={60}
				defaultValue={signUpRefused?.values.name ?? arrivedSignUp?.name}
				error={signUpRefused?.errors.name}
			/>
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
				defaultValue={signUpRefused?.values.email ?? arrivedSignUp?.email}
				error={signUpRefused?.errors.email}
			/>
			<Field
				name="password"
				label="Password"
				type="password"
				autocomplete="new-password"
				faults={FAULTS.newPassword}
				required
				minlength={8}
				error={signUpRefused?.errors.password}
			/>
			<Submit
				label="Create account"
				working="Creating account"
				busy={signUp.busy}
				class="mt-1 w-full"
			/>
			{@render status(signUpSaid.words, signUpSaid.bad)}
		</form>

		<p class="text-sm text-ink-muted">
			Have an account?
			<a
				href="{resolve('/(auth)/[mode=authMode]', { mode: 'sign-in' })}{next}"
				data-sveltekit-replacestate
				data-sveltekit-reset="false"
				class="font-medium text-brand-text underline-offset-3 hover:underline"
			>
				Sign in
			</a>
		</p>
	</section>

	<!--
		What follows a sign-up, in the place of its form. It is in the page from the start, like
		the forms, and is faded in where it stands: nothing is inserted, and it is shorter than
		the form, so the cell it shares keeps its height.
	-->
	<section
		aria-labelledby="inbox-title"
		data-at={!signingUp ? 'right' : inbox ? 'here' : 'under'}
		inert={!signingUp || inbox === undefined}
		class="panel min-w-0 p-1.5 [grid-area:1/1]"
	>
		<h1 id="inbox-title" class="font-display text-3xl font-semibold tracking-tight">
			Check your inbox
		</h1>
		<p class="mt-2 text-ink-muted">We sent a link to</p>
		<!-- One line, whatever the address: a long one is cut short, and read out whole. -->
		<p class="h-6 font-medium" data-tip={inbox} data-tip-at="start">
			<span class="block truncate">{inbox ?? ''}</span>
		</p>
		<p class="mt-4 text-ink-muted">
			Open it to finish creating your account. It signs you in, and works for one hour.
		</p>

		<form method="POST" action="?/resend{next ? `&${next.slice(1)}` : ''}" {@attach resend.attach}>
			<input type="hidden" name="email" value={inbox ?? ''} />
			<Submit
				label="Send it again"
				working="Sending"
				busy={resend.busy}
				variant="quiet"
				class="mt-7 w-full"
			/>
			{@render status(
				resend.message || (resend.answer && !resend.failed ? SAID.sentAgain : ''),
				resend.failed
			)}
		</form>

		<p class="text-sm text-ink-muted">
			Wrong address?
			<a
				href="{resolve('/(auth)/[mode=authMode]', { mode: 'sign-up' })}{next}"
				data-sveltekit-replacestate
				data-sveltekit-reset="false"
				class="font-medium text-brand-text underline-offset-3 hover:underline"
			>
				Go back and change it
			</a>
		</p>
	</section>
</div>

<style>
	/*
	 * Where a panel is. `here` is in view. `left` and `right` are a panel's width off to that
	 * side, where a form rests while another is showing: the row is forgot-password, sign-in,
	 * sign-up, and each waits on its own side of the one in view. `under` is in place and
	 * not shown, which is how the sign-up form and the inbox take turns without either sliding.
	 *
	 * The curve leaves fast and lands slowly. A transition runs only on a change, so a panel is
	 * never seen arriving when the page loads: it is drawn where it rests.
	 */
	.panel {
		transition:
			transform 500ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 500ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.panel[data-at='left'] {
		transform: translateX(-100%);
		opacity: 0;
	}

	.panel[data-at='right'] {
		transform: translateX(100%);
		opacity: 0;
	}

	.panel[data-at='under'] {
		opacity: 0;
	}

	/*
	 * Three buttons with a mark and a name each, and 8px of button either side of them, need a
	 * window of 388px: measured with the fallback font in Firefox and WebKit, where the window
	 * keeps no room for a scrollbar, as on every phone (Inter needs 387px). Under 390px the names
	 * are out of sight, though still read out, and the marks stand alone, as they are known to.
	 * A desktop Chromium that keeps 15px for a scrollbar has 6px either side at that width in
	 * place of 8px, which is still inside the button.
	 */
	@media (width < 24.375rem) {
		.provider-name {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
