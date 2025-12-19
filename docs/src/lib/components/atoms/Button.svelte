<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'primary' | 'secondary' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		href?: string;
		disabled?: boolean;
		onclick?: () => void;
		children: Snippet;
	}

	let { variant = 'primary', size = 'md', href, disabled = false, onclick, children }: Props = $props();

	const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-dark-bg disabled:opacity-50 disabled:cursor-not-allowed';

	const variantClasses: Record<string, string> = {
		primary: 'bg-accent-primary text-white hover:bg-accent-primary-hover',
		secondary: 'bg-dark-card text-dark-100 hover:bg-dark-hover border border-dark-border',
		ghost: 'text-dark-200 hover:text-dark-100 hover:bg-dark-hover'
	};

	const sizeClasses: Record<string, string> = {
		sm: 'px-3 py-2 text-sm min-h-[44px]',
		md: 'px-4 py-2.5 text-sm min-h-[44px]',
		lg: 'px-6 py-3 text-base min-h-[44px]'
	};

	const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]}`;
</script>

{#if href}
	<a {href} class={classes}>
		{@render children()}
	</a>
{:else}
	<button type="button" class={classes} {disabled} {onclick}>
		{@render children()}
	</button>
{/if}
