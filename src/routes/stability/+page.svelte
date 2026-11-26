<script lang="ts">
	import ShiftDemo from '#lib/demo/stability/ShiftDemo.svelte';
	import Chapter from '#lib/ui/Chapter.svelte';
	import Code from '#lib/ui/Code.svelte';
	import Demo from '#lib/ui/Demo.svelte';
	import { resolve } from '$app/paths';
	import reservedSource from '../../lib/demo/stability/Reserved.svelte?highlight';
	import unreservedSource from '../../lib/demo/stability/Unreserved.svelte?highlight';
	import hydrationSource from '../../lib/stable/hydration.svelte.ts?highlight';
	import reserveSource from '../../lib/stable/Reserve.svelte?highlight';
	import reservationSource from '../../lib/stable/reservation.ts?highlight';
	import streamedSource from '../../lib/stable/Streamed.svelte?highlight';

	// Deliberately not a page. `resolve` only accepts addresses that exist, so this one is built by
	// hand, and marked `rel="external"` where it is used so that the build does not follow it.
	const missingPage = `${resolve('/')}no-page-lives-here`;
</script>

<Chapter
	path="/stability"
	lede="Text that jumps when a font loads. A button that moves as you reach for it. A flash of the wrong theme. This site does none of it, on any page, and that is enforced rather than hoped for."
>
	<section class="prose">
		<h2>Break it on purpose</h2>
		<p>
			Both panels below receive the same notice, late. One has nowhere to put it. The other had its
			space set aside before the notice existed. Deliver it, and watch the sentence underneath.
		</p>
	</section>

	<Demo title="Late content, with and without a reservation" note="Measured in your browser">
		<ShiftDemo />
	</Demo>

	<section class="prose">
		<p>
			Now look at the readout pinned to the bottom of the screen. If your browser can measure layout
			shift, the figure is no longer zero: you made this page move, and it was recorded. Reload to
			clear it. That readout is not decoration, and it does not grade itself kindly.
		</p>
		<p>The two components differ by a few lines. These are the files that just ran:</p>
	</section>

	<div class="grid gap-4 lg:grid-cols-2">
		<Code html={unreservedSource} file="src/lib/demo/stability/Unreserved.svelte" />
		<Code html={reservedSource} file="src/lib/demo/stability/Reserved.svelte" />
	</div>

	<section class="prose">
		<h2>Rule one: the server's HTML is the final answer</h2>
		<p>
			Most flicker comes from the browser disagreeing with the server. The server renders one thing,
			the client's first render produces another, and the page corrects itself in front of you. So
			the first rule is that the first client render must reproduce the server's HTML exactly.
		</p>
		<p>
			Anything the server cannot know, such as a stored preference, the size of the window or the
			local time, waits for a single flag. It is false on the server and during hydration, and true
			from then on.
		</p>
	</section>

	<div class="max-w-3xl">
		<Code html={hydrationSource} file="src/lib/stable/hydration.svelte.ts" />
	</div>

	<section class="prose">
		<p>Two things that usually flicker are handled before any of that:</p>
		<ul>
			<li>
				<strong>The theme.</strong> A stored choice is applied by a few lines of inline script in
				the document head, before first paint. Which option looks selected is derived in CSS from
				one attribute, not rendered from component state, so the control is correct in the HTML and
				works on pages that ship no JavaScript.
			</li>
			<li>
				<strong>The font.</strong> Inter is declared
				<code>font-display: optional</code>, and the same inline script asks for it and settles the
				rest: if Inter has loaded when the first frame is drawn, it is used, and if it has not, it
				is out of the running until the next page load. Either way the font you start with is the
				font you keep. The fallback is Arial reshaped to Inter's measurements, so running text takes
				up about the same room in both.
			</li>
		</ul>
	</section>

	<section class="prose">
		<h2>Rule two: late content gets its space first</h2>
		<p>
			Some content has to arrive after the page: slow data streamed from the server, or something
			only the browser can produce. It is rendered inside a box whose size is set by the box, never
			by its contents. The placeholder and the real thing take up the same space, so swapping them
			moves nothing.
		</p>
	</section>

	<div class="grid gap-4 lg:grid-cols-2">
		<Code html={reserveSource} file="src/lib/stable/Reserve.svelte" />
		<Code html={streamedSource} file="src/lib/stable/Streamed.svelte" />
	</div>

	<section class="prose">
		<p>
			An image is late content too, and the most common kind. Every image on this site goes through
			one component, which sizes the image's box from its dimensions before any of the file has
			arrived. For a file in the repository the build reads the dimensions itself. For an image
			known only by its address, the component will not compile without them. A test fails on an
			<code>&lt;img&gt;</code> written anywhere else.
			<a href={resolve('/stability/images')}>See the images hold their place</a>.
		</p>
	</section>

	<section class="prose">
		<h2>Rule three: it is enforced</h2>
		<p>
			Rules that depend on everyone remembering them do not last. These are checked twice: once
			while you write the code, and once before it ships.
		</p>
		<p>
			In development, every reserved box watches itself. If its height changes while its width has
			not, the content did not fit the reservation, and the console says so at once, naming the
			element. In production that code is compiled away.
		</p>
	</section>

	<div class="max-w-3xl">
		<Code html={reservationSource} file="src/lib/stable/reservation.ts" />
	</div>

	<section class="prose">
		<h2>When a page fails</h2>
		<p>
			A failure is still a page, and it is held to the same rules. Follow a link to
			<a href={missingPage} rel="external">an address with nothing behind it</a>, or to
			<a href={resolve('/stability/failure')}>a page whose server code throws</a>. Either way the
			navigation, the theme and the readout stay where they were, the response carries the right
			status, and nothing shifts.
		</p>
		<p>
			The second page fails on purpose, every time. What it throws is written to the server's log
			under a reference. What you are shown is one fixed sentence and that reference, because an
			error's own message is written for developers and can say more than a visitor should read.
		</p>
	</section>

	<section class="prose">
		<h2>What this does not do</h2>
		<ul>
			<li>
				<strong>The font choice has a price.</strong> A first visit may be read in the fallback font
				until the next page load. Chromium holds its first frame back a moment for the font, and the
				page only asks it to when the server is close enough for the font to arrive in that moment,
				so there it takes a slow or distant connection. Firefox does not wait, so there it is most
				first visits. That is the trade: a plainer typeface for one visit, in exchange for text that
				never jumps.
			</li>
			<li>
				<strong>Layout shift is measured in Chromium only.</strong> No other browser reports it to a
				page, so elsewhere the readout leaves that cell out rather than show a zero it cannot stand
				behind.
			</li>
			<li>
				<strong>Your own clicks are exempt, in the readout.</strong> By the metric's definition,
				movement within half a second of your input does not count. The demo above waits a little
				longer than that on purpose.
			</li>
			<li>
				<strong>It cannot stop a mistake being written.</strong> It can only catch one. A box given
				a minimum height instead of a fixed one will still grow. The development warning is there
				for that.
			</li>
			<li>
				<strong>Development is not the reference.</strong> Run this site with its development server
				and the readout can show a tiny shift now and then, for the reason just described.
			</li>
			<li>
				<strong>Embeds and video are untested here.</strong> This site has none. The rule for them
				is the one for images, a box sized before the content arrives, but nothing on this site
				proves it. Nor does the image component reach an image set as a CSS background, or one
				inside HTML that arrives as a string.
			</li>
		</ul>
	</section>

	<section class="prose">
		<h2>How much of this is SvelteKit?</h2>
		<p>
			Less than you might hope, and that is worth saying plainly. Most of it is discipline that
			would work in any framework. What SvelteKit contributes is that the discipline is cheap. Pages
			are server-rendered by default. A promise returned from a load function streams into the
			response with no extra machinery. Rendering mode is a per-page switch. And the components are
			small: the whole mechanism, guard and image component included, is under three hundred lines
			with its comments, and most of it is printed on this page.
		</p>
	</section>
</Chapter>
