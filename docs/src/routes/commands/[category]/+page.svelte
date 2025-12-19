<script lang="ts">
	import { page } from '$app/stores';
	import { error } from '@sveltejs/kit';
	import CommandCard from '$lib/components/organisms/CommandCard.svelte';
	import DocsLayout from '$lib/components/templates/DocsLayout.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { getCategory, categories } from '$lib/data/commands';

	let category = $derived.by(() => {
		const slug = $page.params.category ?? '';
		const cat = getCategory(slug);
		if (!cat) {
			error(404, { message: 'Category not found' });
		}
		return cat;
	});
</script>

<svelte:head>
	<title>{category.name} Commands - CommishBot Docs</title>
</svelte:head>

<DocsLayout>
	<div class="mb-8">
		<nav class="flex items-center gap-2 text-sm text-dark-400 mb-4">
			<a href="/commands" class="hover:text-dark-100 transition-colors">Commands</a>
			<Icon name="chevronRight" size="sm" />
			<span class="text-dark-100">{category.name}</span>
		</nav>
		<div class="flex items-center gap-4">
			<div class="p-3 rounded-xl bg-dark-hover text-accent-primary">
				<Icon name={category.icon} size="xl" />
			</div>
			<div>
				<h1 class="text-3xl font-bold text-dark-100">{category.name}</h1>
				<p class="text-dark-400">{category.description}</p>
			</div>
		</div>
	</div>

	<div class="grid gap-4">
		{#each category.commands as command}
			<CommandCard {command} />
		{/each}
	</div>
</DocsLayout>
