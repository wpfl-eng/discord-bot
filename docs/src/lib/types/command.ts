export interface CommandOption {
	name: string;
	description: string;
	type: 'string' | 'integer' | 'number' | 'boolean' | 'user';
	required: boolean;
	choices?: Array<{ name: string; value: string }>;
	minValue?: number;
	maxValue?: number;
	autocomplete?: boolean;
	default?: string | number | boolean;
}

export interface CommandSubcommand {
	name: string;
	description: string;
	options?: CommandOption[];
}

export interface CommandExample {
	input: string;
	output: string;
	note?: string;
}

export interface CommandCooldown {
	duration: number;
	unit: 'seconds' | 'minutes' | 'hours';
}

export interface Command {
	name: string;
	description: string;
	longDescription?: string;
	category: string;
	categorySlug: string;
	usage: string[];
	options?: CommandOption[];
	subcommands?: CommandSubcommand[];
	examples?: CommandExample[];
	relatedCommands?: string[];
	tips?: string[];
	ephemeral?: boolean;
	cooldown?: CommandCooldown;
	gameConfig?: Record<string, unknown>;
}

export interface CommandCategory {
	name: string;
	slug: string;
	description: string;
	icon: string;
	commands: Command[];
}

export interface NavigationItem {
	name: string;
	slug: string;
	icon?: string;
	href?: string;
}

export interface NavigationSection {
	name: string;
	items: NavigationItem[];
}

export interface SearchResult {
	item: Command;
	refIndex: number;
	score?: number;
	matches?: Array<{
		key: string;
		value: string;
		indices: Array<[number, number]>;
	}>;
}
