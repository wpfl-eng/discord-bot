<script lang="ts">
	import GuideLayout from '$lib/components/templates/GuideLayout.svelte';
	import CodeBlock from '$lib/components/atoms/CodeBlock.svelte';

	const toc = [
		{ id: 'overview', text: 'Overview', level: 2 },
		{ id: 'coin-flip', text: 'Coin Flip', level: 2 },
		{ id: 'slots', text: 'Slots Machine', level: 2 },
		{ id: 'slots-payouts', text: 'Payout Table', level: 3 },
		{ id: 'slots-math', text: 'Expected Value', level: 3 },
		{ id: 'blackjack', text: 'Blackjack', level: 2 },
		{ id: 'blackjack-strategy', text: 'Basic Strategy', level: 3 },
		{ id: 'risk-management', text: 'Risk Management', level: 2 },
		{ id: 'tips', text: 'Pro Tips', level: 2 }
	];
</script>

<svelte:head>
	<title>Gambling Strategies Guide - CommishBot Docs</title>
	<meta name="description" content="Understand the odds and make smarter bets - coin flip, slots, and blackjack strategies with expected value analysis." />
	<meta property="og:title" content="Gambling Strategies Guide - CommishBot Docs" />
	<meta property="og:description" content="Master gambling strategies for slots, blackjack, and betting." />
	<meta property="og:type" content="article" />
	<link rel="canonical" href="https://commishbot-docs.pages.dev/guides/gambling" />
</svelte:head>

<GuideLayout
	title="Gambling Strategies Guide"
	description="Understand the odds and make smarter bets"
	{toc}
>
	<section id="overview" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Overview</h2>
		<p class="text-dark-300 mb-4">
			CommishBot offers three gambling options, each with different risk/reward profiles.
			Understanding the math can help you make informed decisions.
		</p>
		<div class="card border-accent-danger/30">
			<p class="text-accent-danger text-sm">
				<strong>Disclaimer:</strong> All gambling is designed to have a house edge. Over time, the expected value is negative.
				Only gamble what you're willing to lose!
			</p>
		</div>
		<div class="grid md:grid-cols-3 gap-4 mt-6">
			<div class="card text-center">
				<div class="text-3xl mb-2">🪙</div>
				<h3 class="font-semibold text-dark-100">Coin Flip</h3>
				<p class="text-dark-400 text-sm">50/50 odds</p>
			</div>
			<div class="card text-center">
				<div class="text-3xl mb-2">🎰</div>
				<h3 class="font-semibold text-dark-100">Slots</h3>
				<p class="text-dark-400 text-sm">Variable payouts</p>
			</div>
			<div class="card text-center">
				<div class="text-3xl mb-2">🃏</div>
				<h3 class="font-semibold text-dark-100">Blackjack</h3>
				<p class="text-dark-400 text-sm">Skill-based</p>
			</div>
		</div>
	</section>

	<section id="coin-flip" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Coin Flip</h2>
		<p class="text-dark-300 mb-4">
			The simplest gamble - pure 50/50 odds. Win and double your bet, or lose it all.
		</p>
		<div class="card">
			<CodeBlock code="/gamble amount:100" language="text" showCopy={false} />
			<div class="grid grid-cols-2 gap-4 mt-4 text-sm">
				<div class="p-3 bg-dark-bg rounded-lg">
					<span class="text-dark-400">Win (50%):</span>
					<span class="text-accent-success ml-2">+🪙 100</span>
				</div>
				<div class="p-3 bg-dark-bg rounded-lg">
					<span class="text-dark-400">Lose (50%):</span>
					<span class="text-accent-danger ml-2">-🪙 100</span>
				</div>
			</div>
		</div>
		<p class="mt-4 text-dark-400 text-sm">
			<strong>Expected Value:</strong> 0 (fair game, no house edge on individual bets)
		</p>
	</section>

	<section id="slots" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Slots Machine</h2>
		<p class="text-dark-300 mb-4">
			A football-themed slot machine with weighted symbols. Match three of a kind for big payouts!
		</p>

		<div id="slots-payouts" class="mt-8">
			<h3 class="text-xl font-bold text-dark-100 mb-4">Payout Table</h3>
			<div class="overflow-x-auto">
				<table class="w-full text-sm min-w-[500px]">
					<thead>
						<tr class="text-left text-dark-400 border-b border-dark-border">
							<th class="pb-3">Match</th>
							<th class="pb-3">Symbols</th>
							<th class="pb-3">Multiplier</th>
							<th class="pb-3">Rarity</th>
						</tr>
					</thead>
					<tbody class="text-dark-200">
						<tr class="border-b border-dark-border">
							<td class="py-3">Triple Jackpot</td>
							<td class="py-3">🎰 🎰 🎰</td>
							<td class="py-3 text-accent-primary font-bold">100x</td>
							<td class="py-3 text-dark-400">Legendary (2% weight)</td>
						</tr>
						<tr class="border-b border-dark-border">
							<td class="py-3">Triple Trophy</td>
							<td class="py-3">🏆 🏆 🏆</td>
							<td class="py-3 text-accent-success">25x</td>
							<td class="py-3 text-dark-400">Rare (5% weight)</td>
						</tr>
						<tr class="border-b border-dark-border">
							<td class="py-3">Triple Gold</td>
							<td class="py-3">🥇 🥇 🥇</td>
							<td class="py-3 text-accent-success">10x</td>
							<td class="py-3 text-dark-400">Rare (8% weight)</td>
						</tr>
						<tr class="border-b border-dark-border">
							<td class="py-3">Triple Star</td>
							<td class="py-3">⭐ ⭐ ⭐</td>
							<td class="py-3">7x</td>
							<td class="py-3 text-dark-400">Uncommon (10% weight)</td>
						</tr>
						<tr class="border-b border-dark-border">
							<td class="py-3">Triple Stadium</td>
							<td class="py-3">🏟️ 🏟️ 🏟️</td>
							<td class="py-3">5x</td>
							<td class="py-3 text-dark-400">Uncommon (15% weight)</td>
						</tr>
						<tr class="border-b border-dark-border">
							<td class="py-3">Triple Common</td>
							<td class="py-3">🏈/⚽/🎯</td>
							<td class="py-3">3x</td>
							<td class="py-3 text-dark-400">Common (60% total)</td>
						</tr>
						<tr>
							<td class="py-3">Two Matching</td>
							<td class="py-3">Any pair</td>
							<td class="py-3">2x</td>
							<td class="py-3 text-dark-400">Frequent</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>

		<div id="slots-math" class="mt-8">
			<h3 class="text-xl font-bold text-dark-100 mb-4">Expected Value Analysis</h3>
			<p class="text-dark-300 mb-4">
				Slots has a house edge - most spins lose. The big payouts are rare but possible.
			</p>
			<div class="card">
				<p class="text-dark-300 text-sm">
					With weighted symbols, most common outcomes are either total losses or 2x wins from pairs.
					The jackpot is exciting but extremely unlikely (~0.0008% for three 🎰).
				</p>
			</div>
		</div>
	</section>

	<section id="blackjack" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Blackjack</h2>
		<p class="text-dark-300 mb-4">
			The most skill-based option. Play against the dealer with Hit, Stand, and Double Down.
		</p>
		<div class="card mb-6">
			<h4 class="font-semibold text-dark-100 mb-2">Rules</h4>
			<ul class="space-y-1 text-dark-300 text-sm">
				<li>• Goal: Get closer to 21 than the dealer without busting</li>
				<li>• Face cards = 10, Aces = 1 or 11</li>
				<li>• Dealer stands on 17</li>
				<li>• Blackjack (21 on first 2 cards) pays 1.5x</li>
				<li>• Double Down: Double bet for exactly one more card</li>
			</ul>
		</div>

		<div id="blackjack-strategy" class="mt-8">
			<h3 class="text-xl font-bold text-dark-100 mb-4">Basic Strategy</h3>
			<div class="space-y-4">
				<div class="card">
					<h4 class="font-semibold text-dark-100 mb-2">When to Hit</h4>
					<ul class="space-y-1 text-dark-300 text-sm">
						<li>• Your hand is 11 or less (can't bust)</li>
						<li>• Your hand is 12-16 and dealer shows 7+</li>
						<li>• Soft 17 or less (Ace counting as 11)</li>
					</ul>
				</div>
				<div class="card">
					<h4 class="font-semibold text-dark-100 mb-2">When to Stand</h4>
					<ul class="space-y-1 text-dark-300 text-sm">
						<li>• Your hand is 17+ (risk of bust too high)</li>
						<li>• Your hand is 12-16 and dealer shows 2-6</li>
						<li>• Soft 18+ (Ace counting as 11)</li>
					</ul>
				</div>
				<div class="card">
					<h4 class="font-semibold text-dark-100 mb-2">When to Double Down</h4>
					<ul class="space-y-1 text-dark-300 text-sm">
						<li>• Your hand is 11 (best doubling hand)</li>
						<li>• Your hand is 10 and dealer shows 2-9</li>
						<li>• Your hand is 9 and dealer shows 3-6</li>
					</ul>
				</div>
			</div>
		</div>
	</section>

	<section id="risk-management" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Risk Management</h2>
		<div class="space-y-4">
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Set Limits</h3>
				<p class="text-dark-300 text-sm">
					Decide your gambling budget before you start. Stop when you hit your limit, win or lose.
				</p>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Bet Sizing</h3>
				<p class="text-dark-300 text-sm">
					Bet small percentages of your total. The minimum (🪙 10) lets you play longer.
					The maximum (🪙 10,000) is for high rollers only.
				</p>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Know the Odds</h3>
				<p class="text-dark-300 text-sm">
					Coin flip: 50% win rate, 0 EV<br/>
					Slots: Variable, negative EV<br/>
					Blackjack: ~49% win rate with perfect play
				</p>
			</div>
		</div>
	</section>

	<section id="tips" class="mb-8">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Pro Tips</h2>
		<div class="space-y-3">
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">1</span>
				<p class="text-dark-300">For consistent odds, stick to coin flip. It's the fairest game with no house edge per bet.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">2</span>
				<p class="text-dark-300">Slots is entertainment, not investment. Play for the thrill of big wins, not expected profit.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">3</span>
				<p class="text-dark-300">Blackjack rewards study. Learn basic strategy to minimize the house edge.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">4</span>
				<p class="text-dark-300">Never gamble with coins you need. Keep your core savings in the bank, gamble with wallet funds you can afford to lose.</p>
			</div>
		</div>
	</section>
</GuideLayout>
