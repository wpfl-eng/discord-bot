// Central Component Interaction Router
//
// Discord message-component interactions (buttons, select menus) were previously
// handled with per-message collectors. Collectors die when the process restarts and,
// worse, they encourage handlers to keep editing through the *original* interaction
// token - which Discord invalidates after 15 minutes.
//
// Routing instead means every click arrives as its own interaction carrying its own
// fresh token, so an update() driven from here never expires no matter how long a
// player keeps clicking.

import type { MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';

// ============ TYPES ============

/**
 * Modal submits are routed alongside buttons and selects. They are not message
 * components, but a modal opened from a button naturally shares that feature's
 * customId prefix, so one registration should cover both.
 */
export type RoutableInteraction = MessageComponentInteraction | ModalSubmitInteraction;

export type ComponentHandler = (interaction: RoutableInteraction) => Promise<void>;

interface Registration {
  readonly prefix: string;
  readonly handler: ComponentHandler;
}

// ============ STATE ============

// Kept sorted by descending prefix length so the most specific prefix wins.
const registrations: Registration[] = [];

// ============ REGISTRATION ============

/**
 * Register a handler for every customId beginning with `prefix`.
 * Call at module import time; the command loader runs before any interaction arrives.
 *
 * @param prefix - customId prefix to claim (e.g. 'roulette:')
 * @param handler - invoked with the raw component interaction
 * @throws if the prefix is already claimed, which is almost always a copy-paste bug
 */
export function registerComponentHandler(prefix: string, handler: ComponentHandler): void {
  if (prefix.length === 0) {
    throw new Error('[ROUTER] Refusing to register an empty component prefix');
  }

  const existing: Registration | undefined = registrations.find((r) => r.prefix === prefix);
  if (existing) {
    throw new Error(`[ROUTER] Component prefix "${prefix}" is already registered`);
  }

  registrations.push({ prefix, handler });
  registrations.sort((a, b) => b.prefix.length - a.prefix.length);
}

/**
 * Look up the handler that claims this customId, if any.
 */
export function findComponentHandler(customId: string): ComponentHandler | null {
  const match: Registration | undefined = registrations.find((r) => customId.startsWith(r.prefix));
  return match?.handler ?? null;
}

/**
 * Number of registered prefixes. Used for boot logging and by tests.
 */
export function getRegisteredPrefixes(): readonly string[] {
  return registrations.map((r) => r.prefix);
}

// ============ DISPATCH ============

/**
 * Route a component interaction to its handler.
 *
 * @returns true if a handler claimed the interaction (whether or not it threw),
 *          false if no prefix matched and the caller should keep looking.
 */
export async function dispatchComponent(interaction: RoutableInteraction): Promise<boolean> {
  const handler: ComponentHandler | null = findComponentHandler(interaction.customId);
  if (!handler) return false;

  try {
    await handler(interaction);
  } catch (error: unknown) {
    console.error(`[ROUTER] Handler for "${interaction.customId}" threw:`, error);
    await replyWithError(interaction);
  }

  return true;
}

/**
 * Best-effort error notice. A handler may have already replied, deferred, or the
 * interaction may have expired outright - none of those should escalate.
 */
async function replyWithError(interaction: RoutableInteraction): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'Something went wrong handling that. Please try again.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'Something went wrong handling that. Please try again.',
        ephemeral: true,
      });
    }
  } catch {
    // Interaction expired or was already acknowledged elsewhere - nothing to do.
  }
}
