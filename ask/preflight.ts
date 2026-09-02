/**
 * Everything that stands between a question and a run, independent of how
 * the question arrived.
 *
 * The slash command and a message in a thread used to assemble this sequence
 * separately -- the pause switch was duly added to both -- and each still has
 * its own reply mechanics. Now each maps a refusal onto those and nothing
 * else, and the policy has one owner.
 */

import { credentialConfigured, NOT_CONFIGURED } from './askAuth.js';
import { isAskPaused } from './pause.js';
import { decideCaps, loadUsage, type CapDecision } from './caps.js';
import type { AskSession } from './askDb.js';
import { ensureFresh } from '../wpfl/artifactSync.js';

export type Preflight =
  | {
      readonly ok: true;
      /** The thread's session, when it has one. */
      readonly session: AskSession | null;
      /** A member-facing nudge to append to the answer. */
      readonly notice?: string;
    }
  | { readonly ok: false; readonly refusal: string };

/**
 * The reasons a question is refused before anything is looked up. Paused is
 * the incident switch; unconfigured is what the design's §6.4 promised and
 * publish() never showed, while a subprocess spawned to fail burned the
 * member's cap.
 */
export function earlyRefusal(): string | null {
  if (isAskPaused()) return '_/ask is paused by the commish for the moment. Try again later._';
  if (!credentialConfigured()) return `_${NOT_CONFIGURED}_`;
  return null;
}

/**
 * @param loadSession the thread's session, if any. A thunk, so a paused bot
 *   spends no database round trip; otherwise issued alongside the usage
 *   counts, since neither depends on the other.
 */
export async function preflight(
  userId: string,
  loadSession: () => Promise<AskSession | null>
): Promise<Preflight> {
  const early: string | null = earlyRefusal();
  if (early !== null) return { ok: false, refusal: early };

  const [session, usage] = await Promise.all([loadSession(), loadUsage(userId)]);
  const decision: CapDecision = decideCaps(usage, session?.turns ?? 0);
  if (!decision.allowed) return { ok: false, refusal: decision.refusal };

  // Non-fatal: a failed fetch leaves the previous shred in place, and the
  // answer's as-of dates report honestly what it had.
  await ensureFresh();

  return { ok: true, session, notice: decision.notice };
}
