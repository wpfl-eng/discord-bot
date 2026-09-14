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

/** `2026-09-02 14:05 EDT`: a full instant, for a date the agent relays. */
export function leagueInstant(date: Date): string {
  return formatInTimeZone(date, ASK.LEAGUE_TZ, 'yyyy-MM-dd HH:mm zzz');
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

/** A date range in the `YYYYMMDD` form the ESPN fork's schedule lookup takes. */
export interface DateWindow {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * The NFL week containing `now`: the Tuesday-to-Tuesday block, by league
 * date, that ESPN's schedule lookup is asked for.
 *
 * ESPN rolls its scoring period overnight into Tuesday, and no NFL week plays
 * a Tuesday game, so a Tuesday boundary keeps this and ESPN's week together
 * on both sides of the roll: before it, the finished week's games fall
 * outside the window and read as byes, which counts nobody as still to play
 * -- right, since every game is over; after it, the window is the new week's.
 * The one exposure is a Monday game still running past midnight Eastern.
 * Anchored on the weekday rather than on the calendar arithmetic in
 * helpers/utils.ts, which derives Thursday from Labor Day and cannot see a
 * Wednesday opener. Dates are moved at UTC noon so a step across a DST change
 * cannot land on the wrong calendar day.
 */
export function nflWeekWindow(now: Date): DateWindow {
  // ISO weekday in the league timezone, 1 Monday to 7 Sunday; back to Tuesday.
  const back: number = (Number(formatInTimeZone(now, ASK.LEAGUE_TZ, 'i')) - 2 + 7) % 7;
  const [year, month, day] = leagueDate(now).split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - back, 12));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const stamp = (date: Date): string => formatInTimeZone(date, 'UTC', 'yyyyMMdd');
  return { startDate: stamp(start), endDate: stamp(end) };
}
