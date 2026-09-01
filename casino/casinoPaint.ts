// Casino Board Painting
//
// A live table is one message being edited over and over. Two DIFFERENT mechanisms
// drive those edits and conflating them is a bug:
//
//   1. INTERACTION-DRIVEN. A player clicked. Discord gives three seconds to acknowledge
//      or the click errors in their client, so this can never be debounced. It also
//      costs nothing extra: the board is a single shared message, so one player's
//      update() repaints it for everyone.
//
//   2. TIMER-DRIVEN. A countdown tick, a spin frame, a phase change. Nobody is waiting
//      on a specific acknowledgement, so these coalesce. Without coalescing, a flurry
//      of activity produces an edit per event and walks into the per-channel rate limit.
//
// Painting is best effort throughout. A deleted message, a permissions change or a rate
// limit must never stop a wheel, a shoe or a payout.

import type { Message } from 'discord.js';
import type { MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';
import type { RenderedMessage } from '../interactions/renderedMessage.js';

/**
 * Minimum gap between timer-driven repaints.
 *
 * The board can lag by up to this long, which nobody notices against a 30-second
 * betting window.
 */
export const MIN_PAINT_INTERVAL_MS = 1200;

export interface PainterOptions<S> {
  /** Prefix for log lines, e.g. 'ROULETTE' */
  readonly label: string;
  /** The message this session's board lives on, or null before it is posted */
  getMessage(session: S): Message | null;
  /** Build the current payload for this session */
  build(session: S): RenderedMessage;
  /**
   * Whether this session is still the live one. A queued repaint must not fire against
   * a table that has since closed or been replaced.
   */
  isCurrent(session: S): boolean;
  readonly minIntervalMs?: number;
}

export interface Painter<S> {
  /**
   * Edit the board immediately, bypassing coalescing.
   *
   * For animation frames and phase transitions, which are deliberately spaced and must
   * land in order.
   */
  paintNow(session: S): Promise<void>;
  /** Request a repaint, collapsing rapid requests into one edit. */
  schedulePaint(session: S): void;
  /** Drop any queued repaint. Call when the table closes. */
  cancelPending(): void;
  /** Test seam: forget the last-paint timestamp. */
  reset(): void;
}

/**
 * Build a painter bound to one game's session type.
 */
export function createPainter<S>(options: PainterOptions<S>): Painter<S> {
  const minInterval: number = options.minIntervalMs ?? MIN_PAINT_INTERVAL_MS;

  let lastPaintAt = 0;
  let pending: NodeJS.Timeout | null = null;

  async function paintNow(session: S): Promise<void> {
    const message: Message | null = options.getMessage(session);
    if (!message) return;

    lastPaintAt = Date.now();
    try {
      await message.edit(options.build(session));
    } catch (error: unknown) {
      console.error(`[${options.label}] Failed to paint board:`, error);
    }
  }

  function schedulePaint(session: S): void {
    if (pending) return;

    const elapsed: number = Date.now() - lastPaintAt;
    if (elapsed >= minInterval) {
      void paintNow(session);
      return;
    }

    pending = setTimeout(() => {
      pending = null;
      if (options.isCurrent(session)) void paintNow(session);
    }, minInterval - elapsed);
  }

  function cancelPending(): void {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
  }

  return {
    paintNow,
    schedulePaint,
    cancelPending,
    reset(): void {
      cancelPending();
      lastPaintAt = 0;
    },
  };
}

// ============ INTERACTION-DRIVEN PAINTS ============

type Routable = MessageComponentInteraction | ModalSubmitInteraction;

/**
 * Acknowledge a click by repainting the message it came from.
 *
 * This is the fast path: it both satisfies the three-second acknowledgement deadline
 * and updates the shared board for every viewer in one call.
 *
 * @returns true if the board was repainted through this interaction
 */
export async function paintViaInteraction(
  interaction: Routable,
  payload: RenderedMessage,
  label: string
): Promise<boolean> {
  try {
    if (interaction.isMessageComponent() && !interaction.replied && !interaction.deferred) {
      await interaction.update(payload);
      return true;
    }
  } catch (error: unknown) {
    console.error(`[${label}] Failed to paint via interaction:`, error);
  }
  return false;
}

/**
 * Tell one player something without disturbing the shared board.
 *
 * Used for every "you cannot do that" - a click from someone who is not seated, a bet
 * below the minimum, a wallet that will not cover the stake.
 */
export async function whisper(interaction: Routable, content: string): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch {
    // Interaction expired or was acknowledged elsewhere. Nothing to recover.
  }
}
