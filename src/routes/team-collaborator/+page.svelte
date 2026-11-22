<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
</script>

<svelte:head>
	<title>Team Collaborator</title>
	<meta name="description" content="Team Collaborator: a place for the team to work together." />
</svelte:head>

<div class="mx-auto max-w-6xl px-6 pt-20 pb-12 sm:pt-28">
	<h1 class="font-display text-6xl font-semibold tracking-tighter sm:text-8xl sm:leading-none">
		Hello, team.
	</h1>
	<p class="mt-8 max-w-2xl text-xl leading-relaxed text-pretty text-ink-muted">
		This is where Team Collaborator starts. There is nothing to do here yet, but there will be soon.
	</p>

	<Card.Root class="mt-12 max-w-md">
		<Card.Header>
			<Card.Title>Your team's workspace</Card.Title>
			<Card.Description>
				Everything your team works on together will gather here.
			</Card.Description>
		</Card.Header>
	</Card.Root>
</div>
