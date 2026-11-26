<script lang="ts">
	import Chapter from '#lib/ui/Chapter.svelte';
	import Code from '#lib/ui/Code.svelte';
	import { resolve } from '$app/paths';
	import streamingSource from './streaming/+page.server.ts?highlight';

	const demos = [
		{
			path: '/data/typed',
			label: 'PageProps',
			name: 'Typed from server to template',
			shows: 'A load function and the page it feeds, with nothing in between.',
			try: 'Rename a field on the server and the template stops compiling.'
		},
		{
			path: '/data/streaming',
			label: 'return { stock: promise }',
			name: 'Slow data streams in',
			shows: 'A dashboard whose slow panels follow the page in the same response.',
			try: 'Every arrival is timed in your browser. One panel fails on purpose.'
		},
		{
			path: '/data/search',
			label: '?q=',
			name: 'The URL as state',
			shows: 'A search filtered on the server, driven by the query string.',
			try: 'Turn JavaScript off. It still works.'
		}
	] as const;
</script>

<Chapter
	path="/data"
	lede="A page gets its data from a load function on the server. What the function returns is the page's typed data prop, and anything slow can follow the page in the same response."
>
	<section class="prose">
		<h2>One function between the server and the page</h2>
		<p>
			A page that needs data has a <code>load</code> function beside it, in a file named
			<code>+page.server.ts</code>. It runs on the server for each request, so it can query a
			database, read a file or use a secret, and none of that code is sent to the browser. Whatever
			it returns becomes the page's <code>data</code> prop.
		</p>
		<p>
			There is no API to design for it and no fetch to write in the page. When the visitor moves
			between pages in the app, SvelteKit calls the same function and sends back only its data.
		</p>
	</section>

	<ul class="grid gap-4 lg:grid-cols-3">
		{#each demos as demo (demo.path)}
			<li>
				<!-- The streaming demo times a full page load, so the link to it always makes one. -->
				<a
					href={resolve(demo.path)}
					data-sveltekit-reload={demo.path === '/data/streaming' ? true : undefined}
					class="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 hover:border-line-strong"
				>
					<p class="font-mono text-xs text-brand-text">{demo.label}</p>
					<h3 class="mt-3 font-display text-2xl font-semibold tracking-tight">{demo.name}</h3>
					<p class="mt-3 text-ink-muted">{demo.shows}</p>
					<p class="mt-2 text-sm text-ink-subtle">{demo.try}</p>
					<p class="mt-auto pt-6 text-sm font-medium group-hover:text-brand-text">
						Open it <span aria-hidden="true">→</span>
					</p>
				</a>
			</li>
		{/each}
	</ul>

	<section class="prose">
		<h2>Types you do not write</h2>
		<p>
			SvelteKit generates types for each route from its files. The page imports
			<code>PageProps</code> from <code>./$types</code>, and <code>data</code> has exactly the shape
			that <code>load</code> returned. There is no interface to declare and no cast on a parsed
			response, so there is nothing to fall out of step: change what the server returns, and the
			type check points at every line of the template that relied on the old shape.
		</p>
		<p>
			The data is not limited to what JSON can carry. A <code>Date</code> returned on the server is
			a <code>Date</code> in the page, and so are a <code>Map</code>, a <code>Set</code> or a
			<code>BigInt</code>.
		</p>
	</section>

	<section class="prose">
		<h2>Slow data, without a slow page</h2>
		<p>
			Most pages mix fast data with slow: the product is quick to read, its reviews come from
			another service. If <code>load</code> awaits everything, the page waits for the slowest part.
			It does not have to. A promise that <code>load</code> returns without awaiting is not waited
			for: the page is sent with everything else, and the promise's value is streamed into the same
			HTTP response when it settles.
		</p>
		<p>
			This is the whole server side of the streaming demo. Four of the values are promises, and the
			only sign of it in the page is that their panels arrive later. They are handed over through
			<code>streaming</code>, this site's one helper for slow data, which is what the limits below
			are about.
		</p>
	</section>

	<div class="max-w-4xl">
		<Code html={streamingSource} file="src/routes/data/streaming/+page.server.ts" />
	</div>

	<section class="prose">
		<p>
			On this site each streamed value lands in a box reserved for it, so its arrival moves nothing,
			and a promise that rejects shows its error in the same box. A promise that might reject also
			needs a <code>catch</code> attached on the server: if it failed before the page started
			rendering, nothing would be listening yet, and by default Node exits on an unhandled
			rejection. The helper attaches one to every promise it is given.
		</p>
		<h3>Four limits worth knowing</h3>
		<ul>
			<li>
				Streaming needs JavaScript in the browser. The late values arrive as small scripts at the
				end of the response, and without JavaScript their placeholders would stay where they are. So
				a page that streams carries one <code>&lt;noscript&gt;</code> tag, which sends a browser
				without JavaScript to the same address with <code>?nojs=1</code> added. For that address the
				helper waits for every promise, and the page arrives whole. It is not free: a browser
				follows that tag only when the streamed response has ended, so such a visitor waits for the
				slow data twice. Turn JavaScript off and open the demo to see it.
			</li>
			<li>
				A promise that never settles keeps the response open for as long as the visitor stays. The
				helper takes a time limit, five seconds in the demo, and when it passes the panel shows a
				failure and the response ends.
			</li>
			<li>
				Some hosting platforms buffer responses. SvelteKit's documentation names AWS Lambda and
				Firebase. There the page arrives in one piece, once the slowest promise has settled.
			</li>
			<li>
				A rejection can reach the browser before the page has hydrated: on a slow device, or when
				going back to the page replays the response from the browser's cache. The page still shows
				the error once it hydrates, but the browser has already reported an unhandled rejection in
				the console, because nothing was listening yet. We found this while building the demo, and
				it is why the failing service there is also the slowest.
			</li>
		</ul>
	</section>

	<section class="prose">
		<h2>The URL as state</h2>
		<p>
			Search terms, filters and page numbers are often kept in client-side state, which a reload
			forgets and a link cannot share. They can live in the URL instead. When <code>load</code>
			reads <code>url.searchParams</code>, SvelteKit notes which parameters it read, and re-runs it
			when one of them changes.
		</p>
		<p>
			The form that sets them is a plain HTML form with <code>method="GET"</code>. Without
			JavaScript, the browser submits it and the server renders the results. With JavaScript,
			SvelteKit turns the submission into a client-side navigation: the same <code>load</code>
			runs, only its data crosses the network, and two attributes keep focus in the search box and
			the history clean.
		</p>
	</section>

	<section class="prose">
		<h2>Why this matters</h2>
		<p>
			A common way to get data onto a page has several layers: an endpoint, a client to call it,
			types for its responses, and a loading state for every part. Here it is one function per page.
			The types follow from what it returns, and the loading states follow from returning a promise.
		</p>
		<p>
			None of it is exotic. It is a server function, an HTML form, and an HTTP response that keeps
			going until the data is done. That is also why the first and last demos keep working when
			JavaScript does not.
		</p>
	</section>
</Chapter>
