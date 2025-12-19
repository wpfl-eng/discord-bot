<script lang="ts">
	import CommandCard from '$lib/components/organisms/CommandCard.svelte';
	import DocsLayout from '$lib/components/templates/DocsLayout.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { categories, allCommands } from '$lib/data/commands';
</script>

<svelte:head>
	<title>All Commands - CommishBot Docs</title>
	<meta name="description" content="Browse all {allCommands.length} available CommishBot commands across {categories.length} categories including economy, gambling, training, and more." />
	<meta property="og:title" content="All Commands - CommishBot Docs" />
	<meta property="og:description" content="Browse all CommishBot commands for fantasy football league management." />
	<meta property="og:type" content="website" />
	<link rel="canonical" href="https://commishbot-docs.pages.dev/commands" />
</svelte:head>

<DocsLayout title="All Commands" description="Browse all {allCommands.length} available commands across {categories.length} categories.">
	<div class="space-y-12">
		{#each categories as category}
			<section>
				<div class="flex items-center gap-3 mb-4">
					<h2 id={category.slug} class="text-xl font-bold text-dark-100">{category.name}</h2>
					<Badge variant="category" text="{category.commands.length} commands" />
				</div>
				<p class="text-dark-400 mb-6">{category.description}</p>
				<div class="grid gap-4">
					{#each category.commands as command}
						<CommandCard {command} />
					{/each}
				</div>
			</section>
		{/each}
	</div>
</DocsLayout>
