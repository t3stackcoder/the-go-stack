<!--
	The account page: the name, the address, the password, the providers that sign the visitor in,
	the sessions they have open, and a way to delete it all. One form for each, and each a plain
	POST to its own action in +page.server.ts, so all of it works before the page has hydrated and
	without JavaScript. Once hydrated, `saveForm` sends each in place. The buttons that connect a
	provider are never sent in place: they leave the site either way, and are left to the browser.

	Nothing on the page moves, whatever is pressed:

	- Every message has a line waiting for it: one under each field, two for each form's status,
	  which are always in the page and hold the longest sentence that can be said there
	  (src/lib/auth/messages.ts).
	- A control that comes and goes leaves something the same size in its place. The provider
	  that is the only way in has a note where its button would be. Once no other session is
	  left, a note takes the place of the button that signed them out.
	- The sessions are a list that can only grow shorter while the page is open, and does not.
	  A session that is signed out keeps its row, marked as signed out, until the page is next
	  loaded: removed, it would pull up everything under it. That holds for every session the
	  page arrived with. One that began since is not added, which would push everything down;
	  the status line says that there is one, and to reload to see it.

	On a wide window each section is a row: what it is on the left, its form on the right. A
	phone gets the sections one under another, full width with no frame around them, because a
	frame's padding would take the room the messages are written to fit: a field's line is 272px
	at a 320px window. Its buttons are full width there, and a session's details have a line each.

	Times are in UTC, and say so. The server does not know the visitor's time zone, and a time
	turned into local time by the browser would not be the one in the server's HTML.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { FAULTS, GENERIC, REFUSAL, SAID } from '#lib/auth/messages.js';
	import ProviderMark from '#lib/auth/ProviderMark.svelte';
	import { providerName } from '#lib/auth/providers.js';
	import { account } from '#lib/auth/who.svelte.js';
	import Field from '#lib/forms/Field.svelte';
	import Submit from '#lib/forms/Submit.svelte';
	import { saveForm } from '#lib/forms/save-form.svelte.js';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * Whether a form has been sent in place since the page arrived. What the page arrived to say
	 * (that a provider was connected, or a change of address is half done) is about how the
	 * visitor got here, and from then on it is old news: left up, it would show again each time a
	 * form was on its way and had nothing of its own to say. A move to another address of the
	 * page is a new arrival.
	 */
	let sentSince = $state(false);
	const sending = () => {
		sentSince = true;
	};

	/** The sessions as the page arrived with them. See the note at the top. */
	let seen = $state.raw(untrack(() => data.sessions));

	afterNavigate(({ type }) => {
		if (type === 'enter') return;
		sentSince = false;
		seen = data.sessions;
	});

	const rename = saveForm({
		answer: () => (form?.action === 'rename' ? form : undefined),
		after: 'keep',
		sending,
		// The header's menu shows the name, and asks for it again the next time it is opened.
		saved: () => account.forget()
	});
	const changeEmail = saveForm({
		answer: () => (form?.action === 'changeEmail' ? form : undefined),
		after: 'keep',
		refusal: REFUSAL.changed,
		sending
	});
	// Emptied after a save, as anything that held a password should be.
	const changePassword = saveForm({
		answer: () => (form?.action === 'changePassword' ? form : undefined),
		refusal: REFUSAL.changed,
		sending
	});
	const setPassword = saveForm({
		answer: () => (form?.action === 'setPassword' ? form : undefined),
		after: 'keep',
		sending
	});
	const deleteAccount = saveForm({
		answer: () => (form?.action === 'deleteAccount' ? form : undefined),
		after: 'keep',
		sending
	});

	/**
	 * The forms of a set, which one helper serves (one for each provider, one for each session),
	 * that are on their way, by the id each was sent with: so that the button that was pressed is
	 * the one seen to wait.
	 *
	 * Plain objects, and not the reactive Set that Svelte offers. That class was in one page's
	 * file until this page used it too, and code two pages share goes into the file every page
	 * fetches (see vite.config.ts): measured, it was 0.6 KB on the wire for every page of the
	 * site, for the sake of two lists that are almost always empty.
	 */
	const removing = $state<Record<string, true>>({});
	const ending = $state<Record<string, true>>({});
	const marking = (busy: Record<string, true>, field: string) => (fields: FormData) => {
		sentSince = true;
		const id = String(fields.get(field));
		busy[id] = true;
		return () => {
			delete busy[id];
		};
	};

	const unlink = saveForm({
		answer: () => (form?.action === 'unlink' ? form : undefined),
		after: 'keep',
		sending: marking(removing, 'accountId')
	});

	/** Which of the two sessions forms was sent last, for the one status line they share. */
	let lastSessions = $state<'revoke' | 'revokeOthers'>(
		untrack(() => (form?.action === 'revokeOthers' ? 'revokeOthers' : 'revoke'))
	);
	const revoke = saveForm({
		answer: () => (form?.action === 'revoke' ? form : undefined),
		after: 'keep',
		sending: (fields) => {
			lastSessions = 'revoke';
			return marking(ending, 'sessionId')(fields);
		}
	});
	const revokeOthers = saveForm({
		answer: () => (form?.action === 'revokeOthers' ? form : undefined),
		after: 'keep',
		sending: () => {
			sentSince = true;
			lastSessions = 'revokeOthers';
		}
	});

	interface Said {
		words: string;
		bad: boolean;
	}
	const QUIET: Said = { words: '', bad: false };

	/**
	 * What a form's status line says: the helper's own news, and failing that, once its form has
	 * been taken, `done`; and before anything has been sent, what the page arrived to say. A
	 * refusal always has a message of its own, so an answer with none is one that was taken.
	 */
	function said(
		save: { message: string; failed: boolean; busy: boolean; answer: object | undefined },
		done: string,
		arrival?: Said
	): Said {
		if (save.message) return { words: save.message, bad: save.failed };
		if (save.busy) return QUIET;
		if (save.answer) return { words: done, bad: false };
		return (!sentSince && arrival) || QUIET;
	}

	const renameRefused = $derived(rename.answer?.refused ? rename.answer : undefined);
	const emailRefused = $derived(changeEmail.answer?.refused ? changeEmail.answer : undefined);
	const passwordErrors = $derived(
		changePassword.answer?.refused ? changePassword.answer.errors : undefined
	);

	/** A button that connects a provider is sent the browser's own way: its refusal is the page. */
	const linkRefused = $derived(form?.action === 'link' && form.refused ? form : undefined);

	const renameSaid = $derived(said(rename, SAID.nameSaved));
	const emailSaid = $derived(said(changeEmail, SAID.emailAsked, data.arrival.email));
	const passwordSaid = $derived(
		data.hasPassword
			? said(changePassword, '', data.arrival.password)
			: said(setPassword, SAID.passwordLinkSent)
	);
	const connectionsSaid = $derived(
		said(
			unlink,
			SAID.disconnected,
			linkRefused ? { words: linkRefused.message ?? GENERIC, bad: true } : data.arrival.connections
		)
	);
	const deleteSaid = $derived(said(deleteAccount, SAID.deleteAsked));

	/** This browser's session, as it is now: a new password gives it a new one. */
	const current = $derived(data.sessions.find((open) => open.current));
	const open = $derived(new Set(data.sessions.map((session) => session.id)));
	const others = $derived(
		seen
			.filter((session) => !session.current)
			.map((session) => ({ ...session, ended: !open.has(session.id) }))
	);
	const newer = $derived(
		data.sessions.some(
			(session) => !session.current && !seen.some((known) => known.id === session.id)
		)
	);
	const anyOthers = $derived(data.sessions.some((session) => !session.current));
	// A session the list does not show is news that outranks the last one signed out, which the
	// list shows already. A failure, which the list cannot show, comes before it, and so does
	// what is said while a form is on its way.
	const sessionsSaid = $derived.by(() => {
		const save = lastSessions === 'revoke' ? revoke : revokeOthers;
		const words = said(save, lastSessions === 'revoke' ? SAID.sessionEnded : SAID.othersEnded);
		return newer && !words.bad && !save.busy ? { words: SAID.sessionsNewer, bad: false } : words;
	});

	/** The look of a button that is not the helper's: the quiet variant of Submit's. */
	const QUIET_BUTTON =
		'h-10 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:border-ink-subtle active:translate-y-px';
	/** A note in the place of a control, the size of the control. */
	const NOTE = 'flex h-10 items-center justify-center rounded-lg px-2 text-center text-sm';
</script>

<svelte:head>
	<title>Your account · Team Collaborator</title>
</svelte:head>

{#snippet status(said: Said)}
	<!-- Always present, and two lines tall, which holds the longest thing it can say. -->
	<p role="status" class={['mt-3 h-10 text-sm', said.bad ? 'text-bad' : 'text-ink-muted']}>
		{said.words}
	</p>
{/snippet}

{#snippet heading(id: string, title: string, about: string)}
	<div>
		<h2 {id} class="font-display text-lg font-semibold tracking-tight">{title}</h2>
		<p class="mt-1 text-sm text-pretty text-ink-muted">{about}</p>
	</div>
{/snippet}

{#snippet session(row: (typeof data.sessions)[number], state: 'current' | 'open' | 'ended')}
	<!--
		On a phone the browser's name, its address and the time each have the whole width, and the
		control stands under them: beside the name it took the room the name needed, and "Chrome on
		Windows" was cut short at 320px. On a wider window it stands beside all three.
	-->
	<li
		class={[
			'grid grid-cols-1 items-center gap-x-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem]',
			state === 'ended' && 'text-ink-subtle'
		]}
	>
		<p class="truncate font-medium">{row.device}</p>
		<p
			class={['text-sm', state !== 'ended' && 'text-ink-muted']}
			data-tip={row.address ?? undefined}
			data-tip-at="start"
		>
			<span class="block truncate">{row.address ?? 'Address not known'}</span>
		</p>
		<p class={['truncate text-sm', state !== 'ended' && 'text-ink-muted']}>
			Signed in <time datetime={row.began.iso}>{row.began.text}</time>
		</p>
		<div class="mt-2 w-32 sm:col-start-2 sm:row-span-3 sm:row-start-1 sm:mt-0">
			{#if state === 'current'}
				<p class={[NOTE, 'bg-brand-soft font-medium text-brand-text']}>This browser</p>
			{:else if state === 'ended'}
				<p class={[NOTE, 'bg-sunken']}>Signed out</p>
			{:else}
				<form method="POST" action="?/revoke" {@attach revoke.attach}>
					<input type="hidden" name="sessionId" value={row.id} />
					<Submit
						label="Sign out"
						working="Signing out"
						busy={ending[row.id] === true}
						variant="quiet"
						aria-label="Sign out {row.device}, signed in {row.began.text}"
						class="w-full"
					/>
				</form>
			{/if}
		</div>
	</li>
{/snippet}

<div class="mx-auto max-w-4xl px-6 pt-10 sm:pt-14">
	<div class="flex items-center justify-between gap-4">
		<h1 class="font-display text-2xl font-semibold tracking-tight sm:text-4xl">Your account</h1>
		<!--
			Sent the browser's own way, to the page that signs out. Without JavaScript the header's
			menu cannot be opened, and this is where such a visitor signs out.
		-->
		<form method="POST" action={resolve('/sign-out')} class="shrink-0">
			<button type="submit" class={QUIET_BUTTON}>Sign out</button>
		</form>
	</div>
	<!--
		The whole width, under the button and not beside it, where a phone had room for a few
		letters of it. One line, whatever the address: a long one is cut short, and read out whole.
	-->
	<p class="mt-2 text-ink-muted" data-tip={data.user.email} data-tip-at="start">
		<span class="block truncate">
			Signed in as <span class="font-medium text-ink">{data.user.email}</span>
		</span>
	</p>

	<section
		aria-labelledby="name-title"
		class="mt-10 grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{@render heading('name-title', 'Name', 'What your team sees you called.')}
		<form method="POST" action="?/rename" class="max-w-md" {@attach rename.attach}>
			<Field
				name="name"
				label="Name"
				faults={FAULTS.name}
				autocomplete="name"
				required
				maxlength={60}
				defaultValue={renameRefused?.values.name ?? data.user.name}
				error={renameRefused?.errors.name}
			/>
			<Submit label="Save name" working="Saving" busy={rename.busy} class="w-full sm:w-auto" />
			{@render status(renameSaid)}
		</form>
	</section>

	<section
		aria-labelledby="email-title"
		class="grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{@render heading(
			'email-title',
			'Email address',
			'A link goes to your current address first, and then one to the new address.'
		)}
		<form
			method="POST"
			action="?/changeEmail"
			class="max-w-md min-w-0"
			{@attach changeEmail.attach}
		>
			<p class="text-sm text-ink-muted">Your address now</p>
			<p class="mb-4 font-medium" data-tip={data.user.email} data-tip-at="start">
				<span class="block truncate">{data.user.email}</span>
			</p>
			<!--
				Half way through a change, the address it is to is in the field: it says where the
				second link went, and it is text in a field, which nobody can make into anything else.
			-->
			<Field
				name="email"
				label="New address"
				faults={FAULTS.email}
				type="email"
				autocomplete="email"
				inputmode="email"
				autocapitalize="none"
				spellcheck={false}
				required
				defaultValue={emailRefused?.values.email ?? data.pending}
				error={emailRefused?.errors.email}
			/>
			<Submit
				label="Change address"
				working="Sending"
				busy={changeEmail.busy}
				class="w-full sm:w-auto"
			/>
			{@render status(emailSaid)}
		</form>
	</section>

	<section
		aria-labelledby="password-title"
		class="grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{#if data.hasPassword}
			{@render heading(
				'password-title',
				'Password',
				'Changing it signs you out everywhere but here.'
			)}
			<form
				method="POST"
				action="?/changePassword"
				class="max-w-md"
				{@attach changePassword.attach}
			>
				<Field
					name="currentPassword"
					label="Current password"
					faults={FAULTS.password}
					type="password"
					autocomplete="current-password"
					required
					error={passwordErrors?.currentPassword}
				/>
				<Field
					name="newPassword"
					label="New password"
					faults={FAULTS.newPassword}
					type="password"
					autocomplete="new-password"
					required
					minlength={8}
					error={passwordErrors?.newPassword}
				/>
				<Submit
					label="Change password"
					working="Changing password"
					busy={changePassword.busy}
					class="w-full sm:w-auto"
				/>
				{@render status(passwordSaid)}
			</form>
		{:else}
			{@render heading(
				'password-title',
				'Password',
				'You sign in with a provider, so there is no password yet.'
			)}
			<!-- The link goes to the account's own address, which the action reads for itself. -->
			<form method="POST" action="?/setPassword" class="max-w-md" {@attach setPassword.attach}>
				<p class="mb-4 text-sm text-ink-muted">
					To sign in with your address as well, set one by a link we email you.
				</p>
				<Submit
					label="Email me a link to set one"
					working="Sending"
					busy={setPassword.busy}
					class="w-full sm:w-auto"
				/>
				{@render status(passwordSaid)}
			</form>
		{/if}
	</section>

	<section
		aria-labelledby="connections-title"
		class="grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{@render heading(
			'connections-title',
			'Connected accounts',
			'Sign in with any of these. Each must have the same address as this account.'
		)}
		<div class="max-w-md">
			<ul class="divide-y divide-line border-y border-line">
				{#each data.connections as connection (connection.provider)}
					{@const name = providerName(connection.provider)}
					<!--
						The control is 9rem whatever it is, so that a button becoming a note moves
						nothing, and 9rem is what "Disconnecting" needs in WebKit with the fallback
						font (104px and the button's padding). At a 320px window that leaves 92px for
						the name and its state, and 77px where the window keeps room for a scrollbar.
						So the state is in smaller type on a phone, and only a provider that is
						connected has one: "Not connected" was cut short there, and the button beside
						it, which says "Connect", has already said it. The line is there either way.
					-->
					<li class="flex h-16 items-center gap-2 sm:gap-3">
						<ProviderMark provider={connection.provider} size={20} />
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{name}</p>
							<p class="h-4 truncate text-xs text-ink-muted sm:h-5 sm:text-sm">
								{connection.accountId ? 'Connected' : ''}
							</p>
						</div>
						<div class="w-36 shrink-0">
							{#if connection.last}
								<!-- Better Auth will not remove the last way in, so no button offers to. -->
								<p class={[NOTE, 'bg-sunken text-ink-muted']}>Your only way in</p>
							{:else if connection.accountId}
								<form method="POST" action="?/unlink" {@attach unlink.attach}>
									<input type="hidden" name="accountId" value={connection.accountId} />
									<Submit
										label="Disconnect"
										working="Disconnecting"
										busy={removing[connection.accountId] === true}
										variant="quiet"
										aria-label="Disconnect {name}"
										class="w-full"
									/>
								</form>
							{:else}
								<!-- Sent the browser's own way: it leaves the site for the provider. -->
								<form method="POST" action="?/link">
									<button
										type="submit"
										name="provider"
										value={connection.provider}
										aria-label="Connect {name}"
										class={[QUIET_BUTTON, 'w-full']}
									>
										Connect
									</button>
								</form>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			{@render status(connectionsSaid)}
		</div>
	</section>

	<section
		aria-labelledby="sessions-title"
		class="grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{@render heading(
			'sessions-title',
			'Where you are signed in',
			'Each browser signed in to your account. Times are in UTC.'
		)}
		<div class="max-w-md min-w-0">
			<ul class="divide-y divide-line border-y border-line">
				{#if current}
					{@render session(current, 'current')}
				{/if}
				{#each others as other (other.id)}
					{@render session(other, other.ended ? 'ended' : 'open')}
				{/each}
			</ul>
			<div class="mt-4">
				{#if anyOthers}
					<form method="POST" action="?/revokeOthers" {@attach revokeOthers.attach}>
						<Submit
							label="Sign out everywhere else"
							working="Signing out"
							busy={revokeOthers.busy}
							variant="quiet"
							class="w-full sm:w-auto"
						/>
					</form>
				{:else}
					<!-- In the button's place once there is nothing left for it to do. -->
					<p class="flex h-10 items-center text-sm text-ink-muted">
						You are signed in nowhere else.
					</p>
				{/if}
			</div>
			{@render status(sessionsSaid)}
		</div>
	</section>

	<section
		aria-labelledby="delete-title"
		class="grid grid-cols-1 gap-x-12 gap-y-4 border-t border-line pt-8 pb-5 md:grid-cols-[14rem_minmax(0,1fr)]"
	>
		{@render heading(
			'delete-title',
			'Delete account',
			'Your account and everything in it, for good. We email you a link to confirm.'
		)}
		<form method="POST" action="?/deleteAccount" class="max-w-md" {@attach deleteAccount.attach}>
			<Submit
				label="Email me a link to delete it"
				working="Sending"
				busy={deleteAccount.busy}
				variant="quiet"
				class="w-full sm:w-auto"
			/>
			{@render status(deleteSaid)}
		</form>
	</section>
</div>
