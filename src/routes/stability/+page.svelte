<script lang="ts">
	import { resolve } from '$app/paths';
	import ShiftDemo from '#lib/demo/stability/ShiftDemo.svelte';
	import Chapter from '#lib/ui/Chapter.svelte';
	import Code from '#lib/ui/Code.svelte';
	import Demo from '#lib/ui/Demo.svelte';
	import auditSource from '../../../e2e/stability.e2e.ts?highlight';
	import reservedSource from '../../lib/demo/stability/Reserved.svelte?highlight';
	import unreservedSource from '../../lib/demo/stability/Unreserved.svelte?highlight';
	import hydrationSource from '../../lib/stable/hydration.svelte.ts?highlight';
	import reservationSource from '../../lib/stable/reservation.ts?highlight';
	import reserveSource from '../../lib/stable/Reserve.svelte?highlight';
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
				<strong>The theme.</strong> A stored choice is applied by a few lines of inline script in the
				document head, before first paint. Which option looks selected is derived in CSS from one attribute,
				not rendered from component state, so the control is correct in the HTML and works on pages that
				ship no JavaScript.
			</li>
			<li>
				<strong>The font.</strong> Inter is preloaded and declared
				<code>font-display: optional</code>, and the same inline script settles the rest: if Inter
				has loaded when the first frame is drawn, it is used, and if it has not, it is out of the
				running until the next page load. Either way the font you start with is the font you keep.
				The fallback is Arial reshaped to Inter's measurements, so running text takes up about the
				same room in both.
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
			known only by its address, the component will not compile without them. A lint rule rejects an <code>
				&lt;img&gt;
			</code>
			written anywhere else.
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
		<p>
			Before shipping, an audit visits every page in a real browser. It finds the pages by reading
			the routes folder, so a new page is covered the moment its file exists. Each page must pass
			five checks:
		</p>
		<ol>
			<li>Nothing moves after first paint, on a fast machine.</li>
			<li>
				Nothing moves on a slow one: a phone-sized screen, the processor slowed fourfold, the font
				delayed by a second and a half, every image by a second, and the scripts held back to
				stretch the gap before hydration. Each image is then scrolled into view, so that the ones
				loaded lazily are judged too.
			</li>
			<li>
				Hydration and late images leave the page as the server painted it. The app's JavaScript and
				every image are held back while each element's position, size and text is recorded, then
				released, and everything is recorded again on the same page load. The two must match. Only
				the contents of reserved boxes may differ.
			</li>
			<li>
				Reached by a link from another page, which is how most pages are reached, nothing moves once
				the new page's first frame has been drawn. Every movement after that frame counts, including
				the half second after a click that the standard metric forgives.
			</li>
			<li>
				Reached that way, every element is measured in that first frame and again once the page has
				settled, late data and images included. The two must match.
			</li>
		</ol>
		<p>
			Checks one, two and four read the browser's own report of what moved, and only Chromium makes
			one. Checks three and five are measurements, which any browser can take, so they run in
			Firefox and WebKit as well.
		</p>
	</section>

	<div class="max-w-3xl">
		<Code html={auditSource} file="e2e/stability.e2e.ts" collapsed="Read the audit" />
	</div>

	<section class="prose">
		<h2>It caught its own author, four times</h2>
		<p>
			The first time the audit ran against the readout at the bottom of this page, the readout
			failed. Its cells were sized by their contents, so each time a number updated, its neighbours
			slid sideways by a fraction of a pixel. It was causing the layout shift it was reporting. It
			now sits on a fixed grid.
		</p>
		<p>
			The development warning was wrong at first too. A deliberately broken page, written to confirm
			that each check can actually fail, showed the warning staying silent. It was taking its first
			measurement a frame late, after the late content had already landed. A check that has never
			been seen to fail is not yet a check.
		</p>
		<p>
			And once, measuring stopped a fix that was not needed. In development the readout showed a
			faint shift as the font loaded, so a gate was written to control the moment the font could
			appear. Then the same test was run against a production build, with the font held back by
			anything from nothing to 600 milliseconds: no shift in any case, with the gate or without it.
			The development server had been re-inserting the stylesheet after load and causing the
			movement itself. The gate was deleted.
		</p>
		<p>
			That was right for the one browser it was measured in. Run in Firefox and WebKit for the first
			time, the audit's measurements showed what Chromium never does. Firefox laid the text out a
			second time, about a tenth of a second after first paint, on every first visit. WebKit kept
			the fallback after a slow start, then swapped Inter in at the next click on a link, under the
			reader. A smaller rule replaced the gate: the font is decided once, when the first frame is
			drawn, and stays decided for the visit. A result measured in one browser is a result about one
			browser.
		</p>
	</section>

	<section class="prose">
		<h2>When a page fails</h2>
		<p>
			A failure is still a page, and it is held to the same rules. Follow a link to
			<a href={missingPage} rel="external">an address with nothing behind it</a>, or to
			<a href={resolve('/stability/failure')}>a page whose server code throws</a>. Either way the
			navigation, the theme and the readout stay where they were, the response carries the right
			status, and nothing shifts. Both are in the audit.
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
				<strong>The font choice has a price.</strong> A first visit may be read in the fallback font until
				the next page load. Chromium holds its first frame back a moment for a preloaded font, so there
				it takes a slow connection. Firefox does not wait, so there it is most first visits. That is the
				trade: a plainer typeface for one visit, in exchange for text that never jumps.
			</li>
			<li>
				<strong>Layout shift is measured in Chromium only.</strong> No other browser reports it to a page,
				so elsewhere the readout leaves that cell out rather than show a zero it cannot stand behind,
				and three of the audit's five checks run in Chromium alone. A pass in Firefox or WebKit says that
				everything was where it should be each time it was measured. It cannot say that nothing moved
				in between.
			</li>
			<li>
				<strong>The WebKit is not a Mac's.</strong> The audit runs the WebKit build that ships with its
				test tool. It shares Safari's engine but not its fonts or its platform, and nothing here has been
				checked on an iPhone or a Mac.
			</li>
			<li>
				<strong>Your own clicks are exempt, in the readout.</strong> By the metric's definition, movement
				within half a second of your input does not count. The demo above waits a little longer than that
				on purpose. The audit does not allow itself the same excuse when it follows a link.
			</li>
			<li>
				<strong>It cannot stop a mistake being written.</strong> It can only catch one. A box given a
				minimum height instead of a fixed one will still grow. The warning and the audit are there for
				that.
			</li>
			<li>
				<strong>Development is not the reference.</strong> Run this site with its development server and
				the readout can show a tiny shift now and then, for the reason just described. The audit measures
				the production build, because that is what visitors get.
			</li>
			<li>
				<strong>Embeds and video are untested here.</strong> This site has none. The rule for them is
				the one for images, a box sized before the content arrives, but nothing on this site proves it.
				Nor does the image component reach an image set as a CSS background, or one inside HTML that arrives
				as a string.
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
