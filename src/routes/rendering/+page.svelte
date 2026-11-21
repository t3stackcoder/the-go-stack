<script lang="ts">
	import { resolve } from '$app/paths';
	import Chapter from '#lib/ui/Chapter.svelte';
	import Code from '#lib/ui/Code.svelte';
	import prerenderSource from '../+layout.ts?highlight';
	import clientSource from './client/+page.ts?highlight';
	import hybridSource from './hybrid/+page.server.ts?highlight';
	import serverSource from './server/+page.server.ts?highlight';

	const modes = [
		{
			path: '/rendering/server',
			name: 'Server only',
			setting: 'csr = false',
			sends: 'Finished HTML and nothing else. Zero JavaScript.',
			suits: 'Articles, documentation, marketing pages.'
		},
		{
			path: '/rendering/hybrid',
			name: 'Server and client',
			setting: 'the default',
			sends: 'Finished HTML first, then the code to make it interactive.',
			suits: 'Almost everything. Fast first paint and a full application.'
		},
		{
			path: '/rendering/client',
			name: 'Client only',
			setting: 'ssr = false',
			sends: 'An empty shell. The browser builds the page.',
			suits: 'Dashboards and tools behind a login.'
		}
	] as const;
</script>

<Chapter
	path="/rendering"
	lede="Every page chooses how it is rendered: on the server, in the browser, or both. The choice is one exported constant, and each route makes it for itself."
>
	<section class="prose">
		<h2>The same catalog, rendered three ways</h2>
		<p>
			The three pages below show the same twelve products with the same component. The only
			difference between them is one line. Open each one and keep an eye on the readout pinned to
			the bottom of the screen: it reports what that page actually cost your browser.
		</p>
	</section>

	<ul class="grid gap-4 lg:grid-cols-3">
		{#each modes as mode (mode.path)}
			<li>
				<a
					href={resolve(mode.path)}
					class="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 hover:border-line-strong"
				>
					<p class="font-mono text-xs text-accent-text">{mode.setting}</p>
					<h3 class="mt-3 font-display text-2xl font-semibold tracking-tight">{mode.name}</h3>
					<p class="mt-3 text-ink-muted">{mode.sends}</p>
					<p class="mt-2 text-sm text-ink-subtle">{mode.suits}</p>
					<p class="mt-auto pt-6 text-sm font-medium group-hover:text-accent-text">
						Open it <span aria-hidden="true">→</span>
					</p>
				</a>
			</li>
		{/each}
	</ul>

	<section class="prose">
		<h2>The whole difference</h2>
		<p>
			These are the three files that decide it, complete and unedited. They are imported into this
			page from the routes they configure, so what you are reading is what is running.
		</p>
	</section>

	<div class="max-w-3xl space-y-4">
		<Code html={serverSource} file="rendering/server/+page.server.ts" />
		<Code html={hybridSource} file="rendering/hybrid/+page.server.ts" />
		<Code html={clientSource} file="rendering/client/+page.ts" />
	</div>

	<section class="prose">
		<h2>And a fourth: do not render at request time at all</h2>
		<p>
			This page, like most of this site, is <strong>prerendered</strong>. It was rendered once, when
			the site was built, and is served as a compressed static file. The readout says so: where a
			server time would be, it reads <code>prerendered</code>.
		</p>
	</section>

	<div class="max-w-3xl">
		<Code html={prerenderSource} file="src/routes/+layout.ts" />
	</div>

	<section class="prose">
		<h2>Why this matters</h2>
		<p>
			Rendering strategy is usually an early, expensive decision. Here it is a detail you set per
			page and can change in a minute. A marketing page can ship no JavaScript while the dashboard
			beside it is a full client-side application, in one codebase, sharing the same components.
		</p>
		<p>
			You do not have to predict which pages will need what. Start with the default, measure, and
			turn things off where they are not earning their keep.
		</p>
	</section>
</Chapter>
