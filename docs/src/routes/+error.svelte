<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/components/atoms/Button.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
</script>

<svelte:head>
	<title>Error {page.status} - CommishBot Docs</title>
</svelte:head>

<div class="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4">
	<div class="text-center max-w-md">
		<div class="text-6xl sm:text-8xl mb-6">
			{#if page.status === 404}
				🏈
			{:else}
				⚠️
			{/if}
		</div>

		<h1 class="text-4xl sm:text-5xl font-bold text-dark-100 mb-4">
			{page.status}
		</h1>

		<p class="text-xl text-dark-300 mb-8">
			{#if page.status === 404}
				Looks like this play was called dead. The page you're looking for doesn't exist.
			{:else}
				Something went wrong on our end. We're reviewing the tape.
			{/if}
		</p>

		{#if page.error?.message}
			<div class="mb-8 p-4 bg-dark-card rounded-lg border border-dark-border">
				<code class="text-sm text-dark-400">{page.error.message}</code>
			</div>
		{/if}

		<div class="flex flex-col sm:flex-row items-center justify-center gap-4">
			<Button href="/" variant="primary" size="lg">
				<Icon name="home" size="sm" class="mr-2" />
				Back to Home
			</Button>
			<Button href="/commands" variant="secondary" size="lg">
				<Icon name="book" size="sm" class="mr-2" />
				Browse Commands
			</Button>
		</div>
	</div>
</div>
