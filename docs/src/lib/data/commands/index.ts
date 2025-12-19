import type { Command, CommandCategory } from '$lib/types/command';
import { commandCategorySchema } from '$lib/schemas/command';
import { dev } from '$app/environment';

import fantasyFootball from './fantasy-football.json';
import draftAnalysis from './draft-analysis.json';
import performanceAnalysis from './performance-analysis.json';
import economy from './economy.json';
import gambling from './gambling.json';
import robbery from './robbery.json';
import shopInventory from './shop-inventory.json';
import training from './training.json';
import trivia from './trivia.json';
import betting from './betting.json';
import utility from './utility.json';

// Validate all categories at load time in development
const rawCategories = [
	fantasyFootball,
	draftAnalysis,
	performanceAnalysis,
	economy,
	gambling,
	robbery,
	shopInventory,
	training,
	trivia,
	betting,
	utility
];

function validateCategories(data: unknown[]): CommandCategory[] {
	return data.map((cat, index) => {
		const result = commandCategorySchema.safeParse(cat);
		if (!result.success) {
			const error = `[Commands] Validation failed for category index ${index}:\n${result.error.message}`;
			if (dev) {
				console.error(error);
			}
			throw new Error(error);
		}
		return result.data as CommandCategory;
	});
}

export const categories: CommandCategory[] = validateCategories(rawCategories);

export const allCommands: Command[] = categories.flatMap((cat) => cat.commands);

// Validate relatedCommands references exist
function validateRelatedCommands(): void {
	const commandNames = new Set(allCommands.map((cmd) => cmd.name));
	const errors: string[] = [];

	for (const cmd of allCommands) {
		if (cmd.relatedCommands) {
			for (const related of cmd.relatedCommands) {
				if (!commandNames.has(related)) {
					errors.push(`Command "${cmd.name}" references non-existent relatedCommand "${related}"`);
				}
			}
		}
	}

	if (errors.length > 0) {
		const message = `[Commands] Invalid relatedCommands:\n${errors.join('\n')}`;
		if (dev) {
			console.warn(message);
		}
	}
}

validateRelatedCommands();

export function getCategory(slug: string): CommandCategory | undefined {
	return categories.find((cat) => cat.slug === slug);
}

export function getCommand(categorySlug: string, commandName: string): Command | undefined {
	const category = getCategory(categorySlug);
	return category?.commands.find((cmd) => cmd.name === commandName);
}

export function searchCommands(query: string): Command[] {
	const lowerQuery = query.toLowerCase();
	return allCommands.filter(
		(cmd) =>
			cmd.name.toLowerCase().includes(lowerQuery) ||
			cmd.description.toLowerCase().includes(lowerQuery) ||
			cmd.category.toLowerCase().includes(lowerQuery)
	);
}
