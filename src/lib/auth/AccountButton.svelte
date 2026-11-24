<!--
	The account control at the end of the header: a way to sign in for a visitor who is signed out,
	and an avatar that opens a small menu for one who is signed in.

	Like the theme switch and the accent picker beside it, which one shows is not decided by any
	script here. Most pages are built once and served to everybody, so the server's HTML cannot
	know, and anything drawn from component state would be wrong on arrival and put right after
	hydration: the signed-in avatar flashing in over the sign-in link. Instead all the controls
	are in the server's HTML, in one place and at one size, and CSS shows one of them by
	`data-signed-in` on <html>, which the boot script in app.html sets before the first frame from
	the marker cookie (src/lib/auth/marker.ts).

	There are three controls, because there are three things the page can know:

	- "no": a link to the sign-in page, which carries the page to come back to.
	- "yes": the avatar. It opens the menu, a native popover like the accent palette: the browser
	  opens it, closes it on Escape or a press outside, and returns focus, and CSS anchor
	  positioning puts it under the button.
	- Nothing said, which is a browser without JavaScript: a link to the account page. The server
	  is the one that knows there, and answers with the account, or with the sign-in page for a
	  visitor who is signed out. Unknown is shown as a control that is right either way, and not
	  as a guess.

	All three are the same 36px circle, drawn as the accent button beside them is, so the header is
	the same width whoever is looking. Signed in, the person stands on a disc of the accent colour:
	the theme switch's way of showing which of its options is on, used here to say the same of
	the account. Until profiles exist it is the same person for everyone: a picture from a
	provider would be a request to another site, which the content security policy does not
	allow, and should not.

	Each says what it is in the site's tooltip (`data-tip`, in src/routes/layout.css), lined up
	with its far edge: it is the last thing in the header, and under its middle the tooltip would
	run past the window on a phone.

	The menu's name and address are the one thing here that script fetches (./who.svelte.ts, from
	src/routes/account/who/+server.ts). Their
	two lines are in the menu from the start, each with a placeholder in the cell the text will
	take, so the text arriving moves nothing.
-->
<script lang="ts">
	import UserRound from '@lucide/svelte/icons/user-round';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { nextQuery } from './next.js';
	import { account } from './who.svelte.js';

	// The page to come back to after signing in: this one. Its path only, which is all a page
	// that is built ahead of time can know of its own address. It is the site's own path and
	// needs no checking here: the server checks whatever arrives as `next`, whoever wrote it.
	const next = $derived(nextQuery(page.url.pathname));

	const control =
		'size-[calc(2.125rem+2px)] shrink-0 place-items-center rounded-full border border-brand/25 bg-brand-soft text-brand-text hover:text-ink';
</script>

<a
	href="{resolve('/(auth)/[mode=authMode]', { mode: 'sign-in' })}{next}"
	data-tip="Sign in"
	data-tip-at="end"
	class={['signed-out', control]}
>
	<UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
	<span class="sr-only">Sign in</span>
</a>

<button
	type="button"
	popovertarget="account-menu"
	data-tip="Your account"
	data-tip-at="end"
	onpointerenter={account.ask}
	onfocus={account.ask}
	class={['signed-in trigger', control]}
>
	<!-- The disc is the size of the theme switch's thumb, and has its shadow. -->
	<span class="lit grid size-6.5 place-items-center rounded-full bg-brand text-brand-ink">
		<UserRound size={14} strokeWidth={2} aria-hidden="true" />
	</span>
	<span class="sr-only">Your account</span>
</button>

<noscript>
	<a href={resolve('/account')} data-tip="Your account" data-tip-at="end" class={['grid', control]}>
		<UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
		<span class="sr-only">Your account, or sign in</span>
	</a>
</noscript>

<!-- `ontoggle` as well: a menu opened by touch was never pointed at first. -->
<div
	id="account-menu"
	popover
	ontoggle={account.ask}
	class="menu w-64 rounded-xl border border-line bg-surface p-1.5 text-sm text-ink"
>
	<!-- Two lines, there from the start. Each holds its text and a placeholder in one cell. -->
	<div aria-busy={!account.who} class="px-2.5 pt-1.5 pb-2">
		<p class="grid h-5 font-medium">
			<span class={['value truncate [grid-area:1/1]', account.who && 'shown']}>
				{account.who?.name ?? ''}
			</span>
			<span
				aria-hidden="true"
				class={['loader flex items-center [grid-area:1/1]', account.who && 'gone']}
			>
				<span class="pulse h-2 w-24 rounded-full bg-line-strong"></span>
			</span>
		</p>
		<p class="grid h-5 text-ink-muted">
			<span class={['value truncate [grid-area:1/1]', account.who && 'shown']}>
				{account.who?.email ?? ''}
			</span>
			<span
				aria-hidden="true"
				class={['loader flex items-center [grid-area:1/1]', account.who && 'gone']}
			>
				<span class="pulse h-2 w-36 rounded-full bg-line-strong"></span>
			</span>
		</p>
	</div>
	<div class="border-t border-line pt-1.5">
		<a
			href={resolve('/account')}
			class="flex h-9 items-center rounded-lg px-2.5 font-medium hover:bg-sunken"
		>
			Account
		</a>
		<!-- A plain form, sent the browser's own way: signing out is a page load either way. -->
		<form method="POST" action={resolve('/sign-out')}>
			<button
				type="submit"
				class="flex h-9 w-full items-center rounded-lg px-2.5 text-left font-medium hover:bg-sunken"
			>
				Sign out
			</button>
		</form>
	</div>
</div>

<style>
	/*
	 * One of the three shows. The two below are hidden until the boot script has said which, and
	 * that is before the first frame, so neither is ever seen arriving. The third is in a
	 * <noscript>, which a browser that runs the script does not render at all.
	 */
	.signed-out,
	.signed-in {
		display: none;
	}

	:global(:root[data-signed-in='no']) .signed-out,
	:global(:root[data-signed-in='yes']) .signed-in {
		display: grid;
	}

	.trigger {
		anchor-name: --account-trigger;
	}

	.lit {
		box-shadow: 0 1px 3px oklch(0 0 0 / 0.25);
	}

	/* Below the button, its right edge under the button's, as the accent palette is. */
	@supports (position-area: bottom) {
		.menu {
			position-anchor: --account-trigger;
			position-area: bottom span-left;
			margin: 0.5rem 0 0;
		}
	}

	.menu {
		box-shadow:
			0 10px 24px -6px oklch(0 0 0 / 0.18),
			0 2px 6px oklch(0 0 0 / 0.08);
	}

	/* The text fades in over its placeholder as that fades out: opacity only, so nothing moves. */
	.value {
		opacity: 0;
		transition: opacity 200ms ease-out;
	}

	.value.shown {
		opacity: 1;
	}

	.loader {
		transition: opacity 200ms ease-out;
	}

	.loader.gone {
		opacity: 0;
	}

	/* A few pulses and then still, so that an answer that never comes is not promised for ever. */
	.pulse {
		animation: skeleton-pulse 1.6s ease-in-out 4;
	}
</style>
