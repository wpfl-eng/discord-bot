<script lang="ts">
	import { page } from '$app/stores';
	import { error } from '@sveltejs/kit';
	import DocsLayout from '$lib/components/templates/DocsLayout.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import CodeBlock from '$lib/components/atoms/CodeBlock.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import CommandOption from '$lib/components/molecules/CommandOption.svelte';
	import CommandCard from '$lib/components/organisms/CommandCard.svelte';
	import { getCommand, getCategory, allCommands } from '$lib/data/commands';

	let command = $derived.by(() => {
		const categorySlug = $page.params.category ?? '';
		const commandName = $page.params.command ?? '';
		const cmd = getCommand(categorySlug, commandName);
		if (!cmd) {
			error(404, { message: 'Command not found' });
		}
		return cmd;
	});

	let category = $derived(getCategory($page.params.category ?? ''));

	let relatedCommands = $derived(
		(command.relatedCommands || [])
			.map((name) => allCommands.find((c) => c.name === name))
			.filter(Boolean)
	);
</script>

<svelte:head>
	<title>/{command.name} - CommishBot Docs</title>
</svelte:head>

<DocsLayout>
	<!-- Breadcrumb -->
	<nav class="flex items-center gap-2 text-sm text-dark-400 mb-6">
		<a href="/commands" class="hover:text-dark-100 transition-colors">Commands</a>
		<Icon name="chevronRight" size="sm" />
		<a href="/commands/{command.categorySlug}" class="hover:text-dark-100 transition-colors">{command.category}</a>
		<Icon name="chevronRight" size="sm" />
		<span class="text-dark-100">/{command.name}</span>
	</nav>

	<!-- Header -->
	<header class="mb-8 pb-8 border-b border-dark-border">
		<div class="flex items-start gap-4 flex-wrap">
			<h1 class="text-3xl font-mono font-bold text-dark-100">/{command.name}</h1>
			<div class="flex gap-2 flex-wrap">
				<Badge variant="category" text={command.category} />
				{#if command.ephemeral}
					<Badge variant="optional" text="Ephemeral" />
				{/if}
				{#if command.cooldown}
					<Badge variant="cooldown" text="{command.cooldown.duration}{command.cooldown.unit.charAt(0)} cooldown" />
				{/if}
			</div>
		</div>
		<p class="mt-3 text-lg text-dark-300">{command.longDescription || command.description}</p>
	</header>

	<!-- Usage -->
	<section class="mb-8">
		<h2 class="text-xl font-bold text-dark-100 mb-4">Usage</h2>
		<div class="space-y-2">
			{#each command.usage as usage}
				<CodeBlock code={usage} language="text" />
			{/each}
		</div>
	</section>

	<!-- Subcommands -->
	{#if command.subcommands && command.subcommands.length > 0}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-dark-100 mb-4">Subcommands</h2>
			<div class="space-y-4">
				{#each command.subcommands as subcommand}
					<div class="card">
						<div class="flex items-center gap-2 mb-2">
							<code class="text-accent-primary font-mono">{subcommand.name}</code>
						</div>
						<p class="text-dark-300 text-sm mb-3">{subcommand.description}</p>
						{#if subcommand.options && subcommand.options.length > 0}
							<div class="space-y-2 mt-4">
								{#each subcommand.options as option}
									<CommandOption {option} />
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Options -->
	{#if command.options && command.options.length > 0}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-dark-100 mb-4">Options</h2>
			<div class="space-y-3">
				{#each command.options as option}
					<CommandOption {option} />
				{/each}
			</div>
		</section>
	{/if}

	<!-- Examples -->
	{#if command.examples && command.examples.length > 0}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-dark-100 mb-4">Examples</h2>
			<div class="space-y-4">
				{#each command.examples as example}
					<div class="card">
						<div class="mb-2">
							<span class="text-xs text-dark-400 uppercase tracking-wide">Input</span>
							<CodeBlock code={example.input} language="text" showCopy={false} />
						</div>
						<div>
							<span class="text-xs text-dark-400 uppercase tracking-wide">Output</span>
							<div class="mt-1 p-3 bg-dark-bg rounded-lg text-dark-200 text-sm whitespace-pre-wrap">
								{example.output}
							</div>
						</div>
						{#if example.note}
							<p class="mt-2 text-xs text-dark-400 italic">{example.note}</p>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Tips -->
	{#if command.tips && command.tips.length > 0}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-dark-100 mb-4">Tips</h2>
			<ul class="space-y-2">
				{#each command.tips as tip}
					<li class="flex items-start gap-2 text-dark-300">
						<span class="text-accent-success mt-0.5">✓</span>
						{tip}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Game Config -->
	{#if command.gameConfig}
		<section class="mb-8">
			<h2 class="text-xl font-bold text-dark-100 mb-4">Configuration Values</h2>
			<div class="card">
				<CodeBlock code={JSON.stringify(command.gameConfig, null, 2)} language="json" />
			</div>
		</section>
	{/if}

	<!-- Related Commands -->
	{#if relatedCommands.length > 0}
		<section>
			<h2 class="text-xl font-bold text-dark-100 mb-4">Related Commands</h2>
			<div class="grid gap-4">
				{#each relatedCommands as related}
					{#if related}
						<CommandCard command={related} compact />
					{/if}
				{/each}
			</div>
		</section>
	{/if}
</DocsLayout>
