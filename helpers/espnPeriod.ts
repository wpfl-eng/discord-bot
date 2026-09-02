/**
 * The current NFL week and season, from ESPN where possible.
 *
 * `getCurrentNFLWeek` in ./utils.ts derives the week from Labor Day arithmetic. That has been wrong
 * twice recently -- once for the January rollover, once for the 2026 season boundary -- because the
 * schedule it models is a convention, not a rule: bye structures, international games and the
 * 18-week expansion all move it. ESPN publishes the answer directly as
 * `League#currentScoringPeriodId`, and the fork now exposes it.
 *
 * So this asks ESPN, and falls back to the arithmetic when it cannot: no credentials configured, a
 * network failure, an ESPN outage. A Discord command that reports an approximately-right week is
 * much better than one that fails outright, and every caller here already had a sync default.
 *
 * NOTE: `seasonId` still comes from the calendar. ESPN cannot tell you which season it is without
 * being asked about one, so that call has to be made before the request. The season rule --
 * January and February belong to the previous season -- is a fixed NFL league-year fact rather than
 * a schedule convention, which is why it is the half that has not gone wrong.
 */

import { Client } from '../espnClient.cjs';
import type { Client as EspnClient, League } from 'espn-fantasy-football-api/node.js';
import { logError } from '../errors/index.js';
import { getCurrentNFLSeason, getCurrentNFLWeek } from './utils.js';

/**
 * The league client, configured from LEAGUE_ID, ESPN_S2 and SWID, or null when
 * any of the three is unset. The one place the fork is constructed for the
 * /ask tools, the fixtures script and the week lookup below.
 */
export function espnClientFromEnv(): EspnClient | null {
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (LEAGUE_ID === undefined || ESPN_S2 === undefined || SWID === undefined) return null;

  const client = new Client({ leagueId: Number.parseInt(LEAGUE_ID, 10) });
  client.setCookies({ espnS2: ESPN_S2, SWID });
  return client;
}

export interface NFLPeriod {
  readonly seasonId: number;
  /** ESPN's scoring period: the NFL week. */
  readonly scoringPeriodId: number;
  /** ESPN's matchup period. Equal to the scoring period in a league with one-week matchups. */
  readonly matchupPeriodId: number;
  /** Where the week came from, so a caller can tell an authoritative answer from a guess. */
  readonly source: 'espn' | 'calendar';
}

/** Long enough that commands share one lookup, short enough to pick up a Tuesday rollover. */
const TTL_MS = 15 * 60 * 1000;

let cached: { readonly at: number; readonly period: NFLPeriod } | null = null;
let inFlight: Promise<NFLPeriod> | null = null;

function fromCalendar(): NFLPeriod {
  const week: number = getCurrentNFLWeek();
  return {
    seasonId: getCurrentNFLSeason(),
    scoringPeriodId: week,
    matchupPeriodId: week,
    source: 'calendar',
  };
}

async function lookUpPeriod(): Promise<NFLPeriod> {
  const client: EspnClient | null = espnClientFromEnv();
  if (client === null) return fromCalendar();

  const seasonId: number = getCurrentNFLSeason();

  try {
    const league: League = await client.getLeagueInfo({ seasonId });

    // A league mid-creation, or a season ESPN has not opened yet, reports no current period. That
    // is not an error, but it is not an answer either. Only the scoring period gates this: it is
    // the field every caller reads, and letting the matchup period veto it would put commands on
    // the calendar guess over a value none of them asked for.
    if (typeof league.currentScoringPeriodId !== 'number') {
      return fromCalendar();
    }

    const period: NFLPeriod = {
      seasonId,
      scoringPeriodId: league.currentScoringPeriodId,
      matchupPeriodId: league.currentMatchupPeriodId ?? league.currentScoringPeriodId,
      source: 'espn',
    };
    // Only a real answer is cached. A fallback is not, so the next call retries ESPN.
    cached = { at: Date.now(), period };
    return period;
  } catch (error: unknown) {
    logError('espnPeriod', 'Falling back to calendar arithmetic for the current NFL week', error);
    return fromCalendar();
  }
}

/**
 * Clears the cached period. Exported for tests; nothing in the bot should need it.
 */
export function resetPeriodCache(): void {
  cached = null;
  inFlight = null;
}

/**
 * The current period, from ESPN when it can be reached and from the calendar otherwise.
 */
export async function getCurrentPeriod(): Promise<NFLPeriod> {
  if (cached !== null && Date.now() - cached.at < TTL_MS) {
    return cached.period;
  }

  // Share the in-flight request. The TTL only dedupes once a lookup has resolved, so several
  // commands invoked in the same second on a cold cache would each issue their own.
  inFlight ??= lookUpPeriod().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Fills in whichever of week and season the user did not supply.
 *
 * Skips the ESPN lookup entirely when both were given, which is the common case for a command like
 * `/median week:5 year:2024` -- on a cold cache that lookup is a round trip at the head of the
 * command, blocking the reply, for a value that is then discarded.
 *
 * @param week - The week the user asked for, or null.
 * @param season - The season the user asked for, or null.
 */
export async function resolvePeriod(
  week: number | null,
  season: number | null
): Promise<{ week: number; season: number }> {
  if (week !== null && season !== null) {
    return { week, season };
  }

  const period: NFLPeriod = await getCurrentPeriod();
  return {
    week: week ?? period.scoringPeriodId,
    season: season ?? period.seasonId,
  };
}
