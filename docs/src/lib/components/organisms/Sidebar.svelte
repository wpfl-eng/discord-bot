<script lang="ts">
	import NavLink from '$lib/components/molecules/NavLink.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';

	interface Props {
		open?: boolean;
		onClose?: () => void;
	}

	let { open = true, onClose }: Props = $props();

	const commandCategories = [
		{ name: 'Fantasy Football', slug: 'fantasy-football', icon: 'football' },
		{ name: 'Draft Analysis', slug: 'draft-analysis', icon: 'chart' },
		{ name: 'Performance', slug: 'performance-analysis', icon: 'trophy' },
		{ name: 'Economy', slug: 'economy', icon: 'coins' },
		{ name: 'Gambling', slug: 'gambling', icon: 'dice' },
		{ name: 'Robbery', slug: 'robbery', icon: 'mask' },
		{ name: 'Shop & Inventory', slug: 'shop-inventory', icon: 'cart' },
		{ name: 'Training', slug: 'training', icon: 'dumbbell' },
		{ name: 'Trivia', slug: 'trivia', icon: 'question' },
		{ name: 'Betting', slug: 'betting', icon: 'ticket' },
		{ name: 'Utility', slug: 'utility', icon: 'wrench' }
	];

	const guides = [
		{ name: 'Economy System', slug: 'economy' },
		{ name: 'Training Ground', slug: 'training' },
		{ name: 'Gambling Strategies', slug: 'gambling' }
	];
</script>

<!-- Mobile overlay -->
{#if open}
	<div
		class="fixed inset-0 z-40 bg-black/50 lg:hidden"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose?.()}
		role="button"
		tabindex="0"
		aria-label="Close sidebar"
	></div>
{/if}

<!-- Sidebar -->
<aside
	class="fixed top-14 left-0 z-40 h-[calc(100vh-3.5rem)] w-[85vw] max-w-64 sm:w-64 bg-dark-sidebar border-r border-dark-border overflow-y-auto transition-transform duration-200 lg:translate-x-0 {open
		? 'translate-x-0'
		: '-translate-x-full'}"
>
	<nav class="p-4 space-y-6">
		<!-- Home -->
		<div>
			<NavLink href="/" icon="home" label="Home" />
		</div>

		<!-- Commands -->
		<div>
			<h3 class="px-3 mb-2 text-xs font-semibold text-dark-400 uppercase tracking-wider">Commands</h3>
			<div class="space-y-1">
				<NavLink href="/commands" icon="book" label="All Commands" />
				{#each commandCategories as category}
					<NavLink href="/commands/{category.slug}" icon={category.icon} label={category.name} />
				{/each}
			</div>
		</div>

		<!-- Guides -->
		<div>
			<h3 class="px-3 mb-2 text-xs font-semibold text-dark-400 uppercase tracking-wider">Guides</h3>
			<div class="space-y-1">
				{#each guides as guide}
					<NavLink href="/guides/{guide.slug}" label={guide.name} />
				{/each}
			</div>
		</div>
	</nav>
</aside>
