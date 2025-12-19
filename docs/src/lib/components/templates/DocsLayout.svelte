<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		description?: string;
		children: Snippet;
	}

	let { title, description, children }: Props = $props();
</script>

<div class="flex-1 overflow-auto">
	<div class="max-w-4xl mx-auto px-4 py-6 sm:py-8 md:px-6 lg:px-8">
		{#if title}
			<header class="mb-8">
				<h1 class="text-3xl font-bold text-dark-100">{title}</h1>
				{#if description}
					<p class="mt-2 text-lg text-dark-400">{description}</p>
				{/if}
			</header>
		{/if}
		<div class="prose prose-invert max-w-none">
			{@render children()}
		</div>
	</div>
</div>
