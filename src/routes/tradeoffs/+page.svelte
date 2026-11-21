<script lang="ts">
	import { resolve } from '$app/paths';
	import Chapter from '#lib/ui/Chapter.svelte';

	const costs = [
		{
			title: 'A smaller ecosystem',
			cost: 'Most component kits, and most of the code samples vendors publish for their SDKs, are written for React first. You will find fewer ready-made data grids, rich text editors and design systems, and you will sometimes be the one writing the integration.',
			softener:
				'Any plain JavaScript library works without an adapter, because a Svelte component is just code that touches the DOM. The gap is in pre-built interface components, not in what is possible.',
			weight:
				'High, if you assemble products from off-the-shelf parts. Low, if you build your own interface.'
		},
		{
			title: 'Fewer people know it',
			cost: 'Far fewer developers have worked with Svelte than with React. If you need to hire quickly, you will be hiring people to train, not people who arrive knowing the framework.',
			softener:
				'It is quick to learn for anyone comfortable with HTML, CSS and JavaScript, because it stays close to all three. That shortens the training. It does not remove it.',
			weight: 'High, for a team that is growing fast. Low, for a stable one.'
		},
		{
			title: 'It is still moving',
			cost: 'Svelte 5 replaced the reactivity model with runes. SvelteKit 3 moved configuration into the Vite config, renamed core modules and replaced the library import alias. Each upgrade is manageable, but each one is work, and some features shown in the documentation are still marked experimental.',
			softener:
				'Tutorials, forum answers and AI coding assistants often describe an older version. This site met that directly: it was written with tooling whose knowledge stopped at SvelteKit 2, and the work began by reading the version 3 migration guide.',
			weight: 'Moderate. Budget time for upgrades, and check the version of any advice you follow.'
		},
		{
			title: 'No native mobile story',
			cost: 'Svelte has no counterpart to React Native that is as mature. If one team must ship a web app and native mobile apps from shared interface code, React has a real advantage that nothing on this site answers.',
			softener:
				'You can wrap a web app for mobile, and that suits some products. It is not the same thing as native components, and it should not be presented as if it were.',
			weight: 'Decisive, if you need it. Irrelevant otherwise.'
		},
		{
			title: 'Hydration is all or nothing',
			cost: 'A page is either hydrated as a whole or not at all. There is no built-in way to hydrate one interactive widget on an otherwise static page. Every component on a hydrated page sends its code, including the parts that never change.',
			softener:
				'You can see the cost on this site. On the Rendering chapter, the code samples are sent twice: once as HTML, and again inside the JavaScript that hydrates the page. The bundles are small enough that this is usually acceptable, but it is waste, and other tools avoid it.',
			weight:
				'Low for most products. Real for large, mostly static pages with a little interactivity.'
		},
		{
			title: 'Runes have sharp edges',
			cost: 'Reactive state is a proxy, and some ordinary JavaScript habits quietly break it. Destructure a reactive object and the pieces stop updating. Use runes in a plain module and they do not work until the file is renamed. Effects are easy to reach for and easy to misuse.',
			softener:
				'The rules are few and the compiler warns about several of them. But there is a learning curve, and it arrives after the easy first hour, not during it.',
			weight: 'Low, and it fades. Expect a few confusing afternoons.'
		},
		{
			title: 'You bring your own production plumbing',
			cost: 'The Node adapter serves prerendered pages and assets compressed, but not pages rendered per request. Measured on this site, one such page went out at 187 KB that compresses to 18 KB. Nor does it send a security header, or keep a record of an error beyond printing it. You are expected to put a proxy or CDN in front, and streaming only helps if your host does not buffer responses.',
			softener:
				'This site closes those gaps itself: compression and error records in its server hook, and security headers in a start-up file of a few lines, all with nothing but the standard library. The content security policy is a built-in option, though it took care to fit around prerendered pages. None of it is hard. It is still something you have to notice and do, not something that is done for you.',
			weight: 'Low, if you already run infrastructure. Worth knowing if you do not.'
		}
	];

	const wrongChoice = [
		'You must share interface code between web and native mobile apps.',
		'Your product is assembled mostly from third-party React components.',
		'You need to hire a large team quickly from the open market.',
		'You have a large, healthy React codebase and no problem it is failing to solve.',
		'Your organisation needs a framework whose APIs will not change for years.'
	];

	const rightChoice = [
		'You care how fast the first page load is, and want that by default rather than by effort.',
		'You build your own interface instead of assembling one.',
		'Your team is small or stable, and would rather write less code.',
		'You want content pages and application screens in one codebase.',
		'You are starting something new, with no existing framework to migrate from.'
	];
</script>

<Chapter
	path="/tradeoffs"
	lede="Five chapters have argued for SvelteKit. This one argues against it, as hard as it honestly can. If a cost on this page describes your situation, believe it over everything that came before."
>
	<section class="prose">
		<h2>What you give up</h2>
		<p>
			None of these is a reason nobody should use SvelteKit. Each is a reason somebody should not.
			For every cost there is a note on what softens it, and a plain statement of how much it ought
			to weigh.
		</p>
	</section>

	<ol class="grid gap-4 lg:grid-cols-2">
		{#each costs as item, index (item.title)}
			<li class="flex flex-col rounded-2xl border border-line bg-surface p-6">
				<p class="font-mono text-xs text-ink-subtle">Cost 0{index + 1}</p>
				<h3 class="mt-2 font-display text-2xl font-semibold tracking-tight">{item.title}</h3>
				<p class="mt-3 text-ink-muted">{item.cost}</p>
				<p class="mt-3 text-sm text-ink-subtle">{item.softener}</p>
				<p class="mt-auto pt-5 text-sm">
					<span class="font-semibold">How much it matters.</span>
					<span class="text-ink-muted">{item.weight}</span>
				</p>
			</li>
		{/each}
	</ol>

	<div class="grid gap-4 lg:grid-cols-2">
		<section class="rounded-2xl border border-line bg-surface p-6">
			<h2 class="font-display text-2xl font-semibold tracking-tight">It is the wrong choice if</h2>
			<ul class="mt-4 space-y-3 text-ink-muted">
				{#each wrongChoice as reason (reason)}
					<li class="flex gap-3">
						<span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-bad" aria-hidden="true"></span>
						{reason}
					</li>
				{/each}
			</ul>
		</section>

		<section class="rounded-2xl border border-line bg-surface p-6">
			<h2 class="font-display text-2xl font-semibold tracking-tight">It is a strong choice if</h2>
			<ul class="mt-4 space-y-3 text-ink-muted">
				{#each rightChoice as reason (reason)}
					<li class="flex gap-3">
						<span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-good" aria-hidden="true"></span>
						{reason}
					</li>
				{/each}
			</ul>
		</section>
	</div>

	<section class="prose">
		<h2>What this site cannot tell you</h2>
		<p>
			It is a small site, built in one sitting. It shows that the framework's ideas hold up, and
			that a careful foundation is cheap to build on it. It does not show how a codebase of several
			hundred routes feels after three years, how a team of forty works in it, or how it behaves
			under your traffic. Those are the questions that decide large projects, and only your own
			trial can answer them.
		</p>
		<p>
			Nor does it quote benchmarks against other frameworks. Comparative numbers depend on what is
			being built and who is measuring. Every figure here is this site, measured on your device.
			That makes the figures true, and it also makes them narrow.
		</p>
		<p>
			With the costs on the table, the <a href={resolve('/verdict')}>last chapter</a> asks about your
			situation and gives you an answer.
		</p>
	</section>
</Chapter>
