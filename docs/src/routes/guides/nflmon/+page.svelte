<script lang="ts">
	import GuideLayout from '$lib/components/templates/GuideLayout.svelte';
	import CodeBlock from '$lib/components/atoms/CodeBlock.svelte';

	const toc = [
		{ id: 'overview', text: 'Overview', level: 2 },
		{ id: 'getting-started', text: 'Getting Started', level: 2 },
		{ id: 'rarities', text: 'Rarities', level: 2 },
		{ id: 'evolution', text: 'Evolution Stages', level: 2 },
		{ id: 'stats-ivs', text: 'Stats & IVs', level: 2 },
		{ id: 'training', text: 'Training System', level: 2 },
		{ id: 'obtaining', text: 'Obtaining NFLmon', level: 2 },
		{ id: 'trading', text: 'Trading', level: 2 },
		{ id: 'selling', text: 'Selling', level: 2 },
		{ id: 'tips', text: 'Tips & Strategy', level: 2 }
	];
</script>

<svelte:head>
	<title>NFLmon Guide - CommishBot Docs</title>
	<meta name="description" content="Complete guide to NFLmon - collect, train, evolve, and trade NFL players in a Pokemon-style game." />
	<meta property="og:title" content="NFLmon Guide - CommishBot Docs" />
	<meta property="og:description" content="Master the NFLmon collection system - catch 'em all!" />
	<meta property="og:type" content="article" />
	<link rel="canonical" href="https://commishbot-docs.pages.dev/guides/nflmon" />
</svelte:head>

<GuideLayout
	title="NFLmon Guide"
	description="Collect, train, evolve, and trade NFL players"
	{toc}
>
	<section id="overview" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Overview</h2>
		<p class="text-dark-300 mb-4">
			NFLmon is a Pokemon-style collectible game where you catch, train, and trade NFL players.
			Each player has unique stats, Individual Values (IVs), and can evolve through multiple stages as they level up.
		</p>
		<div class="grid md:grid-cols-2 gap-4">
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Key Features</h3>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>Collect 100+ NFL players</li>
					<li>5 rarity tiers (Common to Legendary)</li>
					<li>4 evolution stages</li>
					<li>Training system for XP</li>
					<li>Player-to-player trading</li>
				</ul>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Ways to Obtain</h3>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>/starter (first NFLmon)</li>
					<li>Wordle wins (20-100% chance)</li>
					<li>Trivia correct answers (15%)</li>
					<li>Shop packs (guaranteed)</li>
					<li>Trades with other players</li>
				</ul>
			</div>
		</div>
	</section>

	<section id="getting-started" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Getting Started</h2>
		<p class="text-dark-300 mb-4">
			Begin your NFLmon journey with the <code class="text-accent-primary">/starter</code> command.
		</p>
		<div class="card mb-4">
			<h3 class="font-semibold text-dark-100 mb-2">Your First NFLmon</h3>
			<p class="text-dark-300 text-sm mb-3">
				Running <code class="text-accent-primary">/starter</code> presents you with 5 random Common players.
				Click a numbered button to select your starter. This choice is permanent and can only be done once!
			</p>
			<CodeBlock code="/starter" language="text" showCopy={false} />
		</div>
		<div class="p-4 bg-accent-warning/10 border border-accent-warning/20 rounded-lg">
			<p class="text-accent-warning text-sm">
				<strong>Important:</strong> Choose wisely! You only get one starter selection per account.
			</p>
		</div>
	</section>

	<section id="rarities" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Rarities</h2>
		<p class="text-dark-300 mb-4">
			Each NFLmon has a fixed rarity that determines its stat multiplier and sell value.
		</p>
		<div class="card overflow-x-auto">
			<table class="w-full text-sm min-w-[400px]">
				<thead>
					<tr class="text-left text-dark-400">
						<th class="pb-2">Rarity</th>
						<th class="pb-2">Stat Multiplier</th>
						<th class="pb-2">Sell Value</th>
					</tr>
				</thead>
				<tbody class="text-dark-200">
					<tr class="border-t border-dark-border">
						<td class="py-2"><span class="text-gray-400">Common</span></td>
						<td class="py-2">1.0x</td>
						<td class="py-2">50</td>
					</tr>
					<tr class="border-t border-dark-border">
						<td class="py-2"><span class="text-green-400">Uncommon</span></td>
						<td class="py-2">1.1x</td>
						<td class="py-2">100</td>
					</tr>
					<tr class="border-t border-dark-border">
						<td class="py-2"><span class="text-blue-400">Rare</span></td>
						<td class="py-2">1.2x</td>
						<td class="py-2">250</td>
					</tr>
					<tr class="border-t border-dark-border">
						<td class="py-2"><span class="text-purple-400">Epic</span></td>
						<td class="py-2">1.35x</td>
						<td class="py-2">500</td>
					</tr>
					<tr class="border-t border-dark-border">
						<td class="py-2"><span class="text-yellow-400">Legendary</span></td>
						<td class="py-2">1.5x</td>
						<td class="py-2">1,000</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="evolution" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Evolution Stages</h2>
		<p class="text-dark-300 mb-4">
			As your NFLmon levels up, it can evolve through 4 stages. Use <code class="text-accent-primary">/nflmon evolve</code> when ready.
		</p>
		<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
			<div class="card text-center">
				<div class="text-3xl mb-2">🌱</div>
				<h3 class="font-semibold text-dark-100">Rookie</h3>
				<p class="text-dark-400 text-sm">Level 1+</p>
			</div>
			<div class="card text-center">
				<div class="text-3xl mb-2">⭐</div>
				<h3 class="font-semibold text-dark-100">Pro</h3>
				<p class="text-dark-400 text-sm">Level 21+</p>
			</div>
			<div class="card text-center">
				<div class="text-3xl mb-2">🌟</div>
				<h3 class="font-semibold text-dark-100">All-Pro</h3>
				<p class="text-dark-400 text-sm">Level 41+</p>
			</div>
			<div class="card text-center">
				<div class="text-3xl mb-2">👑</div>
				<h3 class="font-semibold text-dark-100">Hall of Famer</h3>
				<p class="text-dark-400 text-sm">Level 61+ (Rare+)</p>
			</div>
		</div>
		<p class="mt-4 text-dark-400 text-sm">
			Note: Hall of Famer evolution requires Rare rarity or higher.
		</p>
	</section>

	<section id="stats-ivs" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Stats & IVs</h2>
		<p class="text-dark-300 mb-4">
			Each NFLmon has 5 stats with base values determined by position and random Individual Values (IVs).
		</p>
		<div class="grid md:grid-cols-2 gap-4 mb-4">
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Stats</h3>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li><strong>SPD</strong> - Speed</li>
					<li><strong>PWR</strong> - Power</li>
					<li><strong>AGI</strong> - Agility</li>
					<li><strong>AWR</strong> - Awareness</li>
					<li><strong>HP</strong> - Hit Points</li>
				</ul>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Individual Values (IVs)</h3>
				<p class="text-dark-300 text-sm mb-2">
					IVs are random values (0-15) assigned when caught. They represent the hidden potential of your NFLmon.
				</p>
				<p class="text-dark-400 text-sm">
					Total IVs: 0-75 (max 15 per stat)
				</p>
			</div>
		</div>
		<div class="card">
			<h3 class="font-semibold text-dark-100 mb-2">Stat Formula</h3>
			<CodeBlock code="Final Stat = (Base Stat + IV) × (1 + Level × 0.01) × Rarity Multiplier" language="text" showCopy={false} />
		</div>
	</section>

	<section id="training" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Training System</h2>
		<p class="text-dark-300 mb-4">
			Put NFLmon in training slots to earn XP from activities. All trained NFLmon receive full XP.
		</p>
		<div class="card mb-4 overflow-x-auto">
			<h3 class="font-semibold text-dark-100 mb-2">XP Sources</h3>
			<table class="w-full text-sm min-w-[300px]">
				<thead>
					<tr class="text-left text-dark-400">
						<th class="pb-2">Activity</th>
						<th class="pb-2">XP Gained</th>
					</tr>
				</thead>
				<tbody class="text-dark-200">
					<tr class="border-t border-dark-border">
						<td class="py-2">Wordle Win</td>
						<td class="py-2 text-accent-success">10-20 XP</td>
					</tr>
					<tr class="border-t border-dark-border">
						<td class="py-2">Wordle First Solve</td>
						<td class="py-2 text-accent-success">25-35 XP</td>
					</tr>
					<tr class="border-t border-dark-border">
						<td class="py-2">Trivia Correct</td>
						<td class="py-2 text-accent-success">5-15 XP</td>
					</tr>
					<tr class="border-t border-dark-border">
						<td class="py-2">Blackjack Win</td>
						<td class="py-2 text-accent-success">3-8 XP</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div class="card">
			<h3 class="font-semibold text-dark-100 mb-2">Training Slots</h3>
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<span class="text-dark-400">Default Slots:</span>
					<span class="text-dark-100 ml-2">1</span>
				</div>
				<div>
					<span class="text-dark-400">Maximum Slots:</span>
					<span class="text-dark-100 ml-2">5</span>
				</div>
				<div>
					<span class="text-dark-400">Slot Upgrade Cost:</span>
					<span class="text-dark-100 ml-2">3,000</span>
				</div>
				<div>
					<span class="text-dark-400">Max Level:</span>
					<span class="text-dark-100 ml-2">100</span>
				</div>
			</div>
		</div>
	</section>

	<section id="obtaining" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Obtaining NFLmon</h2>
		<div class="space-y-4">
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Starter</h3>
				<p class="text-dark-300 text-sm">One-time only. Pick from 5 random Common players.</p>
				<CodeBlock code="/starter" language="text" showCopy={false} />
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Wordle</h3>
				<p class="text-dark-300 text-sm mb-2">Win Wordle for a chance to catch an NFLmon.</p>
				<div class="grid grid-cols-2 gap-2 text-sm">
					<div class="text-dark-400">Regular Win:</div>
					<div class="text-accent-success">20% chance</div>
					<div class="text-dark-400">First Solve:</div>
					<div class="text-accent-success">100% guaranteed</div>
				</div>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Trivia</h3>
				<p class="text-dark-300 text-sm mb-2">Answer trivia correctly for a chance to catch.</p>
				<div class="grid grid-cols-2 gap-2 text-sm">
					<div class="text-dark-400">Correct Answer:</div>
					<div class="text-accent-success">15% chance</div>
				</div>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Shop Packs</h3>
				<p class="text-dark-300 text-sm mb-2">Purchase packs from <code class="text-accent-primary">/shop</code> for guaranteed NFLmon.</p>
				<div class="overflow-x-auto">
					<table class="w-full text-sm min-w-[300px]">
						<thead>
							<tr class="text-left text-dark-400">
								<th class="pb-2">Pack</th>
								<th class="pb-2">Price</th>
								<th class="pb-2">NFLmon</th>
							</tr>
						</thead>
						<tbody class="text-dark-200">
							<tr class="border-t border-dark-border">
								<td class="py-2">Starter Pack</td>
								<td class="py-2">500</td>
								<td class="py-2">1</td>
							</tr>
							<tr class="border-t border-dark-border">
								<td class="py-2">Pro Pack</td>
								<td class="py-2">1,500</td>
								<td class="py-2">3</td>
							</tr>
							<tr class="border-t border-dark-border">
								<td class="py-2">Elite Pack</td>
								<td class="py-2">5,000</td>
								<td class="py-2">5</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		</div>
	</section>

	<section id="trading" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Trading</h2>
		<p class="text-dark-300 mb-4">
			Trade NFLmon with other players using the trade system.
		</p>
		<div class="space-y-4">
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Creating a Trade</h3>
				<CodeBlock code="/nflmon trade offer user:@friend my_nflmon:42 their_nflmon:55 coins:500" language="text" showCopy={false} />
				<p class="text-dark-400 text-sm mt-2">
					The recipient receives a DM with accept/reject buttons.
				</p>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Trade Rules</h3>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>Trades expire after 24 hours</li>
					<li>NFLmon in training cannot be traded</li>
					<li>You can include coins with your offer</li>
					<li>Gift trades (no request) are allowed</li>
				</ul>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Managing Trades</h3>
				<CodeBlock code="/nflmon trade pending&#10;/nflmon trade cancel trade_id:15" language="text" showCopy={false} />
			</div>
		</div>
	</section>

	<section id="selling" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Selling</h2>
		<p class="text-dark-300 mb-4">
			Sell unwanted NFLmon for coins based on their rarity.
		</p>
		<div class="card mb-4">
			<CodeBlock code="/nflmon sell id:42" language="text" showCopy={false} />
			<p class="text-dark-400 text-sm mt-2">
				You'll be asked to confirm before the sale completes.
			</p>
		</div>
		<div class="p-4 bg-accent-warning/10 border border-accent-warning/20 rounded-lg">
			<p class="text-accent-warning text-sm">
				<strong>Restrictions:</strong> NFLmon in training or marked as favorites cannot be sold.
			</p>
		</div>
	</section>

	<section id="tips" class="mb-8">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Tips & Strategy</h2>
		<div class="space-y-3">
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">1</span>
				<p class="text-dark-300">Always have NFLmon in training. Even low-level players benefit from passive XP gains from Wordle, Trivia, and Blackjack.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">2</span>
				<p class="text-dark-300">Be the first to solve Wordle for a guaranteed NFLmon drop. Regular wins only have a 20% chance.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">3</span>
				<p class="text-dark-300">Check IVs when you catch a new NFLmon. High IV totals (60+) are worth keeping even at lower rarities.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">4</span>
				<p class="text-dark-300">Invest in additional training slots early. At 3,000 coins each, they pay for themselves in evolved NFLmon value.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">5</span>
				<p class="text-dark-300">Use /nflmon dex to browse all available players and plan your collection goals.</p>
			</div>
		</div>
	</section>
</GuideLayout>
