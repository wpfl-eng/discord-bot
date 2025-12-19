<script lang="ts">
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { page } from '$app/stores';

	interface Props {
		href: string;
		icon?: string;
		label: string;
		external?: boolean;
	}

	let { href, icon, label, external = false }: Props = $props();

	let isActive = $derived($page.url.pathname === href || $page.url.pathname.startsWith(href + '/'));
</script>

<a
	{href}
	class="flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors duration-200 min-h-[44px] {isActive
		? 'bg-accent-primary/10 text-accent-primary border-l-2 border-accent-primary -ml-[2px]'
		: 'text-dark-300 hover:text-dark-100 hover:bg-dark-hover'}"
	target={external ? '_blank' : undefined}
	rel={external ? 'noopener noreferrer' : undefined}
>
	{#if icon}
		<Icon name={icon} size="sm" />
	{/if}
	<span>{label}</span>
	{#if external}
		<Icon name="external" size="sm" class="ml-auto opacity-50" />
	{/if}
</a>
