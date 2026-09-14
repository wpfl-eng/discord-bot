import { describe, test, expect } from '@jest/globals';
import { fromZonedTime } from 'date-fns-tz';
import { ASK } from '../../ask/askConfig.js';
import { nflWeekWindow } from '../../ask/leagueTime.js';

/** An instant from a wall-clock time in the league timezone. */
const et = (wallClock: string): Date => fromZonedTime(wallClock, ASK.LEAGUE_TZ);

/**
 * The NFL week as a schedule window: the Tuesday-to-Tuesday block containing
 * `now`, by league date. ESPN rolls its scoring period overnight into Tuesday
 * and no week plays a Tuesday game, so the boundary keeps this and ESPN's
 * week together on both sides of the roll. Labor Day arithmetic is not used:
 * this season opened on a Wednesday.
 */
describe('nflWeekWindow', () => {
  test('a Monday morning is the week that began the Tuesday before, Wednesday opener and Monday night included', () => {
    expect(nflWeekWindow(et('2026-09-14 09:00:00'))).toEqual({
      startDate: '20260908',
      endDate: '20260915',
    });
  });

  test('a Monday night still belongs to the week being played, read in the league timezone', () => {
    // 23:30 Monday in New York is 03:30 Tuesday in UTC.
    expect(nflWeekWindow(et('2026-09-14 23:30:00')).startDate).toBe('20260908');
  });

  test('Tuesday starts the next week from midnight, whether or not ESPN has rolled yet', () => {
    // Before ESPN rolls, the finished week's games fall outside the window and
    // read as byes: nobody left to play, which is right once every game is over.
    expect(nflWeekWindow(et('2026-09-15 00:30:00'))).toEqual({
      startDate: '20260915',
      endDate: '20260922',
    });
  });

  test('a Thursday and the Sunday night after it are one week', () => {
    expect(nflWeekWindow(et('2026-09-17 20:00:00'))).toEqual(
      nflWeekWindow(et('2026-09-20 23:30:00'))
    );
  });

  test('steps across a month boundary on the calendar, not the clock', () => {
    expect(nflWeekWindow(et('2026-10-01 10:00:00'))).toEqual({
      startDate: '20260929',
      endDate: '20261006',
    });
  });

  test('a step across the DST change lands on the right calendar day', () => {
    // Sunday 2026-11-01 is the change; the Tuesday before is 2026-10-27.
    expect(nflWeekWindow(et('2026-11-02 00:30:00'))).toEqual({
      startDate: '20261027',
      endDate: '20261103',
    });
  });
});
