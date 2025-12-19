<script lang="ts">
	import Icon from '$lib/components/atoms/Icon.svelte';
	import SearchInput from '$lib/components/molecules/SearchInput.svelte';
	import { searchOpen } from '$lib/stores/search';

	interface Props {
		onMenuClick?: () => void;
	}

	let { onMenuClick }: Props = $props();

	function handleSearchFocus(): void {
		searchOpen.set(true);
	}
</script>

<header class="sticky top-0 z-40 w-full border-b border-dark-border bg-dark-bg/95 backdrop-blur supports-[backdrop-filter]:bg-dark-bg/80">
	<div class="flex h-14 items-center px-4 gap-4">
		<!-- Mobile menu button -->
		<button
			type="button"
			class="lg:hidden p-3 -ml-3 min-h-[44px] min-w-[44px] text-dark-300 hover:text-dark-100 hover:bg-dark-hover rounded-lg"
			onclick={onMenuClick}
			aria-label="Toggle menu"
		>
			<Icon name="menu" size="md" />
		</button>

		<!-- Logo -->
		<a href="/" class="flex items-center gap-2 font-semibold text-dark-100">
			<span class="text-xl">🏈</span>
			<span class="hidden sm:inline">CommishBot</span>
			<span class="text-dark-400 text-sm font-normal hidden md:inline">Docs</span>
		</a>

		<!-- Search -->
		<div class="flex-1 max-w-[200px] sm:max-w-md ml-auto lg:ml-8">
			<SearchInput placeholder="Search commands..." onfocus={handleSearchFocus} />
		</div>

		<!-- Actions -->
		<div class="flex items-center gap-2">
			<a
				href="https://github.com/aboorde/db-static"
				target="_blank"
				rel="noopener noreferrer"
				class="p-3 min-h-[44px] min-w-[44px] text-dark-300 hover:text-dark-100 hover:bg-dark-hover rounded-lg"
				aria-label="GitHub repository"
			>
				<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
					<path
						fill-rule="evenodd"
						d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
						clip-rule="evenodd"
					/>
				</svg>
			</a>
		</div>
	</div>
</header>
