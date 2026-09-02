/**
 * Two buttons under every answer, with counts that update in place (design
 * §6.3; log Stage 14, decision 16).
 *
 * Triage, not learning. The ledger says what a run cost and how long it took
 * and nothing about whether the answer was any good; at the cap's ceiling of
 * fifteen hundred questions a month nobody reads the threads to find out. A
 * thumbs-down says which thread to open.
 *
 * Buttons rather than reactions: the click carries who pressed it and on which
 * message, the router already handles components, and it works on messages
 * the cache has forgotten after a restart. Reactions would need a new intent,
 * two partials, a fetch per uncached message and a filter for the bot's own.
 *
 * Keyed by the Discord message rather than the ledger row, so a vote survives
 * a ledger write that failed; the join to ask_usage.message_id is optional.
 */

import type { ActionRowBuilder, MessageActionRowComponentBuilder } from 'discord.js';
import { button, row } from '../casino/casinoRender.js';
import { recordFeedback, feedbackCounts, type FeedbackCounts } from './askDb.js';
import {
  registerComponentHandler,
  type RoutableInteraction,
} from '../interactions/componentRouter.js';
import { logError } from '../errors/errorHandler.js';

export const FEEDBACK_PREFIX = 'ask:feedback:';

export function feedbackRow(
  counts: FeedbackCounts
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return row([
    button({ id: `${FEEDBACK_PREFIX}up`, label: `👍 ${counts.up}` }),
    button({ id: `${FEEDBACK_PREFIX}down`, label: `👎 ${counts.down}` }),
  ]);
}

export async function handleFeedback(interaction: RoutableInteraction): Promise<void> {
  if (!interaction.isButton()) return;
  const rating: 1 | -1 | null =
    interaction.customId === `${FEEDBACK_PREFIX}up`
      ? 1
      : interaction.customId === `${FEEDBACK_PREFIX}down`
        ? -1
        : null;
  if (rating === null) return;

  const messageId: string = interaction.message.id;
  const threadId: string | null = interaction.channelId ?? null;

  try {
    await recordFeedback(messageId, threadId, interaction.user.id, rating);
    if (rating === -1) {
      // A log line, not a DM: the bot never speaks unprompted. Enough to open
      // the thread before the admin query is ever run.
      console.log(
        `[ASK] 👎 on ${messageId} in thread ${threadId ?? 'unknown'} from ${interaction.user.id}`
      );
    }
    const counts: FeedbackCounts = await feedbackCounts(messageId);
    // Edits only the components of the message the button sits on: the
    // confirmation is the count changing under the member's finger.
    await interaction.update({ components: [feedbackRow(counts)] });
  } catch (error: unknown) {
    logError('ask', 'Could not record feedback', error);
    // The click still has to be answered or Discord shows it as failed.
    try {
      await interaction.deferUpdate();
    } catch {
      // Already acknowledged, or the message is gone. Nothing left to do.
    }
  }
}

registerComponentHandler(FEEDBACK_PREFIX, handleFeedback);
