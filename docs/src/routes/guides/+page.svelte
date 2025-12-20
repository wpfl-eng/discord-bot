<script lang="ts">
	import DocsLayout from '$lib/components/templates/DocsLayout.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';

	const guides = [
		{
			title: 'Economy System',
			description: 'Master the coin economy - earn, save, and grow your wealth',
			href: '/guides/economy',
			icon: 'coins',
			topics: ['Daily bonuses', 'Work system', 'Bank & wallet', 'Protection']
		},
		{
			title: 'Training Ground',
			description: 'Learn the idle game mechanics for developing rookie players',
			href: '/guides/training',
			icon: 'dumbbell',
			topics: ['Grid management', 'Position tiers', 'Timing strategy', 'Maximizing returns']
		},
		{
			title: 'Gambling Strategies',
			description: 'Understand the odds and strategies for slots, blackjack, and betting',
			href: '/guides/gambling',
			icon: 'dice',
			topics: ['Slots payouts', 'Blackjack basics', 'Risk management', 'Expected value']
		},
		{
			title: 'Red Zone',
			description: 'Master the push-your-luck football game for a 10x payout',
			href: '/guides/redzone',
			icon: 'football',
			topics: ['Field positions', 'Fumble risk', 'Cash out strategy', 'Leaderboards']
		}
	];
</script>

<svelte:head>
	<title>Guides - CommishBot Docs</title>
	<meta name="description" content="In-depth guides for mastering CommishBot's game systems including economy, training ground, and gambling strategies." />
	<meta property="og:title" content="Guides - CommishBot Docs" />
	<meta property="og:description" content="Master CommishBot's game systems with comprehensive guides." />
	<meta property="og:type" content="website" />
	<link rel="canonical" href="https://commishbot-docs.pages.dev/guides" />
</svelte:head>

<DocsLayout title="Guides" description="In-depth guides for mastering CommishBot's game systems.">
	<div class="grid gap-6">
		{#each guides as guide}
			<a href={guide.href} class="card group hover:border-accent-primary/50 transition-all">
				<div class="flex items-start gap-4">
					<div class="p-3 rounded-xl bg-dark-hover text-dark-300 group-hover:text-accent-primary group-hover:bg-accent-primary/10 transition-colors">
						<Icon name={guide.icon} size="xl" />
					</div>
					<div class="flex-1">
						<h2 class="text-xl font-bold text-dark-100 group-hover:text-accent-primary transition-colors">
							{guide.title}
						</h2>
						<p class="mt-1 text-dark-400">{guide.description}</p>
						<div class="mt-4 flex flex-wrap gap-2">
							{#each guide.topics as topic}
								<span class="text-xs px-2 py-1 bg-dark-bg rounded-md text-dark-300">
									{topic}
								</span>
							{/each}
						</div>
					</div>
					<Icon name="chevronRight" size="md" class="text-dark-500 group-hover:text-dark-300 transition-colors" />
				</div>
			</a>
		{/each}
	</div>
</DocsLayout>
