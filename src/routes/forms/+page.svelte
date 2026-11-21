<script lang="ts">
	import PackingList from '#lib/demo/forms/PackingList.svelte';
	import { MAX_ITEMS, MAX_TEXT } from '#lib/demo/forms/packing.js';
	import SubmissionLog from '#lib/demo/forms/SubmissionLog.svelte';
	import Chapter from '#lib/ui/Chapter.svelte';
	import Code from '#lib/ui/Code.svelte';
	import Demo from '#lib/ui/Demo.svelte';
	import listSource from '../../lib/demo/forms/PackingList.svelte?highlight';
	import type { PageProps } from './$types';
	import actionsSource from './+page.server.ts?highlight';

	let { data, form }: PageProps = $props();
</script>

<Chapter
	path="/forms"
	lede="A form here is ordinary HTML that posts to the server, so it works before any JavaScript has loaded, or if none ever does. When JavaScript arrives, it upgrades the same form in place."
>
	<section class="prose">
		<h2>A list you can change</h2>
		<p>
			Below is a packing list kept on the server. Every control on it is a form: adding an item,
			ticking it off and removing it each post to a named action. Try these:
		</p>
		<ul>
			<li>
				<strong>Add something.</strong> The server waits 600 ms before it answers, on purpose, so you
				can watch the button wait with it.
			</li>
			<li>
				<strong>Add something already on the list</strong>, or only spaces. The error appears in a
				line under the field that was there all along, and what you typed is still in the box.
			</li>
			<li>
				<strong>Tick the kitchen sink.</strong> It ticks at once, because the page assumes the server
				will agree. The server refuses, and the tick is undone in front of you: an optimistic update,
				rolled back.
			</li>
			<li>
				<strong>Watch the log.</strong> The server records how each submission arrived: through
				<code>use:enhance</code>, or as a plain form post.
			</li>
		</ul>
	</section>

	<Demo title="Packing list" note="Kept in server memory">
		<div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<PackingList items={data.items} {form} />
			<SubmissionLog log={data.log} />
		</div>
		<p class="mt-8 border-t border-line pt-4 text-sm text-ink-subtle">
			This list lives in the server's memory, under an anonymous cookie, so you see only your own.
			It holds up to {MAX_ITEMS} items of up to {MAX_TEXT} characters, and starts again whenever the server
			restarts.
		</p>
	</Demo>

	<section class="prose">
		<h2>Now turn JavaScript off</h2>
		<p>Everything above works without JavaScript. You do not have to take that on trust:</p>
		<ol>
			<li>
				In Chrome or Edge, open the developer tools, press <code>Ctrl+Shift+P</code>
				(<code>⌘⇧P</code> on a Mac), type <strong>Disable JavaScript</strong> and press Enter. It
				stays off while the developer tools are open. In Firefox, open <code>about:config</code> and
				set <code>javascript.enabled</code> to <code>false</code>, and remember to set it back.
			</li>
			<li>
				Reload the page. The readout at the bottom of the screen now says that no JavaScript is
				running.
			</li>
			<li>Use the list again.</li>
		</ol>
		<p>
			Every form still submits, and the log now says <strong>Plain post</strong>. Each submission is
			a full page load that lands back on the list, because every form's action ends in
			<code>#packing-list</code>. Validation behaves exactly as before, because it always ran on the
			server. What has gone is what JavaScript added: the waiting button, the instant tick, and the
			page staying where it was.
		</p>
	</section>

	<section class="prose">
		<h2>The server: three named actions</h2>
		<p>
			A <code>+page.server.ts</code> file can export <code>actions</code> next to its
			<code>load</code> function. Each named action answers at its own address on the page,
			<code>?/add</code>, <code>?/toggle</code> and <code>?/delete</code>, and a form reaches it
			with an ordinary <code>action</code> attribute. There is no API route to write and no client code
			to keep in step with one.
		</p>
		<p>
			When validation fails, the action returns <code>fail(400, …)</code> with the messages and the
			values that were submitted. Without JavaScript, SvelteKit renders the page again with that
			data in its <code>form</code> prop, under a 400 status. With JavaScript, the same data arrives
			in the same prop. The action does not need to know which kind of request it is answering. This
			one checks anyway, for the log: <code>use:enhance</code> sends an
			<code>x-sveltekit-action</code> header that a plain form post does not.
		</p>
	</section>

	<div class="max-w-3xl">
		<Code html={actionsSource} file="src/routes/forms/+page.server.ts" />
	</div>

	<section class="prose">
		<h2>The form: one element, upgraded in place</h2>
		<p>
			<code>use:enhance</code> attaches to a <code>&lt;form&gt;</code> that already works. With no
			arguments it does what the browser would have done, minus the reload: it sends the form, puts
			the answer in <code>form</code>, reloads the page's data and, after a success, resets the
			fields. The component below passes it a function, to add what a full page load cannot: a
			pending state, an optimistic tick, and a sensible place for keyboard focus afterwards.
		</p>
		<p>
			The optimistic part is a small overlay: what you asked for, laid over what the server last
			said. When the answer arrives, the overlay is removed. If the server agreed, nothing visible
			changes. If it refused, its version is what remains, and that is the rollback. There is no
			undo code, because nothing was changed except the overlay.
		</p>
	</section>

	<div class="max-w-3xl">
		<Code
			html={listSource}
			file="src/lib/demo/forms/PackingList.svelte"
			collapsed="Read the form component"
		/>
	</div>

	<section class="prose">
		<h2>What it costs</h2>
		<p>
			Progressive enhancement is not automatic. SvelteKit makes the mechanics short, but the design
			work is still yours.
		</p>
		<ul>
			<li>
				<strong>You design the version without JavaScript first.</strong> Every control that changes data
				has to be a real form with a real submit button. The ticks on this list are buttons inside forms,
				not checkboxes, because a checkbox cannot send anything to the server on its own.
			</li>
			<li>
				<strong>Some interactions have no HTML equivalent.</strong> Drag-and-drop reordering, search as
				you type, and anything else that reacts to each keystroke needs JavaScript. Without it you offer
				a plainer alternative, such as up and down buttons, or the feature is not there.
			</li>
			<li>
				<strong>A plain post is a full page load.</strong> It returns to the top of the page unless
				the form says where to land, the address bar keeps <code>?/add</code>, and reloading offers
				to send the form again. Redirecting after a successful post fixes the last two, at the cost
				of the data the action returned.
			</li>
			<li>
				<strong>The optimistic code is yours.</strong> <code>use:enhance</code> gives you two moments
				to work with: before the request and after the answer. What to show in between, what a second
				click means before the first is answered, and where focus goes when a row disappears are ordinary
				application decisions.
			</li>
			<li>
				<strong>Every change is a round trip.</strong> The server holds the truth, which is what makes
				the path without JavaScript possible. An app that has to keep working offline needs a different
				design.
			</li>
		</ul>
	</section>

	<section class="prose">
		<h2>Why this matters</h2>
		<p>
			JavaScript does not always arrive. A slow connection may not have finished downloading it, an
			extension can break it, and an error elsewhere on the page can stop it. A form that is HTML
			first still submits in every one of those cases, and when everything works it behaves like any
			modern application.
		</p>
		<p>
			You write the server logic once. The enhancement is a few lines around a form that already
			worked, and it can be added, changed or removed without touching the server at all.
		</p>
	</section>
</Chapter>
