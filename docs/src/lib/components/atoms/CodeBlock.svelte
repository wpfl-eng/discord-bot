<script lang="ts">
	import { onDestroy } from 'svelte';

	interface Props {
		code: string;
		language?: string;
		showCopy?: boolean;
	}

	let { code, language = 'text', showCopy = true }: Props = $props();
	let copied = $state(false);
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	function copyToClipboard(): void {
		navigator.clipboard.writeText(code);
		copied = true;

		// Clear any existing timeout
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			copied = false;
		}, 2000);
	}

	onDestroy(() => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	});
</script>

<div class="relative group">
	<pre class="code-block"><code class="language-{language}">{code}</code></pre>
	{#if showCopy}
		<button
			type="button"
			class="absolute top-2 right-2 p-2 rounded-md bg-dark-hover opacity-0 group-hover:opacity-100 transition-opacity text-dark-300 hover:text-dark-100"
			onclick={copyToClipboard}
			aria-label="Copy code"
		>
			{#if copied}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
			{/if}
		</button>
	{/if}
</div>
