<script lang="ts">
	import GuideLayout from '$lib/components/templates/GuideLayout.svelte';
	import CodeBlock from '$lib/components/atoms/CodeBlock.svelte';

	const toc = [
		{ id: 'overview', text: 'Overview', level: 2 },
		{ id: 'how-to-play', text: 'How to Play', level: 2 },
		{ id: 'starting-a-game', text: 'Starting a Game', level: 3 },
		{ id: 'gameplay-loop', text: 'Gameplay Loop', level: 3 },
		{ id: 'game-outcomes', text: 'Game Outcomes', level: 3 },
		{ id: 'field-positions', text: 'Field Position Table', level: 2 },
		{ id: 'strategy', text: 'Strategy Guide', level: 2 },
		{ id: 'always-run', text: 'Always Run Zone', level: 3 },
		{ id: 'danger-zone', text: 'The Danger Zone', level: 3 },
		{ id: 'high-stakes', text: 'High Stakes Territory', level: 3 },
		{ id: 'expected-value', text: 'Expected Value Analysis', level: 2 },
		{ id: 'leaderboards', text: 'Stats & Leaderboards', level: 2 },
		{ id: 'tips', text: 'Pro Tips', level: 2 }
	];
</script>

<svelte:head>
	<title>Red Zone Guide - CommishBot Docs</title>
	<meta name="description" content="Master the Red Zone push-your-luck football game. Learn field positions, fumble risks, cash-out strategies, and how to maximize your touchdown chances." />
	<meta property="og:title" content="Red Zone Guide - CommishBot Docs" />
	<meta property="og:description" content="Drive 80 yards for a 10x payout - or fumble it all away. Master the Red Zone strategy." />
	<meta property="og:type" content="article" />
	<link rel="canonical" href="https://commishbot-docs.pages.dev/guides/redzone" />
</svelte:head>

<GuideLayout
	title="Red Zone Guide"
	description="Master the push-your-luck football game"
	{toc}
>
	<section id="overview" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Overview</h2>
		<p class="text-dark-300 mb-4">
			Red Zone is a push-your-luck football minigame where you drive 80 yards for a chance at
			a <strong class="text-accent-success">10x payout</strong>. Start at your own 20-yard line,
			gain 5-20 yards per play, but watch out - fumble risk increases as you get closer to the end zone!
		</p>
		<div class="grid md:grid-cols-3 gap-4 mt-6">
			<div class="card text-center">
				<div class="text-3xl mb-2">10x</div>
				<h3 class="font-semibold text-dark-100">Touchdown Payout</h3>
				<p class="text-dark-400 text-sm">Reach the end zone for maximum reward</p>
			</div>
			<div class="card text-center">
				<div class="text-3xl mb-2">5-20</div>
				<h3 class="font-semibold text-dark-100">Yards Per Play</h3>
				<p class="text-dark-400 text-sm">Random gain each run</p>
			</div>
			<div class="card text-center">
				<div class="text-3xl mb-2">0-52%</div>
				<h3 class="font-semibold text-dark-100">Fumble Risk</h3>
				<p class="text-dark-400 text-sm">Increases as you advance</p>
			</div>
		</div>
	</section>

	<section id="how-to-play" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">How to Play</h2>

		<div id="starting-a-game" class="mb-8">
			<h3 class="text-xl font-bold text-dark-100 mb-3">Starting a Game</h3>
			<p class="text-dark-300 mb-4">
				Start a game with the <code class="text-accent-primary">/redzone</code> command and a bet amount.
			</p>
			<div class="card mb-4">
				<CodeBlock code="/redzone bet:500" language="text" showCopy={false} />
				<p class="text-dark-400 text-sm mt-2">Bet 500 coins to start a drive</p>
			</div>
			<div class="grid md:grid-cols-2 gap-4">
				<div class="card">
					<h4 class="font-semibold text-dark-100 mb-2">Bet Limits</h4>
					<ul class="space-y-1 text-dark-300 text-sm">
						<li>Minimum: 10 coins</li>
						<li>Maximum: 10,000 coins</li>
						<li>Use "all" or "max" to bet your entire wallet</li>
					</ul>
				</div>
				<div class="card">
					<h4 class="font-semibold text-dark-100 mb-2">Requirements</h4>
					<ul class="space-y-1 text-dark-300 text-sm">
						<li>Coins must be in your wallet</li>
						<li>10-second cooldown between games</li>
						<li>2-minute timeout per game</li>
					</ul>
				</div>
			</div>
		</div>

		<div id="gameplay-loop" class="mb-8">
			<h3 class="text-xl font-bold text-dark-100 mb-3">Gameplay Loop</h3>
			<p class="text-dark-300 mb-4">
				Each turn, you choose one of two actions using interactive buttons:
			</p>
			<div class="space-y-4">
				<div class="card border-accent-primary/30">
					<div class="flex items-center gap-3">
						<span class="text-2xl">&#x1F3C8;</span>
						<div>
							<h4 class="font-semibold text-dark-100">Run Play</h4>
							<p class="text-dark-300 text-sm">
								Attempt to advance down the field. If you don't fumble, you gain 5-20 yards randomly.
								If you reach 100+ yards, TOUCHDOWN!
							</p>
						</div>
					</div>
				</div>
				<div class="card border-accent-success/30">
					<div class="flex items-center gap-3">
						<span class="text-2xl">&#x1F4B0;</span>
						<div>
							<h4 class="font-semibold text-dark-100">Cash Out</h4>
							<p class="text-dark-300 text-sm">
								End the game and collect your current multiplier. Lock in your winnings before risking a fumble.
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div id="game-outcomes" class="mb-8">
			<h3 class="text-xl font-bold text-dark-100 mb-3">Game Outcomes</h3>
			<div class="grid md:grid-cols-3 gap-4">
				<div class="card border-accent-success/30">
					<div class="text-2xl mb-2 text-center">&#x1F3C6;</div>
					<h4 class="font-semibold text-accent-success text-center mb-2">Touchdown</h4>
					<p class="text-dark-300 text-sm text-center">
						Reach 100 yards for <strong>10x payout</strong>
					</p>
				</div>
				<div class="card border-accent-primary/30">
					<div class="text-2xl mb-2 text-center">&#x1F4B0;</div>
					<h4 class="font-semibold text-accent-primary text-center mb-2">Cash Out</h4>
					<p class="text-dark-300 text-sm text-center">
						Take your current multiplier (1.0x - 7.5x)
					</p>
				</div>
				<div class="card border-accent-danger/30">
					<div class="text-2xl mb-2 text-center">&#x1F4A5;</div>
					<h4 class="font-semibold text-accent-danger text-center mb-2">Fumble</h4>
					<p class="text-dark-300 text-sm text-center">
						Lose the ball and your entire bet
					</p>
				</div>
			</div>
		</div>
	</section>

	<section id="field-positions" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Field Position Table</h2>
		<p class="text-dark-300 mb-4">
			Risk and reward scale as you advance down the field. The closer to the end zone, the higher the multiplier - but also the higher the fumble chance.
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm min-w-[600px]">
				<thead>
					<tr class="text-left text-dark-400 border-b border-dark-border">
						<th class="pb-3">Yard Line</th>
						<th class="pb-3">Position</th>
						<th class="pb-3">Multiplier</th>
						<th class="pb-3">Fumble Risk</th>
						<th class="pb-3">Risk Level</th>
					</tr>
				</thead>
				<tbody class="text-dark-200">
					<tr class="border-b border-dark-border">
						<td class="py-3">20</td>
						<td class="py-3">Own 20 (Start)</td>
						<td class="py-3">1.0x</td>
						<td class="py-3 text-accent-success font-bold">0%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-success/20 text-accent-success rounded text-xs">Safe</span></td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3">30</td>
						<td class="py-3">Own 30</td>
						<td class="py-3">1.2x</td>
						<td class="py-3">8%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-success/20 text-accent-success rounded text-xs">Low</span></td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3">40</td>
						<td class="py-3">Own 40</td>
						<td class="py-3">1.5x</td>
						<td class="py-3">12%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-success/20 text-accent-success rounded text-xs">Low</span></td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3">50</td>
						<td class="py-3 font-semibold">Midfield</td>
						<td class="py-3 text-accent-primary">2.0x</td>
						<td class="py-3">18%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-warning/20 text-accent-warning rounded text-xs">Medium</span></td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3">60</td>
						<td class="py-3">Opp 40</td>
						<td class="py-3 text-accent-primary">2.8x</td>
						<td class="py-3 text-accent-warning">25%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-warning/20 text-accent-warning rounded text-xs">Medium-High</span></td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3">70</td>
						<td class="py-3">Opp 30</td>
						<td class="py-3 text-accent-success">4.0x</td>
						<td class="py-3 text-accent-warning">33%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-danger/20 text-accent-danger rounded text-xs">High</span></td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3">80</td>
						<td class="py-3 font-semibold text-accent-danger">RED ZONE</td>
						<td class="py-3 text-accent-success">5.5x</td>
						<td class="py-3 text-accent-danger">42%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-danger/20 text-accent-danger rounded text-xs">Very High</span></td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3">90</td>
						<td class="py-3">Opp 10</td>
						<td class="py-3 text-accent-success font-bold">7.5x</td>
						<td class="py-3 text-accent-danger font-bold">52%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-danger/20 text-accent-danger rounded text-xs">Critical</span></td>
					</tr>
					<tr>
						<td class="py-3 font-bold">100</td>
						<td class="py-3 font-bold text-accent-success">TOUCHDOWN!</td>
						<td class="py-3 text-accent-success font-bold">10.0x</td>
						<td class="py-3 text-accent-success">0%</td>
						<td class="py-3"><span class="px-2 py-1 bg-accent-success/20 text-accent-success rounded text-xs">WIN!</span></td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="strategy" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Strategy Guide</h2>
		<p class="text-dark-300 mb-4">
			The field can be divided into three zones with different optimal strategies:
		</p>

		<div id="always-run" class="mb-6">
			<div class="card border-accent-success/30">
				<h3 class="text-xl font-bold text-dark-100 mb-3">Always Run Zone (Own 20 - Own 40)</h3>
				<p class="text-dark-300 mb-3">
					Fumble risk is minimal (0-12%) and your multiplier is low (1.0x - 1.5x).
					<strong>There's no good reason to cash out early.</strong>
				</p>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>At 1.0x you're just getting your bet back</li>
					<li>At 1.5x you're barely profiting</li>
					<li>Expected value of continuing is higher than cashing out</li>
				</ul>
			</div>
		</div>

		<div id="danger-zone" class="mb-6">
			<div class="card border-accent-warning/30">
				<h3 class="text-xl font-bold text-dark-100 mb-3">The Danger Zone (Midfield - Opp 30)</h3>
				<p class="text-dark-300 mb-3">
					Fumble risk is climbing (18-33%) but you're building meaningful profit (2.0x - 4.0x).
					<strong>Consider your risk tolerance.</strong>
				</p>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>Mathematically, running is still +EV</li>
					<li>But losing a 4.0x multiplier hurts</li>
					<li>Aggressive players push through; conservative players start eyeing cash out</li>
				</ul>
			</div>
		</div>

		<div id="high-stakes" class="mb-6">
			<div class="card border-accent-danger/30">
				<h3 class="text-xl font-bold text-dark-100 mb-3">High Stakes Territory (Red Zone - Opp 10)</h3>
				<p class="text-dark-300 mb-3">
					You're flipping coins with serious money on the line (42-52% fumble chance).
					<strong>Are you feeling lucky?</strong>
				</p>
				<ul class="space-y-1 text-dark-300 text-sm">
					<li>At 5.5x - 7.5x, you've already won big</li>
					<li>Going for the TD is pure gambling</li>
					<li>The 10x is tantalizing, but so is walking away with 7.5x</li>
				</ul>
			</div>
		</div>
	</section>

	<section id="expected-value" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Expected Value Analysis</h2>
		<p class="text-dark-300 mb-4">
			Mathematically, the expected value of running another play stays positive all the way to the goal line.
			Here's the EV at each position:
		</p>
		<div class="overflow-x-auto mb-6">
			<table class="w-full text-sm min-w-[400px]">
				<thead>
					<tr class="text-left text-dark-400 border-b border-dark-border">
						<th class="pb-3">Position</th>
						<th class="pb-3">Cash Out Value</th>
						<th class="pb-3">EV if Run</th>
						<th class="pb-3">Difference</th>
					</tr>
				</thead>
				<tbody class="text-dark-200">
					<tr class="border-b border-dark-border">
						<td class="py-2">Own 30</td>
						<td class="py-2">1.2x</td>
						<td class="py-2">1.10x</td>
						<td class="py-2 text-accent-danger">-0.10x</td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-2">Midfield</td>
						<td class="py-2">2.0x</td>
						<td class="py-2">1.64x</td>
						<td class="py-2 text-accent-danger">-0.36x</td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-2">Opp 30</td>
						<td class="py-2">4.0x</td>
						<td class="py-2">2.68x</td>
						<td class="py-2 text-accent-danger">-1.32x</td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-2">Red Zone</td>
						<td class="py-2">5.5x</td>
						<td class="py-2">3.19x</td>
						<td class="py-2 text-accent-danger">-2.31x</td>
					</tr>
					<tr>
						<td class="py-2">Opp 10</td>
						<td class="py-2">7.5x</td>
						<td class="py-2">3.60x</td>
						<td class="py-2 text-accent-danger">-3.90x</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div class="card border-accent-warning/30">
			<h4 class="font-semibold text-dark-100 mb-2">Wait, the EV is negative?</h4>
			<p class="text-dark-300 text-sm">
				The EV shown is for a <strong>single play</strong>, comparing immediate cash out vs. one more run.
				However, the game involves <strong>multiple plays</strong> to reach the end zone.
				If you always run, your overall EV from the start is positive because touchdowns pay 10x.
				The key insight: <strong>variance is high</strong>. Math says run, but your bankroll and risk tolerance matter.
			</p>
		</div>
	</section>

	<section id="leaderboards" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Stats & Leaderboards</h2>
		<p class="text-dark-300 mb-4">
			Every Red Zone game is tracked automatically. Check the leaderboards with <code class="text-accent-primary">/redzoneleaderboard</code>.
		</p>
		<div class="grid md:grid-cols-2 gap-4">
			<div class="card">
				<h4 class="font-semibold text-dark-100 mb-3">Leaderboard Categories</h4>
				<ul class="space-y-2 text-dark-300 text-sm">
					<li><strong>Most Touchdowns</strong> - Total TDs scored</li>
					<li><strong>Highest TD Rate</strong> - Win percentage (min 10 games)</li>
					<li><strong>Longest Drive</strong> - Most yards in a single game</li>
					<li><strong>Highest Profit</strong> - Net winnings over all games</li>
					<li><strong>Best TD Streak</strong> - Consecutive touchdowns</li>
					<li><strong>Biggest Single Win</strong> - Largest payout</li>
				</ul>
			</div>
			<div class="card">
				<h4 class="font-semibold text-dark-100 mb-3">Stats Tracked</h4>
				<ul class="space-y-2 text-dark-300 text-sm">
					<li>Games played, touchdowns, fumbles, cashouts</li>
					<li>Current TD streak (positive) or fumble streak (negative)</li>
					<li>Best/worst streaks of all time</li>
					<li>Total yards gained across all games</li>
					<li>Total wagered and total won</li>
					<li>Biggest single win profit</li>
				</ul>
			</div>
		</div>
		<p class="mt-4 text-dark-400 text-sm">
			<strong>Streak tracking:</strong> Consecutive touchdowns count as a positive streak.
			Cashing out resets your streak to 0. Consecutive fumbles count as a negative streak.
		</p>
	</section>

	<section id="tips" class="mb-8">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Pro Tips</h2>
		<div class="space-y-3">
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">1</span>
				<p class="text-dark-300">Never cash out before midfield. The fumble risk is too low and the multiplier too small to justify leaving early.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">2</span>
				<p class="text-dark-300">If you're playing for profit, the 4.0x at Opp 30 is a solid cash-out point. You've tripled up with reasonable risk.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">3</span>
				<p class="text-dark-300">If you're chasing leaderboards, always go for the touchdown. Streaks only count TDs, and cash-outs reset them.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">4</span>
				<p class="text-dark-300">The "Play Again" button keeps your bet size. Use it to quickly run multiple games, but watch your bankroll.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">5</span>
				<p class="text-dark-300">Bet sizing matters. If you're on a cold streak, drop to minimum bets until you break through.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">6</span>
				<p class="text-dark-300">The game has a 2-minute timeout. Don't leave a game sitting - it will auto-cash you out at your current position.</p>
			</div>
		</div>
	</section>
</GuideLayout>
