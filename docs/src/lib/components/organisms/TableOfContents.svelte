<script lang="ts">
	interface TocItem {
		id: string;
		text: string;
		level: number;
	}

	interface Props {
		items?: TocItem[];
	}

	let { items = [] }: Props = $props();
</script>

{#if items.length > 0}
	<nav class="hidden xl:block w-56 shrink-0">
		<div class="sticky top-20 pl-4 border-l border-dark-border">
			<h4 class="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">On this page</h4>
			<ul class="space-y-2">
				{#each items as item}
					<li style="padding-left: {(item.level - 2) * 0.75}rem">
						<a
							href="#{item.id}"
							class="text-sm text-dark-400 hover:text-dark-100 transition-colors block py-0.5"
						>
							{item.text}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</nav>
{/if}
