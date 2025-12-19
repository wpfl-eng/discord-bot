<script lang="ts">
	interface Props {
		text: string;
		color?: 'blue' | 'green' | 'yellow' | 'red' | 'gray';
		size?: 'sm' | 'md';
	}

	let { text, color = 'blue', size = 'sm' }: Props = $props();

	const colorClasses: Record<string, string> = {
		blue: 'bg-accent-info/10 text-accent-info border-accent-info/20',
		green: 'bg-accent-success/10 text-accent-success border-accent-success/20',
		yellow: 'bg-accent-warning/10 text-accent-warning border-accent-warning/20',
		red: 'bg-accent-danger/10 text-accent-danger border-accent-danger/20',
		gray: 'bg-dark-700 text-dark-300 border-dark-600'
	};

	const sizeClasses: Record<string, string> = {
		sm: 'px-2 py-0.5 text-xs',
		md: 'px-2.5 py-1 text-sm'
	};
</script>

<span class="inline-flex items-center rounded-md border font-medium {colorClasses[color]} {sizeClasses[size]}">
	{text}
</span>
