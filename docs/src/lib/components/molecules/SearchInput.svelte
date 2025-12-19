<script lang="ts">
	import Icon from '$lib/components/atoms/Icon.svelte';

	interface Props {
		value?: string;
		placeholder?: string;
		onchange?: (value: string) => void;
		onfocus?: () => void;
	}

	let { value = $bindable(''), placeholder = 'Search...', onchange, onfocus }: Props = $props();

	function handleInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		value = target.value;
		onchange?.(value);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			value = '';
			onchange?.('');
		}
	}
</script>

<div class="relative">
	<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
		<Icon name="search" size="sm" class="text-dark-400" />
	</div>
	<input
		type="text"
		class="input pl-10 pr-12"
		{placeholder}
		{value}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onfocus={onfocus}
	/>
	<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
		<kbd class="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-dark-700 text-dark-400 border border-dark-600">
			<span class="text-xs mr-0.5">&#8984;</span>K
		</kbd>
	</div>
</div>
