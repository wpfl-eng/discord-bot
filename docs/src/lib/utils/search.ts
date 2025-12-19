import Fuse, { type IFuseOptions } from 'fuse.js';
import type { Command, SearchResult } from '$lib/types/command';

const fuseOptions: IFuseOptions<Command> = {
	keys: [
		{ name: 'name', weight: 0.4 },
		{ name: 'description', weight: 0.3 },
		{ name: 'category', weight: 0.2 },
		{ name: 'options.name', weight: 0.05 },
		{ name: 'options.description', weight: 0.05 }
	],
	threshold: 0.3,
	includeMatches: true,
	includeScore: true,
	minMatchCharLength: 2
};

export function createSearchIndex(commands: Command[]): Fuse<Command> {
	return new Fuse(commands, fuseOptions);
}

export function search(fuse: Fuse<Command>, query: string, limit = 10): SearchResult[] {
	if (!query || query.length < 2) return [];

	const results = fuse.search(query, { limit });

	return results.map((result) => ({
		item: result.item,
		refIndex: result.refIndex,
		score: result.score,
		matches: result.matches?.map((match) => ({
			key: match.key || '',
			value: match.value || '',
			indices: match.indices as Array<[number, number]>
		}))
	}));
}

export function highlightMatch(text: string, indices: Array<[number, number]>): string {
	if (!indices || indices.length === 0) return text;

	let result = '';
	let lastIndex = 0;

	for (const [start, end] of indices) {
		result += text.slice(lastIndex, start);
		result += `<mark class="bg-accent-primary/30 text-accent-primary rounded px-0.5">${text.slice(start, end + 1)}</mark>`;
		lastIndex = end + 1;
	}

	result += text.slice(lastIndex);
	return result;
}
