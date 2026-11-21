<!--
	One panel of the streaming dashboard. Given a plain value, it renders it into the server's HTML.
	Given a promise, it reserves a box that the value streams into later, or that shows the error
	if the promise rejects.
-->
<script lang="ts">
	import ClientOnly from '#lib/stable/ClientOnly.svelte';
	import Streamed from '#lib/stable/Streamed.svelte';
	import ArrivalTime from './ArrivalTime.svelte';

	interface Figure {
		value: string;
		label: string;
	}

	let { name, data }: { name: string; data: Figure | Promise<Figure> } = $props();

	/** A streamed error arrives as the `{ status, message }` SvelteKit serialised for it. */
	const reason = (error: unknown) =>
		error instanceof Object && 'message' in error ? String(error.message) : 'It did not load.';
</script>

{#snippet figure({ value, label }: Figure)}
	<div>
		<p class="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
		<p class="mt-1 truncate text-sm text-ink-muted">{label}</p>
	</div>
{/snippet}

<section class="rounded-xl border border-line bg-canvas p-3 sm:p-4">
	<header class="flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-x-3">
		<h3 class="truncate text-sm font-medium">{name}</h3>
		<span class="shrink-0 font-mono text-xs text-ink-subtle">
			{data instanceof Promise ? 'streamed' : 'first response'}
		</span>
	</header>

	{#if data instanceof Promise}
		<Streamed promise={data} class="mt-3 h-24">
			{#snippet children(value: Figure)}
				<div class="grid grid-rows-[minmax(0,1fr)_auto]">
					{@render figure(value)}
					<ArrivalTime {name} />
				</div>
			{/snippet}
			{#snippet failed(error)}
				<div role="alert" class="grid grid-rows-[minmax(0,1fr)_auto]">
					<div>
						<p class="text-sm font-semibold text-bad">Unavailable</p>
						<p class="mt-1 line-clamp-2 text-sm text-ink-muted">{reason(error)}</p>
					</div>
					<ArrivalTime {name} failed />
				</div>
			{/snippet}
		</Streamed>
	{:else}
		<div class="mt-3 grid h-24 grid-rows-[minmax(0,1fr)_auto]">
			{@render figure(data)}
			<!-- The time of the first paint is known only to the browser. -->
			<ClientOnly class="h-4"><ArrivalTime {name} paint /></ClientOnly>
		</div>
	{/if}
</section>
