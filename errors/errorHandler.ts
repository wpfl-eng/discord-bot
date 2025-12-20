/**
 * Centralized error handling for Discord commands
 */

import { ChatInputCommandInteraction } from 'discord.js';
import { BotError, ErrorContext } from './BotError.js';

/**
 * Centralized error handler for Discord commands.
 * Logs errors with context and sends user-friendly messages.
 */
export async function handleCommandError(
  error: Error | BotError,
  interaction: ChatInputCommandInteraction,
  context: ErrorContext = {}
): Promise<void> {
  // Build full context
  const fullContext: ErrorContext = {
    commandName: interaction.commandName,
    userId: interaction.user.id,
    guildId: interaction.guildId ?? 'DM',
    ...context,
  };

  // Log error with context
  const logPrefix = `[${fullContext.commandName?.toUpperCase() ?? 'UNKNOWN'}]`;

  if (error instanceof BotError) {
    console.error(logPrefix, error.toLogObject());
  } else {
    console.error(logPrefix, {
      message: error.message,
      stack: error.stack,
      context: fullContext,
    });
  }

  // Determine user-facing message
  const userMessage =
    error instanceof BotError
      ? error.userMessage
      : 'An unexpected error occurred. Please try again.';

  // Send response (handle already replied case)
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: userMessage,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: userMessage,
        ephemeral: true,
      });
    }
  } catch (responseError) {
    console.error(logPrefix, 'Failed to send error response:', responseError);
  }
}

/**
 * Wrapper for safe command execution with automatic error handling.
 * Use this to wrap command execute functions.
 *
 * @example
 * export const execute = withErrorBoundary(async (interaction) => {
 *   // Your command logic here
 * });
 */
export function withErrorBoundary<T extends ChatInputCommandInteraction>(
  handler: (interaction: T) => Promise<void>,
  context?: ErrorContext
): (interaction: T) => Promise<void> {
  return async (interaction: T) => {
    try {
      await handler(interaction);
    } catch (error) {
      await handleCommandError(error as Error, interaction, context);
    }
  };
}

/**
 * Log an error with a command context prefix.
 * Use for non-interaction errors that need logging.
 */
export function logError(
  commandName: string,
  message: string,
  error?: Error | unknown
): void {
  const prefix = `[${commandName.toUpperCase()}]`;
  if (error instanceof Error) {
    console.error(prefix, message, {
      errorMessage: error.message,
      stack: error.stack,
    });
  } else if (error) {
    console.error(prefix, message, error);
  } else {
    console.error(prefix, message);
  }
}
