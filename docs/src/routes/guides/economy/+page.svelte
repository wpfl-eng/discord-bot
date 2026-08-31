<script lang="ts">
	import GuideLayout from '$lib/components/templates/GuideLayout.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';

	const toc = [
		{ id: 'overview', text: 'Overview', level: 2 },
		{ id: 'earning-coins', text: 'Earning Coins', level: 2 },
		{ id: 'daily-bonus', text: 'Daily Bonus', level: 3 },
		{ id: 'work', text: 'Work System', level: 3 },
		{ id: 'managing-wealth', text: 'Managing Your Wealth', level: 2 },
		{ id: 'wallet-vs-bank', text: 'Wallet vs Bank', level: 3 },
		{ id: 'bank-expansion', text: 'Bank Expansion', level: 3 },
		{ id: 'tips', text: 'Pro Tips', level: 2 }
	];
</script>

<svelte:head>
	<title>Economy System Guide - CommishBot Docs</title>
	<meta name="description" content="Master the CommishBot coin economy - earn with daily bonuses and work, and manage your bank and wallet." />
	<meta property="og:title" content="Economy System Guide - CommishBot Docs" />
	<meta property="og:description" content="Learn how to earn, save, and grow your wealth in CommishBot." />
	<meta property="og:type" content="article" />
	<link rel="canonical" href="https://commishbot-docs.pages.dev/guides/economy" />
</svelte:head>

<GuideLayout
	title="Economy System Guide"
	description="Master the coin economy to build your fortune"
	{toc}
>
	<section id="overview" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Overview</h2>
		<p class="text-dark-300 mb-4">
			The CommishBot economy is a virtual currency system using <span class="text-accent-primary">🪙 coins</span>.
			Coins are used for gambling, betting, purchasing items, and competing on the leaderboard.
		</p>
		<div class="grid md:grid-cols-2 gap-4">
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Ways to Earn</h3>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>• Daily bonus (100+ coins)</li>
					<li>• Work command (20-80 coins)</li>
					<li>• Gambling winnings</li>
					<li>• Trivia and Wordle rewards</li>
				</ul>
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Ways to Spend</h3>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>• Gambling (slots, blackjack, coin flip)</li>
					<li>• Shop purchases (bank expansions)</li>
					<li>• User-to-user bets</li>
					<li>• Stock trading</li>
				</ul>
			</div>
		</div>
	</section>

	<section id="earning-coins" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Earning Coins</h2>

		<div id="daily-bonus" class="mb-8">
			<h3 class="text-xl font-bold text-dark-100 mb-3">Daily Bonus</h3>
			<p class="text-dark-300 mb-4">
				The <code class="text-accent-primary">/daily</code> command is your most reliable income source.
			</p>
			<div class="card mb-4 overflow-x-auto">
				<table class="w-full text-sm min-w-[400px]">
					<thead>
						<tr class="text-left text-dark-400">
							<th class="pb-2">Component</th>
							<th class="pb-2">Amount</th>
							<th class="pb-2">Notes</th>
						</tr>
					</thead>
					<tbody class="text-dark-200">
						<tr class="border-t border-dark-border">
							<td class="py-2">Base Salary</td>
							<td class="py-2 text-accent-success">🪙 100</td>
							<td class="py-2">Every 24 hours</td>
						</tr>
						<tr class="border-t border-dark-border">
							<td class="py-2">Streak Bonus</td>
							<td class="py-2 text-accent-success">+🪙 10/day</td>
							<td class="py-2">Up to +100 max</td>
						</tr>
						<tr class="border-t border-dark-border">
							<td class="py-2">Maximum Daily</td>
							<td class="py-2 text-accent-primary font-bold">🪙 200</td>
							<td class="py-2">Day 11 and beyond</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div class="p-4 bg-accent-warning/10 border border-accent-warning/20 rounded-lg">
				<p class="text-accent-warning text-sm">
					<strong>Important:</strong> Streaks expire after 48 hours of inactivity. Collect daily to maintain your bonus!
				</p>
			</div>
		</div>

		<div id="work" class="mb-8">
			<h3 class="text-xl font-bold text-dark-100 mb-3">Work System</h3>
			<p class="text-dark-300 mb-4">
				The <code class="text-accent-primary">/work</code> command lets you earn coins every 30 minutes through football-themed activities.
			</p>
			<div class="card">
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div>
						<span class="text-dark-400">Earnings:</span>
						<span class="text-dark-100 ml-2">🪙 20-80</span>
					</div>
					<div>
						<span class="text-dark-400">Success Rate:</span>
						<span class="text-dark-100 ml-2">70%</span>
					</div>
					<div>
						<span class="text-dark-400">Cooldown:</span>
						<span class="text-dark-100 ml-2">30 minutes</span>
					</div>
					<div>
						<span class="text-dark-400">Failure Penalty:</span>
						<span class="text-dark-100 ml-2">🪙 0 (no loss)</span>
					</div>
				</div>
			</div>
			<p class="mt-4 text-dark-400 text-sm">
				Work activities include running routes, studying film, attending press conferences, and more.
				Failures have funny football-themed messages but don't cost you anything.
			</p>
		</div>
	</section>

	<section id="managing-wealth" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Managing Your Wealth</h2>

		<div id="wallet-vs-bank" class="mb-8">
			<h3 class="text-xl font-bold text-dark-100 mb-3">Wallet vs Bank</h3>
			<div class="grid md:grid-cols-2 gap-4">
				<div class="card border-accent-warning/30">
					<h4 class="font-semibold text-accent-warning mb-2">💰 Wallet</h4>
					<ul class="space-y-1 text-dark-300 text-sm">
						<li>• Used for all transactions</li>
						<li>• Required for gambling/betting</li>
						<li>• No capacity limit</li>
					</ul>
				</div>
				<div class="card border-accent-success/30">
					<h4 class="font-semibold text-accent-success mb-2">🏦 Bank</h4>
					<ul class="space-y-1 text-dark-300 text-sm">
						<li>• Starting capacity: 1,000</li>
						<li>• Can be expanded</li>
						<li>• Use /deposit and /withdraw</li>
					</ul>
				</div>
			</div>
		</div>

		<div id="bank-expansion" class="mb-8">
			<h3 class="text-xl font-bold text-dark-100 mb-3">Bank Expansion</h3>
			<p class="text-dark-300 mb-4">
				Increase your bank capacity by purchasing Bank Expansions from <code class="text-accent-primary">/shop</code>.
			</p>
			<div class="card overflow-x-auto">
				<table class="w-full text-sm min-w-[300px]">
					<tbody class="text-dark-200">
						<tr class="border-b border-dark-border">
							<td class="py-2">Cost per expansion</td>
							<td class="py-2 text-right">🪙 2,000</td>
						</tr>
						<tr class="border-b border-dark-border">
							<td class="py-2">Capacity added</td>
							<td class="py-2 text-right">+🪙 1,000</td>
						</tr>
						<tr>
							<td class="py-2">No limit</td>
							<td class="py-2 text-right text-dark-400">Stack as many as you want</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</section>

	<section id="tips" class="mb-8">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Pro Tips</h2>
		<div class="space-y-3">
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">1</span>
				<p class="text-dark-300">Collect daily <strong>every day</strong> to maximize streak bonuses. At max streak, you earn 200 coins/day guaranteed.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">2</span>
				<p class="text-dark-300">Keep most of your coins in the bank. Only withdraw what you need for gambling or purchases.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">3</span>
				<p class="text-dark-300">Use /work during downtime - even with 70% success, it averages ~35 coins per attempt with zero risk.</p>
			</div>
		</div>
	</section>
</GuideLayout>
