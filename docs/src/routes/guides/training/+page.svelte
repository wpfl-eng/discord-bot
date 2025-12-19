<script lang="ts">
	import GuideLayout from '$lib/components/templates/GuideLayout.svelte';
	import CodeBlock from '$lib/components/atoms/CodeBlock.svelte';

	const toc = [
		{ id: 'overview', text: 'Overview', level: 2 },
		{ id: 'grid', text: 'The Training Grid', level: 2 },
		{ id: 'states', text: 'Slot States', level: 3 },
		{ id: 'positions', text: 'Position Tiers', level: 2 },
		{ id: 'workflow', text: 'Gameplay Workflow', level: 2 },
		{ id: 'timing', text: 'Timing Strategy', level: 2 },
		{ id: 'starter-kit', text: 'Starter Kit', level: 2 },
		{ id: 'tips', text: 'Pro Tips', level: 2 }
	];
</script>

<svelte:head>
	<title>Training Ground Guide - CommishBot Docs</title>
	<meta name="description" content="Master the Training Ground idle game - develop rookies into coin rewards, manage your grid, and optimize timing strategies." />
	<meta property="og:title" content="Training Ground Guide - CommishBot Docs" />
	<meta property="og:description" content="Learn the idle game mechanics for maximum coin returns." />
	<meta property="og:type" content="article" />
	<link rel="canonical" href="https://commishbot-docs.pages.dev/guides/training" />
</svelte:head>

<GuideLayout
	title="Training Ground Guide"
	description="Master the idle game mechanics for maximum coin returns"
	{toc}
>
	<section id="overview" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Overview</h2>
		<p class="text-dark-300 mb-4">
			The Training Ground is an idle game where you develop rookie football players into coin rewards.
			Manage a 3x3 grid of training slots, time your actions carefully, and graduate players before they bust!
		</p>
		<div class="card">
			<h3 class="font-semibold text-dark-100 mb-3">Core Loop</h3>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<span class="px-3 py-1.5 bg-dark-bg rounded-lg">1. Setup slot</span>
				<span class="text-dark-500">→</span>
				<span class="px-3 py-1.5 bg-dark-bg rounded-lg">2. Hydrate</span>
				<span class="text-dark-500">→</span>
				<span class="px-3 py-1.5 bg-dark-bg rounded-lg">3. Draft rookie</span>
				<span class="text-dark-500">→</span>
				<span class="px-3 py-1.5 bg-dark-bg rounded-lg">4. Wait for training</span>
				<span class="text-dark-500">→</span>
				<span class="px-3 py-1.5 bg-accent-primary/20 text-accent-primary rounded-lg">5. Graduate for coins!</span>
			</div>
		</div>
	</section>

	<section id="grid" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">The Training Grid</h2>
		<p class="text-dark-300 mb-4">
			Your Training Ground is a 3x3 grid (9 slots total). Each slot operates independently.
		</p>
		<div class="card text-center p-8 mb-4">
			<div class="inline-grid grid-cols-3 gap-2 text-2xl">
				<span>⬛</span><span>🟫</span><span>💧</span>
				<span>🏃</span><span>⭐</span><span>💀</span>
				<span>🤲</span><span>🤲</span><span>🎯</span>
			</div>
			<p class="text-dark-400 text-sm mt-4">Example grid showing various states</p>
		</div>

		<div id="states" class="mt-8">
			<h3 class="text-xl font-bold text-dark-100 mb-4">Slot States</h3>
			<div class="grid gap-3">
				<div class="flex items-center gap-4 p-3 bg-dark-bg rounded-lg">
					<span class="text-2xl">⬛</span>
					<div>
						<span class="font-semibold text-dark-100">Empty</span>
						<p class="text-dark-400 text-sm">Untouched slot - needs Setup Kit</p>
					</div>
				</div>
				<div class="flex items-center gap-4 p-3 bg-dark-bg rounded-lg">
					<span class="text-2xl">🟫</span>
					<div>
						<span class="font-semibold text-dark-100">Prepared</span>
						<p class="text-dark-400 text-sm">Equipment set up - needs hydration</p>
					</div>
				</div>
				<div class="flex items-center gap-4 p-3 bg-dark-bg rounded-lg">
					<span class="text-2xl">💧</span>
					<div>
						<span class="font-semibold text-dark-100">Hydrated</span>
						<p class="text-dark-400 text-sm">Ready to draft a rookie</p>
					</div>
				</div>
				<div class="flex items-center gap-4 p-3 bg-dark-bg rounded-lg">
					<span class="text-2xl">🤲🏃🎯🏈</span>
					<div>
						<span class="font-semibold text-dark-100">Training</span>
						<p class="text-dark-400 text-sm">Player developing (shows position emoji)</p>
					</div>
				</div>
				<div class="flex items-center gap-4 p-3 bg-dark-bg rounded-lg">
					<span class="text-2xl">⭐</span>
					<div>
						<span class="font-semibold text-accent-success">Ready!</span>
						<p class="text-dark-400 text-sm">Graduate now for coins! ⏰ Time-sensitive</p>
					</div>
				</div>
				<div class="flex items-center gap-4 p-3 bg-dark-bg rounded-lg">
					<span class="text-2xl">💀</span>
					<div>
						<span class="font-semibold text-accent-danger">Busted</span>
						<p class="text-dark-400 text-sm">Missed the window - use Clear to reset</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section id="positions" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Position Tiers</h2>
		<p class="text-dark-300 mb-4">
			Different positions have different training times, costs, and rewards. Higher tiers take longer but pay more.
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm min-w-[500px]">
				<thead>
					<tr class="text-left text-dark-400 border-b border-dark-border">
						<th class="pb-3">Position</th>
						<th class="pb-3">Contract Cost</th>
						<th class="pb-3">Train Time</th>
						<th class="pb-3">Reward</th>
						<th class="pb-3">Wilt Window</th>
					</tr>
				</thead>
				<tbody class="text-dark-200">
					<tr class="border-b border-dark-border">
						<td class="py-3"><span class="mr-2">🤲</span> Tight End</td>
						<td class="py-3">🪙 50</td>
						<td class="py-3">5 min</td>
						<td class="py-3 text-accent-success">🪙 75-100</td>
						<td class="py-3">15 min</td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3"><span class="mr-2">🏃</span> Running Back</td>
						<td class="py-3">🪙 100</td>
						<td class="py-3">10 min</td>
						<td class="py-3 text-accent-success">🪙 150-200</td>
						<td class="py-3">20 min</td>
					</tr>
					<tr class="border-b border-dark-border">
						<td class="py-3"><span class="mr-2">🎯</span> Wide Receiver</td>
						<td class="py-3">🪙 150</td>
						<td class="py-3">15 min</td>
						<td class="py-3 text-accent-success">🪙 225-300</td>
						<td class="py-3">25 min</td>
					</tr>
					<tr>
						<td class="py-3"><span class="mr-2">🏈</span> Quarterback</td>
						<td class="py-3">🪙 250</td>
						<td class="py-3">25 min</td>
						<td class="py-3 text-accent-success">🪙 375-500</td>
						<td class="py-3">30 min</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div class="mt-4 p-4 bg-accent-info/10 border border-accent-info/20 rounded-lg">
			<p class="text-accent-info text-sm">
				<strong>ROI Analysis:</strong> All positions offer similar return rates (~50-100% profit).
				Choose based on how actively you can monitor training.
			</p>
		</div>
	</section>

	<section id="workflow" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Gameplay Workflow</h2>
		<div class="space-y-4">
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Step 1: Setup</h3>
				<p class="text-dark-300 text-sm mb-2">Use a <strong>🔧 Setup Kit</strong> on an empty (⬛) slot.</p>
				<CodeBlock code="/train manage → Select slot → Setup" language="text" showCopy={false} />
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Step 2: Hydrate</h3>
				<p class="text-dark-300 text-sm mb-2">Use a <strong>💧 Water Cooler</strong> on a prepared (🟫) slot.</p>
				<CodeBlock code="/train manage → Select slot → Hydrate" language="text" showCopy={false} />
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Step 3: Draft</h3>
				<p class="text-dark-300 text-sm mb-2">Use a <strong>Position Contract</strong> to draft a rookie.</p>
				<CodeBlock code="/train manage → Select slot → Draft → Choose position" language="text" showCopy={false} />
			</div>
			<div class="card">
				<h3 class="font-semibold text-dark-100 mb-2">Step 4: Wait</h3>
				<p class="text-dark-300 text-sm">The player trains automatically. Check back after the training time.</p>
			</div>
			<div class="card border-accent-success/30">
				<h3 class="font-semibold text-accent-success mb-2">Step 5: Graduate!</h3>
				<p class="text-dark-300 text-sm mb-2">When you see ⭐, graduate immediately for coins!</p>
				<CodeBlock code="/train manage → Select ⭐ slot → Graduate → 🪙 Profit!" language="text" showCopy={false} />
			</div>
		</div>
	</section>

	<section id="timing" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Timing Strategy</h2>
		<p class="text-dark-300 mb-4">
			The key to success is graduating players before they <strong class="text-accent-danger">bust (💀)</strong>.
			Each position has a "wilt window" - the time between ready (⭐) and busted.
		</p>
		<div class="card border-accent-warning/30">
			<h3 class="font-semibold text-accent-warning mb-3">⚠️ Wilt Windows</h3>
			<ul class="space-y-2 text-dark-300 text-sm">
				<li><span class="mr-2">🤲</span> TE: 15 minutes to graduate</li>
				<li><span class="mr-2">🏃</span> RB: 20 minutes to graduate</li>
				<li><span class="mr-2">🎯</span> WR: 25 minutes to graduate</li>
				<li><span class="mr-2">🏈</span> QB: 30 minutes to graduate</li>
			</ul>
		</div>
		<p class="mt-4 text-dark-400 text-sm">
			If you miss the wilt window, use <strong>Clear</strong> to remove the busted slot and start over.
		</p>
	</section>

	<section id="starter-kit" class="mb-12">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Starter Kit</h2>
		<p class="text-dark-300 mb-4">
			New users automatically receive a starter kit to begin training:
		</p>
		<div class="card">
			<ul class="space-y-2 text-dark-200">
				<li class="flex items-center gap-2">
					<span class="text-xl">🔧</span>
					<span>10x Setup Kit</span>
				</li>
				<li class="flex items-center gap-2">
					<span class="text-xl">💧</span>
					<span>10x Water Cooler</span>
				</li>
				<li class="flex items-center gap-2">
					<span class="text-xl">🤲</span>
					<span>2x TE Contract</span>
				</li>
			</ul>
		</div>
		<p class="mt-4 text-dark-400 text-sm">
			Replenish supplies from <code class="text-accent-primary">/shop</code>.
		</p>
	</section>

	<section id="tips" class="mb-8">
		<h2 class="text-2xl font-bold text-dark-100 mb-4">Pro Tips</h2>
		<div class="space-y-3">
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">1</span>
				<p class="text-dark-300">Start with TEs - they're cheap, fast, and give you time to learn the system.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">2</span>
				<p class="text-dark-300">Set timers! Train time + wilt window = total time before bust. Don't lose your investment.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">3</span>
				<p class="text-dark-300">Stagger your drafts so players become ready at different times - easier to manage.</p>
			</div>
			<div class="flex items-start gap-3 p-4 bg-dark-bg rounded-lg">
				<span class="text-accent-success text-lg">4</span>
				<p class="text-dark-300">QBs have the highest absolute profit but require the longest commitment. Use when you'll be around for ~55 min.</p>
			</div>
		</div>
	</section>
</GuideLayout>
