<script lang="ts">
	import '../app.css';
	import Header from '$lib/components/organisms/Header.svelte';
	import Sidebar from '$lib/components/organisms/Sidebar.svelte';
	import SearchModal from '$lib/components/organisms/SearchModal.svelte';
	import { allCommands } from '$lib/data/commands';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	let sidebarOpen = $state(false);

	function toggleSidebar(): void {
		sidebarOpen = !sidebarOpen;
	}

	function closeSidebar(): void {
		sidebarOpen = false;
	}
</script>

<svelte:head>
	<title>CommishBot Docs</title>
	<meta name="description" content="Documentation for CommishBot - Discord bot for WPFL fantasy football league" />
</svelte:head>

<div class="min-h-screen bg-dark-bg">
	<Header onMenuClick={toggleSidebar} />

	<div class="flex">
		<Sidebar open={sidebarOpen} onClose={closeSidebar} />

		<main class="flex-1 lg:pl-64">
			{@render children()}
		</main>
	</div>

	<SearchModal commands={allCommands} />
</div>
