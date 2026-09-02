/**
 * The league's calendar, in one place.
 *
 * Every date a member reads -- the cap-reset line, the "Today is" the agent is
 * told, the as-of dates in INDEX.md and the timestamps in /ask-admin -- is in
 * ASK.LEAGUE_TZ. Half of these used toISOString(), which is UTC, so from 8pm
 * ET onwards they named tomorrow.
 */

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { ASK } from './askConfig.js';

/** Midnight in the league timezone on the calendar day containing `now`. */
export function startOfDay(now: Date): Date {
  return fromZonedTime(`${leagueDate(now)} 00:00:00`, ASK.LEAGUE_TZ);
}

/** Midnight in the league timezone on the first of the month containing `now`. */
export function startOfMonth(now: Date): Date {
  return fromZonedTime(
    `${formatInTimeZone(now, ASK.LEAGUE_TZ, 'yyyy-MM')}-01 00:00:00`,
    ASK.LEAGUE_TZ
  );
}

/** `2026-09-02`, in the league timezone. */
export function leagueDate(date: Date): string {
  return formatInTimeZone(date, ASK.LEAGUE_TZ, 'yyyy-MM-dd');
}

/** `09-02 14:05`, in the league timezone. For listings where the year is obvious. */
export function leagueDateTime(date: Date): string {
  return formatInTimeZone(date, ASK.LEAGUE_TZ, 'MM-dd HH:mm');
}

/** `September`: the month containing `now`, in the league timezone. */
export function leagueMonth(now: Date): string {
  return formatInTimeZone(now, ASK.LEAGUE_TZ, 'MMMM');
}

/** The zone's abbreviation at `now`, e.g. `EDT`. */
export function zoneLabel(now: Date): string {
  return formatInTimeZone(now, ASK.LEAGUE_TZ, 'zzz');
}
