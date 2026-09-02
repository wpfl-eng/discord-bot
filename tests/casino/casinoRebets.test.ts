import { describe, test, expect } from '@jest/globals';
import { groupRebets } from '../../casino/casinoRebets.js';

/** A bet carries far more than this; only the three fields grouping reads matter. */
function bet(userId: string, betType: string, amount: number) {
  return { userId, betType, amount };
}

describe('groupRebets', () => {
  test('an empty table produces nothing to repeat', () => {
    expect(groupRebets([]).size).toBe(0);
  });

  test('groups a player’s bets under them', () => {
    const slip = groupRebets([
      bet('u1', 'pass_line', 500),
      bet('u1', 'place_6', 600),
      bet('u2', 'field', 100),
    ]);

    expect(slip.get('u1')).toEqual([
      { betType: 'pass_line', amount: 500 },
      { betType: 'place_6', amount: 600 },
    ]);
    expect(slip.get('u2')).toEqual([{ betType: 'field', amount: 100 }]);
  });

  // The bug this replaced appended to one map for the life of the process, so Rebet
  // grew every round and eventually replayed a session's worth of bets in one click.
  test('is rebuilt each time rather than accumulated', () => {
    const first = groupRebets([bet('u1', 'pass_line', 500)]);
    const second = groupRebets([bet('u1', 'place_6', 600)]);

    expect(first.get('u1')).toHaveLength(1);
    expect(second.get('u1')).toEqual([{ betType: 'place_6', amount: 600 }]);
  });

  test('keeps each player’s slip separate', () => {
    const slip = groupRebets([bet('u1', 'field', 100), bet('u2', 'field', 100)]);

    expect(slip.get('u1')).toEqual([{ betType: 'field', amount: 100 }]);
    expect(slip.get('u2')).toEqual([{ betType: 'field', amount: 100 }]);
  });
});
