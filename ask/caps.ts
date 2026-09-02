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

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { ASK } from './askConfig.js';
import { countUserQuestionsSince, countAllQuestionsSince } from './askDb.js';

/** The league's timezone. One definition, in the config file. */
const LEAGUE_TZ: string = ASK.LEAGUE_TZ;

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
 * @param threadTurns turns already taken in this thread; 0 for a new one.
 */
export async function checkCaps(
  userId: string,
  threadTurns: number = 0,
  now: Date = new Date()
): Promise<CapDecision> {
  // Checked first, and without a database round trip: a finished thread is
  // finished regardless of anyone's quota, and saying so costs nothing.
  if (threadTurns >= ASK.HARD_TURN_CAP) {
    return {
      allowed: false,
      refusal: `This thread has run ${threadTurns} turns and I'm going to stop here — the context is long enough that I'd start losing the thread of it. Run \`/ask\` again for a fresh one.`,
    };
  }

  // Issued together, not one after the other. Both are separate network round
  // trips against a serverless Postgres, and they sit in front of deferReply(),
  // which Discord will not wait more than three seconds for. The daily limit is
  // still evaluated first, so the refusal a member reads is unchanged; the only
  // difference is that the league-wide count is also asked for on the rare day
  // someone is already capped.
  const [asked, leagueTotal]: [number, number] = await Promise.all([
    countUserQuestionsSince(userId, startOfDay(now)),
    countAllQuestionsSince(startOfMonth(now)),
  ]);

  if (asked >= ASK.DAILY_QUESTIONS_PER_USER) {
    return {
      allowed: false,
      refusal: `You've asked ${asked} questions today, which is the daily limit of ${ASK.DAILY_QUESTIONS_PER_USER}. It resets at midnight ${zoneLabel(now)}.`,
    };
  }

  if (leagueTotal >= ASK.MONTHLY_QUERIES_TOTAL) {
    return {
      allowed: false,
      refusal: `The league has used all ${ASK.MONTHLY_QUERIES_TOTAL} questions for ${formatInTimeZone(now, LEAGUE_TZ, 'MMMM')}. I'm paused until the first.`,
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

/** Midnight in New York on the calendar day containing `now`. */
export function startOfDay(now: Date): Date {
  return fromZonedTime(`${formatInTimeZone(now, LEAGUE_TZ, 'yyyy-MM-dd')} 00:00:00`, LEAGUE_TZ);
}

/** Midnight in New York on the first of the calendar month containing `now`. */
export function startOfMonth(now: Date): Date {
  return fromZonedTime(`${formatInTimeZone(now, LEAGUE_TZ, 'yyyy-MM')}-01 00:00:00`, LEAGUE_TZ);
}

function zoneLabel(now: Date): string {
  return formatInTimeZone(now, LEAGUE_TZ, 'zzz');
}
