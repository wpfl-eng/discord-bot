<script lang="ts">
	import Badge from '$lib/components/atoms/Badge.svelte';
	import type { CommandOption } from '$lib/types/command';

	interface Props {
		option: CommandOption;
	}

	let { option }: Props = $props();

	function formatType(type: string): string {
		const typeMap: Record<string, string> = {
			string: 'text',
			integer: 'number',
			number: 'decimal',
			boolean: 'true/false',
			user: '@user'
		};
		return typeMap[type] || type;
	}
</script>

<div class="flex flex-col gap-2 p-4 bg-dark-bg rounded-lg border border-dark-border">
	<div class="flex items-center gap-2 flex-wrap">
		<code class="text-accent-primary font-mono text-sm">{option.name}</code>
		<Badge variant={option.required ? 'required' : 'optional'} text={option.required ? 'Required' : 'Optional'} />
		<Badge variant="type" text={formatType(option.type)} />
	</div>
	<p class="text-dark-300 text-sm">{option.description}</p>

	{#if option.choices && option.choices.length > 0}
		<div class="mt-2">
			<span class="text-xs text-dark-400 uppercase tracking-wide">Choices:</span>
			<div class="flex flex-wrap gap-1 mt-1">
				{#each option.choices as choice}
					<code class="px-2 py-0.5 bg-dark-card rounded text-xs text-dark-200">{choice.name}</code>
				{/each}
			</div>
		</div>
	{/if}

	{#if option.minValue !== undefined || option.maxValue !== undefined}
		<div class="text-xs text-dark-400">
			{#if option.minValue !== undefined && option.maxValue !== undefined}
				Range: {option.minValue} - {option.maxValue}
			{:else if option.minValue !== undefined}
				Min: {option.minValue}
			{:else if option.maxValue !== undefined}
				Max: {option.maxValue}
			{/if}
		</div>
	{/if}

	{#if option.default !== undefined}
		<div class="text-xs text-dark-400">
			Default: <code class="text-dark-200">{option.default}</code>
		</div>
	{/if}
</div>
