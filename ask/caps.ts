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

export interface CapDecision {
  readonly allowed: boolean;
  /** Member-facing refusal naming the limit that was hit and when it lifts. */
  readonly refusal?: string;
  /** Member-facing nudge to append to an answer that was still given. */
  readonly notice?: string;
}

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

  const asked: number = await countUserQuestionsSince(userId, startOfDay(now));
  if (asked >= ASK.DAILY_QUESTIONS_PER_USER) {
    return {
      allowed: false,
      refusal: `You've asked ${asked} questions today, which is the daily limit of ${ASK.DAILY_QUESTIONS_PER_USER}. It resets at midnight ${zoneLabel(now)}.`,
    };
  }

  const leagueTotal: number = await countAllQuestionsSince(startOfMonth(now));
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
function startOfDay(now: Date): Date {
  return fromZonedTime(`${formatInTimeZone(now, LEAGUE_TZ, 'yyyy-MM-dd')} 00:00:00`, LEAGUE_TZ);
}

/** Midnight in New York on the first of the calendar month containing `now`. */
function startOfMonth(now: Date): Date {
  return fromZonedTime(`${formatInTimeZone(now, LEAGUE_TZ, 'yyyy-MM')}-01 00:00:00`, LEAGUE_TZ);
}

function zoneLabel(now: Date): string {
  return formatInTimeZone(now, LEAGUE_TZ, 'zzz');
}
