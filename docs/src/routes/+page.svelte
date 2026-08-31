<script lang="ts">
	import Button from '$lib/components/atoms/Button.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { categories, allCommands } from '$lib/data/commands';

	const quickLinks = [
		{ name: 'Economy System', href: '/guides/economy', icon: 'coins', description: 'Learn how to earn and manage coins' },
		{ name: 'Gambling Guide', href: '/guides/gambling', icon: 'dice', description: 'Slots, blackjack, and betting strategies' }
	];

	const stats = [
		{ label: 'Commands', value: String(allCommands.length) },
		{ label: 'Categories', value: String(categories.length) },
		{ label: 'Game Systems', value: '3' }
	];
</script>

<svelte:head>
	<title>CommishBot Docs - Fantasy Football Discord Bot</title>
	<meta name="description" content="Documentation for CommishBot - the ultimate Discord bot for WPFL fantasy football league management. Explore commands, game systems, and strategies." />
	<meta property="og:title" content="CommishBot Docs - Fantasy Football Discord Bot" />
	<meta property="og:description" content="Documentation for CommishBot - the ultimate Discord bot for WPFL fantasy football league management." />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://commishbot-docs.pages.dev" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="CommishBot Docs" />
	<meta name="twitter:description" content="Documentation for CommishBot - the ultimate Discord bot for fantasy football league management." />
	<link rel="canonical" href="https://commishbot-docs.pages.dev" />
</svelte:head>

<div class="max-w-5xl mx-auto px-4 py-8 sm:py-12 lg:px-8">
	<!-- Hero -->
	<div class="text-center mb-12 sm:mb-16">
		<div class="text-4xl sm:text-6xl mb-4">🏈</div>
		<h1 class="text-3xl sm:text-4xl md:text-5xl font-bold text-dark-100 mb-4">CommishBot Documentation</h1>
		<p class="text-xl text-dark-400 max-w-2xl mx-auto">
			The ultimate Discord bot for WPFL fantasy football league management. Explore commands, game systems, and strategies.
		</p>
		<div class="flex justify-center gap-4 mt-8">
			<Button href="/commands" variant="primary" size="lg">
				Browse Commands
			</Button>
			<Button href="/guides/economy" variant="secondary" size="lg">
				Get Started
			</Button>
		</div>
	</div>

	<!-- Stats -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-12 sm:mb-16">
		{#each stats as stat}
			<div class="card text-center">
				<div class="text-3xl font-bold text-accent-primary">{stat.value}</div>
				<div class="text-dark-400 text-sm">{stat.label}</div>
			</div>
		{/each}
	</div>

	<!-- Quick Links -->
	<section class="mb-12 sm:mb-16">
		<h2 class="text-xl sm:text-2xl font-bold text-dark-100 mb-4 sm:mb-6">Quick Start Guides</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
			{#each quickLinks as link}
				<a href={link.href} class="card group hover:border-accent-primary/50 transition-all">
					<div class="flex items-center gap-3 mb-3">
						<div class="p-2 rounded-lg bg-dark-hover text-dark-300 group-hover:text-accent-primary group-hover:bg-accent-primary/10 transition-colors">
							<Icon name={link.icon} size="lg" />
						</div>
						<h3 class="font-semibold text-dark-100 group-hover:text-accent-primary transition-colors">{link.name}</h3>
					</div>
					<p class="text-dark-400 text-sm">{link.description}</p>
				</a>
			{/each}
		</div>
	</section>

	<!-- Categories -->
	<section>
		<h2 class="text-xl sm:text-2xl font-bold text-dark-100 mb-4 sm:mb-6">Command Categories</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
			{#each categories as category}
				<a href="/commands/{category.slug}" class="card group hover:border-accent-primary/50 transition-all">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg bg-dark-hover text-dark-300 group-hover:text-accent-primary group-hover:bg-accent-primary/10 transition-colors">
							<Icon name={category.icon} size="md" />
						</div>
						<div>
							<h3 class="font-semibold text-dark-100 group-hover:text-accent-primary transition-colors">{category.name}</h3>
							<p class="text-xs text-dark-400">{category.commands.length} commands</p>
						</div>
					</div>
				</a>
			{/each}
		</div>
	</section>
</div>
