/**
 * Error handling module exports
 */

export {
  BotError,
  ValidationError,
  DatabaseError,
  APIError,
  DiscordError,
} from './BotError.js';

export type { ErrorCategory, ErrorContext } from './BotError.js';

export { handleCommandError, withErrorBoundary, logError } from './errorHandler.js';
