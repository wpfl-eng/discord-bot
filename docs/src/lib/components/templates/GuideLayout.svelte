<script lang="ts">
	import type { Snippet } from 'svelte';
	import TableOfContents from '$lib/components/organisms/TableOfContents.svelte';

	interface TocItem {
		id: string;
		text: string;
		level: number;
	}

	interface Props {
		title: string;
		description?: string;
		toc?: TocItem[];
		children: Snippet;
	}

	let { title, description, toc = [], children }: Props = $props();
</script>

<div class="flex gap-8">
	<div class="flex-1 min-w-0">
		<div class="max-w-3xl px-4 py-6 sm:py-8 md:px-6 lg:px-8">
			<header class="mb-8 pb-8 border-b border-dark-border">
				<h1 class="text-3xl font-bold text-dark-100">{title}</h1>
				{#if description}
					<p class="mt-3 text-lg text-dark-400">{description}</p>
				{/if}
			</header>
			<article class="prose prose-invert max-w-none">
				{@render children()}
			</article>
		</div>
	</div>
	<TableOfContents items={toc} />
</div>
