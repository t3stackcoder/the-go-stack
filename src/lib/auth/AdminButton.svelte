<!--
	The way into the admin area, in the header beside the account control, for someone whose role
	lets them open it.

	Shown the way the account control is, and for the same reason: most pages are built once for
	everybody, so no script here can decide it without the button flashing in after hydration.
	It is in every page's HTML, hidden, and CSS shows it by `data-admin` on <html>, which the boot
	script in app.html sets before the first frame from the marker cookie (./marker.ts).

	It is a hint and not a lock. Anyone can set the cookie by hand and see the button; what is
	behind it checks the role on the server (src/lib/server/auth/access.ts). A browser without
	JavaScript never shows it, and an administrator there reaches /admin by its address.

	The same 36px circle as the controls beside it, so the header grows by exactly one of them and
	a gap, which the root layout makes room for.
-->
<script lang="ts">
	import ShieldUser from '@lucide/svelte/icons/shield-user';
	import { resolve } from '$app/paths';
</script>

<a
	href={resolve('/admin')}
	data-tip="Admin"
	class="admin size-[calc(2.125rem+2px)] shrink-0 place-items-center rounded-full border border-brand/25 bg-brand-soft text-brand-text hover:text-ink"
>
	<ShieldUser size={16} strokeWidth={1.75} aria-hidden="true" />
	<span class="sr-only">Admin</span>
</a>

<style>
	.admin {
		display: none;
	}

	:global(:root[data-admin]) .admin {
		display: grid;
	}
</style>
