<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { searchOpen, searchQuery } from '$lib/stores/search';
	import { createSearchIndex, search } from '$lib/utils/search';
	import type { Command, SearchResult } from '$lib/types/command';
	import { goto } from '$app/navigation';

	interface Props {
		commands: Command[];
	}

	let { commands }: Props = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement | undefined = $state();

	const fuse = $derived(createSearchIndex(commands));

	$effect(() => {
		if (query) {
			results = search(fuse, query);
			selectedIndex = 0;
		} else {
			results = [];
		}
	});

	$effect(() => {
		if ($searchOpen && inputRef) {
			inputRef.focus();
		}
	});

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (event.key === 'Enter' && results[selectedIndex]) {
			event.preventDefault();
			navigateToResult(results[selectedIndex]);
		} else if (event.key === 'Escape') {
			close();
		}
	}

	function navigateToResult(result: SearchResult): void {
		goto(`/commands/${result.item.categorySlug}/${result.item.name}`);
		close();
	}

	function close(): void {
		searchOpen.set(false);
		query = '';
		results = [];
	}

	onMount(() => {
		function handleGlobalKeydown(event: KeyboardEvent): void {
			if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
				event.preventDefault();
				searchOpen.set(true);
			}
		}

		document.addEventListener('keydown', handleGlobalKeydown);
		return () => document.removeEventListener('keydown', handleGlobalKeydown);
	});
</script>

{#if $searchOpen}
	<div
		class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
		onclick={close}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="button"
		tabindex="0"
		aria-label="Close search"
	>
		<div
			class="fixed inset-x-4 top-4 sm:top-[20%] sm:left-1/2 sm:-translate-x-1/2 sm:inset-x-auto w-auto sm:w-full sm:max-w-xl max-h-[80vh] overflow-hidden"
			onclick={(e) => e.stopPropagation()}
			onkeydown={handleKeydown}
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-label="Search commands"
		>
			<div class="bg-dark-card border border-dark-border rounded-xl shadow-2xl overflow-hidden">
				<!-- Search input -->
				<div class="flex items-center gap-3 p-4 border-b border-dark-border">
					<Icon name="search" size="md" class="text-dark-400" />
					<input
						bind:this={inputRef}
						type="text"
						bind:value={query}
						class="flex-1 bg-transparent border-none outline-none text-dark-100 placeholder-dark-400"
						placeholder="Search commands..."
					/>
					<kbd class="px-2 py-1 rounded text-xs font-mono bg-dark-700 text-dark-400 border border-dark-600">
						ESC
					</kbd>
				</div>

				<!-- Results -->
				{#if results.length > 0}
					<ul class="max-h-[50vh] sm:max-h-80 overflow-y-auto p-2">
						{#each results as result, index}
							<li>
								<button
									type="button"
									class="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors {index === selectedIndex
										? 'bg-accent-primary/10 text-accent-primary'
										: 'text-dark-200 hover:bg-dark-hover'}"
									onclick={() => navigateToResult(result)}
								>
									<code class="font-mono">/{result.item.name}</code>
									<Badge variant="category" text={result.item.category} />
									<span class="text-sm text-dark-400 truncate ml-auto">{result.item.description}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if query.length >= 2}
					<div class="p-8 text-center text-dark-400">
						<Icon name="search" size="xl" class="mx-auto mb-2 opacity-50" />
						<p>No commands found for "{query}"</p>
					</div>
				{:else}
					<div class="p-8 text-center text-dark-400">
						<p>Type at least 2 characters to search</p>
					</div>
				{/if}

				<!-- Footer (hidden on mobile) -->
				<div class="hidden sm:flex items-center gap-4 px-4 py-3 border-t border-dark-border text-xs text-dark-400">
					<span class="flex items-center gap-1">
						<kbd class="px-1.5 py-0.5 rounded bg-dark-700 border border-dark-600">↑↓</kbd>
						Navigate
					</span>
					<span class="flex items-center gap-1">
						<kbd class="px-1.5 py-0.5 rounded bg-dark-700 border border-dark-600">↵</kbd>
						Select
					</span>
					<span class="flex items-center gap-1">
						<kbd class="px-1.5 py-0.5 rounded bg-dark-700 border border-dark-600">esc</kbd>
						Close
					</span>
				</div>
			</div>
		</div>
	</div>
{/if}
