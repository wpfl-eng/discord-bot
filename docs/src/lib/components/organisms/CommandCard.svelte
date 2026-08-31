<script lang="ts">
	import Badge from '$lib/components/atoms/Badge.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import type { Command } from '$lib/types/command';

	interface Props {
		command: Command;
		compact?: boolean;
	}

	let { command, compact = false }: Props = $props();

	const categoryIcons: Record<string, string> = {
		'fantasy-football': 'football',
		'draft-analysis': 'chart',
		'performance-analysis': 'trophy',
		economy: 'coins',
		gambling: 'dice',
		'shop-inventory': 'cart',
		trivia: 'question',
		betting: 'ticket',
		utility: 'wrench'
	};
</script>

<a
	href="/commands/{command.categorySlug}/{command.name}"
	class="card group hover:border-accent-primary/50 transition-all duration-200 block"
>
	<div class="flex items-start gap-3">
		<div class="p-2 rounded-lg bg-dark-hover text-dark-300 group-hover:text-accent-primary group-hover:bg-accent-primary/10 transition-colors">
			<Icon name={categoryIcons[command.categorySlug] || 'book'} size="md" />
		</div>
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 flex-wrap">
				<h3 class="font-mono text-dark-100 group-hover:text-accent-primary transition-colors">
					/{command.name}
				</h3>
				<Badge variant="category" text={command.category} />
			</div>
			<p class="mt-1 text-sm text-dark-400 line-clamp-2">{command.description}</p>

			{#if !compact && command.options && command.options.length > 0}
				<div class="mt-3 flex flex-wrap gap-1">
					{#each command.options.slice(0, 3) as option}
						<span class="text-xs px-2 py-0.5 bg-dark-bg rounded-md text-dark-300 font-mono">
							{option.name}
						</span>
					{/each}
					{#if command.options.length > 3}
						<span class="text-xs px-2 py-0.5 bg-dark-bg rounded-md text-dark-400">
							+{command.options.length - 3} more
						</span>
					{/if}
				</div>
			{/if}

			{#if !compact && command.cooldown}
				<div class="mt-2 flex items-center gap-1 text-xs text-dark-400">
					<span class="text-accent-warning">⏱</span>
					{command.cooldown.duration}{command.cooldown.unit.charAt(0)} cooldown
				</div>
			{/if}
		</div>
		<Icon name="chevronRight" size="sm" class="text-dark-500 group-hover:text-dark-300 transition-colors" />
	</div>
</a>
