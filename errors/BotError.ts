/**
 * Base error class for bot errors with categorization and context
 */

export type ErrorCategory = 'VALIDATION' | 'DATABASE' | 'API' | 'DISCORD' | 'UNKNOWN';

export interface ErrorContext {
  commandName?: string;
  userId?: string;
  guildId?: string;
  step?: string;
}

export class BotError extends Error {
  public readonly timestamp: Date;

  constructor(
    public readonly category: ErrorCategory,
    public readonly userMessage: string,
    public readonly context: ErrorContext = {},
    public readonly originalError?: Error
  ) {
    super(userMessage);
    this.name = 'BotError';
    this.timestamp = new Date();

    // Capture original stack trace
    if (originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }

  toLogObject(): Record<string, unknown> {
    return {
      name: this.name,
      category: this.category,
      message: this.message,
      userMessage: this.userMessage,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      originalError: this.originalError?.message,
    };
  }
}

/**
 * Error for invalid user input or command arguments
 */
export class ValidationError extends BotError {
  constructor(userMessage: string, context?: ErrorContext) {
    super('VALIDATION', userMessage, context);
    this.name = 'ValidationError';
  }
}

/**
 * Error for database operation failures
 */
export class DatabaseError extends BotError {
  constructor(userMessage: string, context?: ErrorContext, originalError?: Error) {
    super('DATABASE', userMessage, context, originalError);
    this.name = 'DatabaseError';
  }
}

/**
 * Error for external API failures (ESPN, Sleeper, WPFL, etc.)
 */
export class APIError extends BotError {
  constructor(userMessage: string, context?: ErrorContext, originalError?: Error) {
    super('API', userMessage, context, originalError);
    this.name = 'APIError';
  }
}

/**
 * Error for Discord API failures
 */
export class DiscordError extends BotError {
  constructor(userMessage: string, context?: ErrorContext, originalError?: Error) {
    super('DISCORD', userMessage, context, originalError);
    this.name = 'DiscordError';
  }
}
