<script lang="ts">
	import BasketSummary from '#lib/demo/reactivity/BasketSummary.svelte';
	import BillSplit from '#lib/demo/reactivity/BillSplit.svelte';
	import HeatmapDemo from '#lib/demo/reactivity/HeatmapDemo.svelte';
	import Shelf from '#lib/demo/reactivity/Shelf.svelte';
	import Chapter from '#lib/ui/Chapter.svelte';
	import Code from '#lib/ui/Code.svelte';
	import Demo from '#lib/ui/Demo.svelte';
	import summarySource from '../../lib/demo/reactivity/BasketSummary.svelte?highlight';
	import billSource from '../../lib/demo/reactivity/BillSplit.svelte?highlight';
	import basketSource from '../../lib/demo/reactivity/basket.svelte.ts?highlight';
	import heatmapSource from '../../lib/demo/reactivity/Heatmap.svelte?highlight';
	import measureSource from '../../lib/demo/reactivity/measure.ts?highlight';
	import shelfSource from '../../lib/demo/reactivity/Shelf.svelte?highlight';
</script>

<Chapter
	path="/reactivity"
	lede="In Svelte 5, state is a variable and a derived value is an expression. The compiler turns both into updates that touch only the part of the page that changed."
>
	<section class="prose">
		<h2>State is a variable</h2>
		<p>
			Svelte 5 marks reactive values with <strong>runes</strong>: <code>$state</code> declares a
			piece of state, and <code>$derived</code> declares a value computed from other state. They
			look like function calls, but they are instructions to the compiler. What they give you is
			used like any other variable: read it, assign to it, increment it.
		</p>
		<p>
			The calculator below is the whole component, and its source beside it is the file that is
			running.
		</p>
	</section>

	<div class="grid items-start gap-6 lg:grid-cols-2">
		<div class="space-y-6">
			<Demo title="Split the bill" note="3 × $state, 2 × $derived">
				<BillSplit />
			</Demo>

			<dl class="prose space-y-5 px-1">
				<div>
					<dt class="font-semibold">No setter</dt>
					<dd>
						<p>
							<code>bind:value</code> assigns to <code>bill</code>, and that assignment is the
							update. In an event handler you would write <code>people += 1</code>.
						</p>
					</dd>
				</div>
				<div>
					<dt class="font-semibold">No dependency list</dt>
					<dd>
						<p>
							<code>each</code> reads <code>total</code>, which reads <code>bill</code> and
							<code>tip</code>. Svelte records those dependencies as the expressions run, so there
							is nothing to keep up to date by hand.
						</p>
					</dd>
				</div>
				<div>
					<dt class="font-semibold">No re-render</dt>
					<dd>
						<p>
							The script runs once, when the component is created. After that, a change re-runs only
							the expressions that read it.
						</p>
					</dd>
				</div>
			</dl>
		</div>

		<Code html={billSource} file="src/lib/demo/reactivity/BillSplit.svelte" />
	</div>

	<section class="prose">
		<h2>Updates go to the node, not the component</h2>
		<p>
			Svelte has no virtual DOM. Because the compiler knows which expression reads which state, each
			piece of state keeps track of the few places that read it, and a change updates those places
			and nothing else. There is no component to re-run and no tree to compare.
		</p>
		<p>
			The grid below has 2,400 cells, each with its own state. Change one cell and read the figures
			underneath: a MutationObserver counts every DOM node written anywhere on the page during the
			update, and a timer measures it from the assignment to the last DOM write. Then press Start
			and raise it to a thousand cells a frame.
		</p>
	</section>

	<Demo title="2,400 cells" note="Measured live">
		<HeatmapDemo />
	</Demo>

	<div class="grid items-start gap-6 lg:grid-cols-2">
		<Code html={heatmapSource} file="src/lib/demo/reactivity/Heatmap.svelte" />
		<Code html={measureSource} file="src/lib/demo/reactivity/measure.ts" />
	</div>

	<section class="prose">
		<h3>Reading the numbers</h3>
		<p>
			Nodes written should match cells changed: one style write per cell, whether you change one or
			a thousand every frame. <strong>Cool all</strong> is the telling case. It assigns zero to all
			2,400 cells, but a cell that was already cold has not changed, so only the warm ones are
			written.
		</p>
		<p>
			The update time covers your code and Svelte's. The browser still has to restyle and paint what
			changed, and that cost is not in the figure; the frame rate is where it shows. Both depend on
			your device, which is why they are measured here rather than quoted.
		</p>
	</section>

	<section class="prose">
		<h2>Shared state is a module</h2>
		<p>
			State does not have to live in a component. Runes work in any file whose name ends in
			<code>.svelte.ts</code> or <code>.svelte.js</code>, so shared state can be a class in a
			module: export an instance, and import it wherever it is needed. There is no store library to
			choose, no provider to wrap around the tree, and no reducer.
		</p>
	</section>

	<Demo title="One basket" note="Two components, no props">
		<div class="grid gap-6 md:grid-cols-2">
			<section class="rounded-xl border border-line p-4" aria-labelledby="shelf-heading">
				<h3 id="shelf-heading" class="font-mono text-xs text-ink-subtle">Shelf.svelte</h3>
				<div class="mt-2"><Shelf /></div>
			</section>
			<section class="rounded-xl border border-line p-4" aria-labelledby="basket-heading">
				<h3 id="basket-heading" class="font-mono text-xs text-ink-subtle">BasketSummary.svelte</h3>
				<div class="mt-4"><BasketSummary /></div>
			</section>
		</div>
	</Demo>

	<div class="space-y-6">
		<div class="max-w-3xl">
			<Code html={basketSource} file="src/lib/demo/reactivity/basket.svelte.ts" />
		</div>
		<div class="grid items-start gap-6 lg:grid-cols-2">
			<Code html={shelfSource} file="src/lib/demo/reactivity/Shelf.svelte" />
			<Code html={summarySource} file="src/lib/demo/reactivity/BasketSummary.svelte" />
		</div>
	</div>

	<section class="prose">
		<p>
			Add from the shelf and the basket follows; remove from the basket and the shelf follows. Move
			to another chapter and come back, and the basket is as you left it, because the module is
			still loaded. A full reload starts it afresh.
		</p>
		<p>
			One caution. On the server, a module is loaded once and shared by every request, so
			module-level state must never hold one visitor's data during server rendering. This basket
			only changes when someone clicks, and clicks happen in the browser. Data that belongs to one
			request travels through <code>load</code> and props, or through context.
		</p>
	</section>

	<section class="prose">
		<h2>Effects are the exception</h2>
		<p>
			<code>$effect</code> runs code after Svelte has updated the DOM, and runs it again when the
			state it read changes. If it returns a function, that function runs before the next run and
			when the component is destroyed. Effects never run on the server.
		</p>
		<p>
			It is for the edges of an application: a canvas, a third-party widget, a timer, a
			subscription. It is not for keeping one value in step with another. That is what
			<code>$derived</code> is for, and a derived value is correct whenever it is read, where an
			effect that copies state is correct only once it has run.
		</p>
		<p>
			The demos in this chapter use exactly one effect. It starts the grid's animation loop when you
			press Start, and its cleanup cancels the loop when you press Stop or leave the page.
		</p>
	</section>

	<section class="prose">
		<h2>What takes getting used to</h2>
		<p>
			Runes have rules of their own. A <code>$state</code> object is a proxy, and its reactivity
			lives in property access: <code>const &#123; heat &#125; = cell</code> copies the current
			number into a plain variable that will never update, and passing <code>cell.heat</code> to a
			function passes a number, not a live value. And a module cannot export a
			<code>$state</code> variable that it reassigns, because the compiler only rewrites references
			in the file that declares it. You export an object or a class instance instead, which is why
			the basket is a class.
		</p>
		<p>None of this is hard, but each point is easy to trip over once before it becomes habit.</p>
	</section>
</Chapter>
