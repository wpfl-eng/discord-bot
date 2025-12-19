<script lang="ts">
	interface Props {
		variant?: 'category' | 'required' | 'optional' | 'type' | 'cooldown';
		text: string;
	}

	let { variant = 'category', text }: Props = $props();

	const variantClasses: Record<string, string> = {
		category: 'bg-accent-primary/20 text-accent-primary',
		required: 'bg-accent-danger/20 text-accent-danger',
		optional: 'bg-dark-600 text-dark-300',
		type: 'bg-accent-info/20 text-accent-info',
		cooldown: 'bg-accent-warning/20 text-accent-warning'
	};
</script>

<span class="badge {variantClasses[variant]}">
	{text}
</span>
