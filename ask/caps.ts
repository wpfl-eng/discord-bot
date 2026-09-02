/**
 * The limits on /ask: a daily per-user question count, a monthly league-wide
 * query count, and per-thread turn caps.
 *
 * These count rows and never sum dollars. `total_cost_usd` is a client-side
 * estimate the SDK computes from a bundled price table; on subscription auth it
 * approximates no bill at all, and an `error_during_execution` after a crash can
 * arrive with every cost field zeroed -- which would systematically under-count
 * exactly the runs that ran longest before dying (design §9).
 */

import { ASK } from './askConfig.js';
import { questionCounts, type QuestionCounts } from './askDb.js';
import { leagueMonth, startOfDay, startOfMonth, zoneLabel } from './leagueTime.js';

/**
 * A refusal always carries its reason, which is why this is a union rather than
 * one shape with two optional fields. As a single interface, `refusal` was
 * optional even when `allowed` was false, so both call sites needed a
 * `?? 'Not right now.'` fallback -- member-facing text that could never be
 * reached, and that the next gate added here would have copied.
 */
export type CapDecision =
  /** `notice` is a member-facing nudge appended to an answer that was still given. */
  | { readonly allowed: true; readonly notice?: string }
  /** `refusal` names the limit that was hit and when it lifts. */
  | { readonly allowed: false; readonly refusal: string };

const ALLOWED: CapDecision = { allowed: true };

/**
 * Both counts the caps compare against, in one round trip against a serverless
 * Postgres. Separate from the decision so the preflight can issue it alongside
 * the session lookup rather than after it.
 */
export function loadUsage(userId: string, now: Date = new Date()): Promise<QuestionCounts> {
  return questionCounts(userId, startOfDay(now), startOfMonth(now));
}

/**
 * The decision for these counts and this thread. Pure: nothing here reaches
 * the database, which is what lets the two entry points share it.
 *
 * @param threadTurns turns already taken in this thread; 0 for a new one.
 */
export function decideCaps(
  usage: QuestionCounts,
  threadTurns: number = 0,
  now: Date = new Date()
): CapDecision {
  // A finished thread is finished regardless of anyone's quota.
  if (threadTurns >= ASK.HARD_TURN_CAP) {
    return {
      allowed: false,
      refusal: `This thread has run ${threadTurns} turns and I'm going to stop here — the context is long enough that I'd start losing the thread of it. Run \`/ask\` again for a fresh one.`,
    };
  }

  if (usage.asked >= ASK.DAILY_QUESTIONS_PER_USER) {
    return {
      allowed: false,
      refusal: `You've asked ${usage.asked} questions today, which is the daily limit of ${ASK.DAILY_QUESTIONS_PER_USER}. It resets at midnight ${zoneLabel(now)}.`,
    };
  }

  if (usage.leagueTotal >= ASK.MONTHLY_QUERIES_TOTAL) {
    return {
      allowed: false,
      refusal: `The league has used all ${ASK.MONTHLY_QUERIES_TOTAL} questions for ${leagueMonth(now)}. I'm paused until the first.`,
    };
  }

  if (threadTurns >= ASK.SOFT_TURN_CAP) {
    return {
      allowed: true,
      notice: `_This thread is ${threadTurns} turns deep. A fresh \`/ask\` will get you a sharper answer than another follow-up here._`,
    };
  }

  return ALLOWED;
}
