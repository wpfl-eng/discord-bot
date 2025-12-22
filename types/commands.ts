import type { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';

/**
 * Interface for Discord slash command modules.
 * All command files must export both `data` and `execute`.
 * Commands with autocomplete options can optionally export `autocomplete`.
 */
export interface CommandModule {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

/**
 * Type guard to validate if an imported module is a valid CommandModule.
 */
export function isValidCommandModule(module: unknown): module is CommandModule {
  return (
    typeof module === 'object' &&
    module !== null &&
    'data' in module &&
    'execute' in module &&
    typeof (module as CommandModule).execute === 'function'
  );
}
