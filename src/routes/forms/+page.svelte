<script lang="ts">
	import { SEATS } from '#lib/demo/forms/boat.js';
	import Ledger from '#lib/demo/forms/Ledger.svelte';
	import PassengerList from '#lib/demo/forms/PassengerList.svelte';
	import ServerMood from '#lib/demo/forms/ServerMood.svelte';
	import Chapter from '#lib/ui/Chapter.svelte';
	import Code from '#lib/ui/Code.svelte';
	import Demo from '#lib/ui/Demo.svelte';
	import listSource from '../../lib/demo/forms/PassengerList.svelte?highlight';
	import actionsSource from './+page.server.ts?highlight';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<Chapter
	path="/forms"
	lede="A form here is ordinary HTML that posts to the server, so it works before any JavaScript has loaded, or if none ever does. When JavaScript arrives it upgrades the same form in place, and from then on the form has to survive a slow server, a silent one and a second press. This page lets you cause each of them."
>
	<section class="prose">
		<h2>A form on a bad day</h2>
		<p>
			Below is the passenger list for a small boat, kept on the server. Every control on it is a
			form: adding a party, ticking it aboard and taking it off the list each post to a named
			action. Beside the list is the server’s own ledger of every request it acted on, and above it
			a switch that makes the server behave badly on request.
		</p>
		<p>
			The forms are sent through one helper, <code>saveForm</code>. Before this page was written the
			helper was hammered by a scripted browser: every answer a server can give, made late, lost and
			out of order, in three browser engines, with JavaScript and without. What that found is
			further down. The demo is the same hammering, for you to do by hand.
		</p>
	</section>

	<Demo title="Passenger list" note="Kept in server memory">
		<div id="bench" class="scroll-mt-28">
			<ServerMood mood={data.mood} />
			<div class="mt-6 grid gap-10 border-t border-line pt-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<PassengerList parties={data.parties} tally={data.tally} mood={data.mood} {form} />
				<Ledger ledger={data.ledger} tally={data.tally} />
			</div>
		</div>
		<p class="mt-8 border-t border-line pt-4 text-sm text-ink-subtle">
			The boat lives in the server’s memory, under an anonymous cookie, so you see only your own. It
			has {SEATS} seats, and is as it began whenever the server restarts.
		</p>
	</Demo>

	<section class="prose">
		<h2>Things to try</h2>
		<p>Start with the server answering, and watch the ledger as you go.</p>
		<ul>
			<li>
				<strong>Add a party.</strong> The button waits with the server, the row appears at the end
				of the list, and the ledger gains a line marked <strong>Enhanced</strong>: the form was sent
				in place.
			</li>
			<li>
				<strong>Add one the server turns down.</strong> Okafor is on the list already, and the boat
				has {SEATS} seats. The reason appears under the field it is about, in a line that was there
				all along. What you typed is still in the box, and the keyboard is in the first field that
				was turned down, unless you had already moved on to another.
			</li>
			<li>
				<strong>Put the skipper ashore, or take them off the list.</strong> Either change is shown
				at once, because the page assumes the server will agree. The server refuses, and the change
				is undone in front of you: an optimistic update, rolled back. Tick another row straight
				after, and the refusal is still there to read.
			</li>
			<li>
				<strong>Type a name, and leave.</strong> Follow a link to another chapter and press Back.
				What you typed is still in the box, as it would be in a browser running no JavaScript at
				all.
			</li>
			<li>
				<strong>Press <em>Hammer the ticks</em>.</strong> Your browser presses every tick but the
				skipper’s seven times in about half a second, all the rows at once. Each row sends one
				request at a time: a press made while one is on its way waits for the answer, and only the
				newest of the waiting presses is ever sent. Each asks for a state and not a flip. So the
				server hears from a row two or three times, in the order you pressed, and the last press is
				the last thing it writes: every row ends the other way up.
			</li>
		</ul>
		<p>Then change the server, and send something.</p>
		<ul>
			<li>
				<strong>Is slow.</strong> After half a second the form says so. Type the next name while you
				wait: the answer leaves it alone when it comes. Press the button again while it is busy: the
				ledger shows one request, not two.
			</li>
			<li>
				<strong>Never answers.</strong> After eight seconds the form gives up and says so, with what
				you typed still in it. Set the server back to answering and look at the ledger: the request
				did arrive, and was abandoned unwritten. A form you gave up on does not save behind your
				back.
			</li>
			<li>
				<strong>Breaks.</strong> The server’s own code throws. The form stays where it is, with a
				sentence that is safe to show and a reference to quote. The error itself is in the server’s
				log, under that reference.
			</li>
			<li>
				<strong>Holds back the list.</strong> The server saves, says so, and then never answers when
				the page asks for the list again. After eight seconds the form stops waiting and tells you
				what it knows: saved, and the page behind. Whatever you send next is not held up by it.
			</li>
			<li>
				<strong>Your own connection.</strong> Turn it off and send anything. The form says there is
				no connection, keeps what you typed, and sends it when you press again with the connection
				back.
			</li>
		</ul>
	</section>

	<section class="prose">
		<h2>Now turn JavaScript off</h2>
		<p>
			Everything above but the hammer works without JavaScript. You do not have to take that on
			trust:
		</p>
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
			<li>Use the list again, and change the server again.</li>
		</ol>
		<p>
			Every form still submits, and the ledger now says <strong>Plain post</strong>. Each submission
			is a full page load that lands back on the list, because every form’s action ends in
			<code>#passengers</code>. The switch is five links, so it works too. The rules are the same,
			because they always ran on the server, and so is the broken server: the page that comes back
			is this one, with the same sentence, a reference, and what you typed.
		</p>
		<p>
			What has gone is what JavaScript added: the waiting button, the instant tick, the page staying
			where it was, and the giving up. A browser on its own waits for a silent server for as long as
			the server keeps it.
		</p>
	</section>

	<section class="prose">
		<h2>The server: three named actions</h2>
		<p>
			A <code>+page.server.ts</code> file can export <code>actions</code> next to its
			<code>load</code> function. Each named action answers at its own address on the page,
			<code>?/add</code>, <code>?/aboard</code> and <code>?/remove</code>, and a form reaches it
			with an ordinary <code>action</code> attribute. There is no API route to write and no client
			code to keep in step with one.
		</p>
		<p>
			The three here are written with <code>saveAction</code>, the server’s half of the helper. It
			reads the posted fields against a schema. Whenever the action stops short of saving, by
			<code>refuse()</code>, by <code>error()</code> or by a fault in its own code, the helper
			answers with SvelteKit’s <code>fail()</code>, carrying the reason and everything that was
			submitted. Without JavaScript, SvelteKit renders the page again with that data in its
			<code>form</code> prop, under the failure’s status. With JavaScript, the same data comes back
			to the same form. The action does not need to know which kind of request it is answering.
		</p>
		<p>
			Two things in this file are there for the demo and would not be in yours: the server’s moods,
			and the ledger. One thing is there for any form a visitor can give up on:
			<code>stopIfAbandoned</code>, the last line before each write. Abandoning a request in the
			browser does not stop the action that is answering it. Unless the action looks, it saves after
			the visitor has been told that no answer came.
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
			the answer in <code>form</code>, reloads the page’s data and, after a success, resets the
			fields. This site attaches it through <code>saveForm</code>, in
			<code>src/lib/forms/save-form.svelte.ts</code>, which adds what a full page load cannot: a
			pending state, a word when the answer is slow or never comes, one rule for a second press, and
			an answer that always lands on the form it was for.
		</p>
		<p>
			The component below adds what only it can know. The form that adds a party ignores a second
			press and empties itself after a save. The ticks do the opposite: a second press takes the
			place of the first, and goes once the first has been answered. The optimistic part is a small
			overlay, what you asked for laid over what the server last said. When the answer arrives the
			overlay is removed. If the server agreed, nothing visible changes. If it refused, its version
			is what remains, and that is the rollback. There is no undo code, because nothing was changed
			except the overlay.
		</p>
	</section>

	<div class="max-w-3xl">
		<Code
			html={listSource}
			file="src/lib/demo/forms/PassengerList.svelte"
			collapsed="Read the form component"
		/>
	</div>

	<section class="prose">
		<h2>What the hammer found</h2>
		<p>
			The helper had passed every check made of it by hand. Hammered by script, it still had faults
			in it, and so did the list that stood on this page before this one. Each of these was measured
			going wrong, and each is closed in the code this page runs on.
		</p>
		<h3>The list, loaded again after an answer</h3>
		<ul>
			<li>
				<strong>One reload that never ended held up every reload after it.</strong> The page’s data
				is reloaded one request at a time. With the first left unanswered, the next party added was
				not on the page twelve seconds later, and never would have been. A reload is now given eight
				seconds and then left behind: the last of the server’s moods, above.
			</li>
			<li>
				<strong>A reload that failed took the form with it.</strong> With the connection cut between
				the answer and the reload, the visitor was shown an error page for a save that had worked,
				and after a refusal lost everything they had typed. The form now stays, and says that it
				saved and that the page is behind.
			</li>
			<li>
				<strong>A save the page could not show looked like a save undone.</strong> A tick the server
				had kept went back to unticked, and nothing said why. And with reloads slower than the
				ticking, every tick waited for the last.
			</li>
			<li>
				<strong>After Back, the page could be the browser’s old copy of itself.</strong> Add a
				party, leave the site, press Back. Two browsers of three showed the list as it had first
				arrived, without the party the server had. A page come back to now asks for its list again.
			</li>
		</ul>
		<h3>More than one press</h3>
		<ul>
			<li>
				<strong>The page and the server could end up disagreeing.</strong> A second press used to
				abandon the first on its way, and the server was trusted to notice. Behind a proxy that does
				not pass a browser’s hanging up on to the server, it cannot: the page said one thing and the
				server kept the other. A row now sends one request at a time.
			</li>
			<li>
				<strong>A refusal could go unsaid.</strong> Tick a second row inside the round trip of a
				refused one, and the refusal was rolled back in silence, because the second row’s save was
				the last answer and a save has nothing to say.
			</li>
			<li>
				<strong>One press could run an action seven times.</strong> With the connection dropped
				after the action had run and before its answer left, two browsers of three sent the post
				again by themselves, six times more. Every send now carries a key, and the server saves once
				for a key. So the helper can try again by itself, and “send it again” cannot save twice.
			</li>
			<li>
				<strong>A double-click on a cross removed two rows.</strong> The row left the page at the
				first click, the next row moved up under the pointer, and the second click landed on it.
			</li>
		</ul>
		<h3>What was typed, and where the keyboard was</h3>
		<ul>
			<li>
				<strong>An answer took the keyboard from a visitor in mid-word.</strong> Start on the second
				field while the form is on its way, and the answer moved focus back to the first: the rest
				of the word went into the wrong box.
			</li>
			<li>
				<strong>With JavaScript, leaving the page lost what was typed.</strong> Type half a form,
				follow a link, press Back. Without JavaScript the browser had kept every word, and with it
				the form came back empty. It is kept now, either way.
			</li>
			<li>
				<strong>A late redirect took the visitor.</strong> Send a form whose action redirects,
				follow a link while it is on its way, and the answer pulled you back when it came.
			</li>
			<li>
				<strong>Without JavaScript, text over a limit came back cut.</strong> It was turned down,
				shortened on its way back to the page, and saved in its shortened form by the next press. It
				now comes back whole.
			</li>
			<li>
				<strong>Without JavaScript, a refused tick said nothing you could see.</strong> The page
				that answered landed on the list with the reason below the foot of the window. The line now
				sits above the list.
			</li>
		</ul>
		<h3>What was said, and what was recorded</h3>
		<ul>
			<li>
				<strong>“Send it again” for a save that had been made.</strong> When an answer was lost on
				its way back, the form spoke as if nothing had been saved. It now says that it may have
				been.
			</li>
			<li>
				<strong>Visitors on record as faults.</strong> A visitor who gave up half way through
				sending, one whose connection dropped, and a request that was not a form at all were each
				recorded as an unexpected error in the site’s code.
			</li>
			<li>
				<strong>A page that stopped answering after Back.</strong> In the test build of Safari’s
				engine, once the cross-fade between pages had run, coming Back to this page could leave it
				dead. It was not the form’s doing, and it was the form’s visitor who found it. Safari’s
				engine now gets a hard cut between pages.
			</li>
			<li>
				<strong>An answer in the shape of a result.</strong> An error written as JSON by something
				in front of the server could be taken for an action’s own answer, and one of them put the
				error page in place of the form.
			</li>
		</ul>
	</section>

	<section class="prose">
		<h2>What it costs</h2>
		<p>
			Progressive enhancement is not automatic. SvelteKit makes the mechanics short, but the design
			work is still yours.
		</p>
		<ul>
			<li>
				<strong>You design the version without JavaScript first.</strong> Every control that changes
				data has to be a real form with a real submit button. The ticks on this list are buttons
				inside forms, not checkboxes, because a checkbox cannot send anything to the server on its
				own.
			</li>
			<li>
				<strong>Some interactions have no HTML equivalent.</strong> Drag-and-drop reordering, search
				as you type, and anything else that reacts to each keystroke needs JavaScript. So does the
				hammer on this page. Without it you offer a plainer alternative, or the feature is not
				there.
			</li>
			<li>
				<strong>A plain post is a full page load.</strong> It returns to the top of the page unless
				the form says where to land, the address bar keeps <code>?/add</code>, and reloading offers
				to send the form again. Redirecting after a successful post fixes the last two, at the cost
				of the data the action returned.
			</li>
			<li>
				<strong>A bare <code>use:enhance</code> is a start, not a finish.</strong> Measured on this
				site before the helper existed: a post that was never answered showed nothing at all, an
				action that failed replaced the form with an error page, three quick saves could leave the
				page and the server disagreeing, and every submission dropped the page’s query string from
				the address. Each has a few lines of answer. Someone has to know to write them, once, in one
				place, and then someone has to try to break them.
			</li>
			<li>
				<strong>The memory that stops a press saving twice is one server’s.</strong> A browser sends
				a post again by itself when its connection fails before any answer has come. The server
				knows the repeat by its key, but it remembers in its own memory. Run two servers, or restart
				one at the wrong moment, and a repeat can get past. Where that matters an action has to be
				safe by itself: the ticks here ask for a state and not a flip, and a name already on the
				list is turned down.
			</li>
			<li>
				<strong>Every change is a round trip.</strong> The server holds the truth, which is what
				makes the path without JavaScript possible. An app that has to keep working offline needs a
				different design.
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
			And servers do not always answer. You write the server logic once, and the enhancement is
			attached to a form that already worked. What it owes the visitor after that is the truth about
			what happened to what they sent, on the form they sent it from.
		</p>
	</section>
</Chapter>
