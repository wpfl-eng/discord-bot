import { describe, test, expect } from '@jest/globals';
import {
  BET_TYPES,
  endsSession,
  maxOdds,
  oddsPayout,
  calculateFieldPayout,
  calculatePlacePayout,
  isHardWay,
  type BetType,
  type Roll,
} from '../../discordCommands/craps/crapsConfig.js';
import { canTakeDown, resolveBet, type CrapsBet } from '../../discordCommands/craps/crapsEngine.js';

// ============ FIXTURES ============

/**
 * A roll with an explicit dice pair, because hardways and the come-out both care about
 * HOW a total was made, not just what it was.
 */
function roll(die1: number, die2: number): Roll {
  return { die1, die2, total: die1 + die2, timestamp: new Date() };
}

/** The cheapest way to make a given total the easy way, for tests that only need a total. */
function total(n: number): Roll {
  for (let d1 = 1; d1 <= 6; d1++) {
    const d2 = n - d1;
    if (d2 >= 1 && d2 <= 6 && d1 !== d2) return roll(d1, d2);
  }
  // 2 and 12 can only be made as a pair
  return roll(n / 2, n / 2);
}

function bet(betType: BetType, amount: number, extra: Partial<CrapsBet> = {}): CrapsBet {
  return {
    id: 'b1',
    userId: 'u1',
    username: 'tester',
    betType,
    amount,
    placedAt: new Date(),
    status: 'active',
    escrowIds: [1],
    ...extra,
  };
}

// ============ PASS LINE ============

describe('pass line', () => {
  test.each([7, 11])('come-out %i wins even money', (n: number) => {
    const result = resolveBet(bet('pass_line', 1000), total(n), null);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(2000);
  });

  test.each([2, 3, 12])('come-out %i loses', (n: number) => {
    expect(resolveBet(bet('pass_line', 1000), total(n), null).outcome).toBe('lose');
  });

  test.each([4, 5, 6, 8, 9, 10])('come-out %i establishes a point and rides', (n: number) => {
    expect(resolveBet(bet('pass_line', 1000), total(n), null).outcome).toBe('pending');
  });

  test('point hit wins even money', () => {
    const result = resolveBet(bet('pass_line', 1000), total(6), 6);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(2000);
  });

  test('seven out loses', () => {
    expect(resolveBet(bet('pass_line', 1000), total(7), 6).outcome).toBe('lose');
  });

  test('any other number rides', () => {
    expect(resolveBet(bet('pass_line', 1000), total(9), 6).outcome).toBe('pending');
  });
});

// ============ DON'T PASS ============

describe("don't pass", () => {
  test.each([2, 3])('come-out %i wins even money', (n: number) => {
    const result = resolveBet(bet('dont_pass', 1000), total(n), null);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(2000);
  });

  // Bar the 12 is the entire house edge on this bet. Without it the don't side would be
  // a positive-expectation wager.
  test('come-out 12 pushes, not wins', () => {
    const result = resolveBet(bet('dont_pass', 1000), total(12), null);
    expect(result.outcome).toBe('push');
    expect(result.payout).toBe(1000);
  });

  test.each([7, 11])('come-out %i loses', (n: number) => {
    expect(resolveBet(bet('dont_pass', 1000), total(n), null).outcome).toBe('lose');
  });

  test('seven out wins even money', () => {
    const result = resolveBet(bet('dont_pass', 1000), total(7), 6);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(2000);
  });

  test('point hit loses', () => {
    expect(resolveBet(bet('dont_pass', 1000), total(6), 6).outcome).toBe('lose');
  });
});

// ============ FREE ODDS ============

describe('pass odds', () => {
  // The only bet in the building with no house edge: it pays exactly true odds.
  test.each([
    [4, 500, 1500],
    [10, 500, 1500],
    [5, 500, 1250],
    [9, 500, 1250],
    [6, 500, 1100],
    [8, 500, 1100],
  ])('point %i pays true odds on %i returning %i', (point, amount, expected) => {
    const result = resolveBet(
      bet('pass_odds', amount, { oddsPoint: point, parentBetId: 'line1' }),
      total(point),
      point
    );
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(expected);
  });

  test('seven out loses the odds with the line', () => {
    const result = resolveBet(
      bet('pass_odds', 500, { oddsPoint: 6, parentBetId: 'line1' }),
      total(7),
      6
    );
    expect(result.outcome).toBe('lose');
    expect(result.payout).toBe(0);
  });

  test('pays by the point it was placed on, not the current point', () => {
    // A player backs the 6, the shooter hits it, a new point of 4 is established, and
    // the odds bet must already have been settled against the 6 it was placed behind.
    const result = resolveBet(
      bet('pass_odds', 600, { oddsPoint: 6, parentBetId: 'line1' }),
      total(6),
      6
    );
    expect(result.payout).toBe(600 + 720);
  });
});

describe("don't pass odds", () => {
  // Laying odds inverts the ratio: the don't bettor is now the favourite, so they risk
  // more to win less.
  test.each([
    [4, 1000, 1500],
    [10, 1000, 1500],
    [5, 900, 1500],
    [9, 900, 1500],
    [6, 1200, 2200],
    [8, 1200, 2200],
  ])('point %i lays true odds on %i returning %i', (point, amount, expected) => {
    const result = resolveBet(
      bet('dont_pass_odds', amount, { oddsPoint: point, parentBetId: 'line1' }),
      total(7),
      point
    );
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(expected);
  });

  test('point hit loses the lay', () => {
    const result = resolveBet(
      bet('dont_pass_odds', 1000, { oddsPoint: 4, parentBetId: 'line1' }),
      total(4),
      4
    );
    expect(result.outcome).toBe('lose');
  });
});

describe('odds tables', () => {
  test('pass odds are exactly fair against the true probability of each point', () => {
    // 4/10 are made 3 ways vs 6 for a seven -> 2:1. 5/9 four ways -> 3:2. 6/8 five -> 6:5.
    expect(oddsPayout('pass_odds', 4)).toEqual([2, 1]);
    expect(oddsPayout('pass_odds', 5)).toEqual([3, 2]);
    expect(oddsPayout('pass_odds', 6)).toEqual([6, 5]);
  });

  test("don't odds are the exact inverse", () => {
    expect(oddsPayout('dont_pass_odds', 4)).toEqual([1, 2]);
    expect(oddsPayout('dont_pass_odds', 5)).toEqual([2, 3]);
    expect(oddsPayout('dont_pass_odds', 6)).toEqual([5, 6]);
  });

  test('non-odds bet types have no odds payout', () => {
    expect(oddsPayout('pass_line', 6)).toBeNull();
    expect(oddsPayout('field', 6)).toBeNull();
  });

  test('invalid point has no odds payout', () => {
    expect(oddsPayout('pass_odds', 7)).toBeNull();
  });

  // 3-4-5x is chosen so the maximum odds WIN is always 6x the line bet whatever the point.
  test.each([
    [4, 3],
    [10, 3],
    [5, 4],
    [9, 4],
    [6, 5],
    [8, 5],
  ])('point %i allows %ix odds', (point, multiple) => {
    expect(maxOdds(1000, point)).toBe(1000 * multiple);
  });

  test('3-4-5x caps the odds win at 6x the line bet on every point', () => {
    for (const point of [4, 5, 6, 8, 9, 10]) {
      const stake = maxOdds(1000, point);
      const [win, wager] = oddsPayout('pass_odds', point) as readonly [number, number];
      expect(Math.floor((stake * win) / wager)).toBe(6000);
    }
  });
});

// ============ FIELD ============

describe('field', () => {
  test.each([3, 4, 9, 10, 11])('%i pays even money', (n: number) => {
    const result = resolveBet(bet('field', 1000), total(n), null);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(2000);
  });

  test('2 pays double', () => {
    expect(resolveBet(bet('field', 1000), total(2), null).payout).toBe(3000);
  });

  test('12 pays triple', () => {
    expect(resolveBet(bet('field', 1000), total(12), null).payout).toBe(4000);
  });

  test.each([5, 6, 7, 8])('%i loses', (n: number) => {
    expect(resolveBet(bet('field', 1000), total(n), null).outcome).toBe('lose');
  });

  test('calculateFieldPayout matches resolution', () => {
    expect(calculateFieldPayout(1000, 2)).toBe(3000);
    expect(calculateFieldPayout(1000, 12)).toBe(4000);
    expect(calculateFieldPayout(1000, 4)).toBe(2000);
  });
});

// ============ PLACE BETS ============

describe('place bets', () => {
  test.each([
    ['place_4' as BetType, 4, 500, 900],
    ['place_10' as BetType, 10, 500, 900],
    ['place_5' as BetType, 5, 500, 700],
    ['place_9' as BetType, 9, 500, 700],
    ['place_6' as BetType, 6, 600, 700],
    ['place_8' as BetType, 8, 600, 700],
  ])('%s pays %i at its true ratio: %i wins %i', (betType, target, amount, winnings) => {
    const result = resolveBet(bet(betType, amount), total(target), 8 === target ? 6 : 8);
    expect(result.outcome).toBe('win_and_stay');
    // win_and_stay reports WINNINGS only - the stake stays on the number.
    expect(result.payout).toBe(winnings);
  });

  test('seven out loses every place bet', () => {
    expect(resolveBet(bet('place_6', 600), total(7), 8).outcome).toBe('lose');
  });

  // Place bets ride through a point hit; they are not returned. They simply sit off
  // during the following come-out, which is the casino default.
  test('rides through a point hit rather than being returned', () => {
    expect(resolveBet(bet('place_6', 600), total(8), 8).outcome).toBe('pending');
  });

  test('is off during the come-out', () => {
    expect(resolveBet(bet('place_6', 600), total(6), null).outcome).toBe('pending');
    expect(resolveBet(bet('place_6', 600), total(7), null).outcome).toBe('pending');
  });

  test('calculatePlacePayout distinguishes 6/8 from 4/10', () => {
    expect(calculatePlacePayout(600, 'place_6')).toBe(700);
    expect(calculatePlacePayout(500, 'place_4')).toBe(900);
    expect(calculatePlacePayout(500, 'place_5')).toBe(700);
  });
});

// ============ HARDWAYS ============

describe('hardways', () => {
  test('hard 4 pays 7:1 on 2+2', () => {
    const result = resolveBet(bet('hard_4', 100), roll(2, 2), 8);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(800);
  });

  test('hard 10 pays 7:1 on 5+5', () => {
    expect(resolveBet(bet('hard_10', 100), roll(5, 5), 8).payout).toBe(800);
  });

  test('hard 6 pays 9:1 on 3+3', () => {
    expect(resolveBet(bet('hard_6', 100), roll(3, 3), 8).payout).toBe(1000);
  });

  test('hard 8 pays 9:1 on 4+4', () => {
    expect(resolveBet(bet('hard_8', 100), roll(4, 4), 6).payout).toBe(1000);
  });

  test('the same total made the easy way loses', () => {
    expect(resolveBet(bet('hard_8', 100), roll(5, 3), 6).outcome).toBe('lose');
    expect(resolveBet(bet('hard_8', 100), roll(6, 2), 6).outcome).toBe('lose');
  });

  test('any seven loses', () => {
    expect(resolveBet(bet('hard_8', 100), roll(3, 4), 6).outcome).toBe('lose');
  });

  test('an unrelated number rides', () => {
    expect(resolveBet(bet('hard_8', 100), roll(3, 2), 6).outcome).toBe('pending');
  });

  test('is off during the come-out', () => {
    expect(resolveBet(bet('hard_8', 100), roll(4, 4), null).outcome).toBe('pending');
    expect(resolveBet(bet('hard_8', 100), roll(3, 4), null).outcome).toBe('pending');
  });

  test('isHardWay identifies pairs only', () => {
    expect(isHardWay(roll(4, 4))).toBe(true);
    expect(isHardWay(roll(5, 3))).toBe(false);
  });
});

// ============ ONE-ROLL PROPS ============

describe('one-roll props', () => {
  test.each([
    ['any_seven' as BetType, 7, 500],
    ['any_craps' as BetType, 2, 800],
    ['any_craps' as BetType, 3, 800],
    ['any_craps' as BetType, 12, 800],
    ['yo' as BetType, 11, 1600],
    ['snake_eyes' as BetType, 2, 3100],
    ['boxcars' as BetType, 12, 3100],
  ])('%s hits on %i returning %i on a 100 stake', (betType, n, expected) => {
    const result = resolveBet(bet(betType, 100), total(n), 6);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(expected);
  });

  test('props lose on anything else, one roll and done', () => {
    expect(resolveBet(bet('yo', 100), total(7), 6).outcome).toBe('lose');
    expect(resolveBet(bet('any_seven', 100), total(11), 6).outcome).toBe('lose');
    expect(resolveBet(bet('snake_eyes', 100), total(12), 6).outcome).toBe('lose');
    expect(resolveBet(bet('boxcars', 100), total(2), 6).outcome).toBe('lose');
  });

  // Props are one-roll bets, so unlike place bets and hardways they are live on the
  // come-out too.
  test('props are live on the come-out', () => {
    expect(resolveBet(bet('any_seven', 100), total(7), null).outcome).toBe('win');
  });
});

// ============ SESSION VS DECISION ============

describe('endsSession', () => {
  // The bug this fixes: the table previously treated every line decision as the end of
  // the shooter's turn, so the dice changed hands on every come-out 7 or 11.
  test('only a seven out passes the dice', () => {
    expect(endsSession('seven_out')).toBe(true);
    expect(endsSession('natural')).toBe(false);
    expect(endsSession('craps')).toBe(false);
    expect(endsSession('point_hit')).toBe(false);
    expect(endsSession(null)).toBe(false);
  });
});

// ============ CONFIG INTEGRITY ============

describe('bet type table', () => {
  test('every bet type key fits craps_bets.bet_type VARCHAR(16)', () => {
    for (const betType of Object.keys(BET_TYPES)) {
      expect(betType.length).toBeLessThanOrEqual(16);
    }
  });

  test('only odds bets have a variable payout', () => {
    for (const [id, config] of Object.entries(BET_TYPES)) {
      const isOdds = config.family === 'odds';
      expect(config.payout === null).toBe(isOdds);
      expect(config.id).toBe(id);
    }
  });

  test('free odds are the only zero-edge bets on the table', () => {
    const zeroEdge = Object.values(BET_TYPES)
      .filter((c) => c.houseEdge === 0)
      .map((c) => c.id);
    expect(zeroEdge.sort()).toEqual(['dont_pass_odds', 'pass_odds']);
  });
});

// ============ TAKE DOWN ============

describe('canTakeDown', () => {
  // The pass line is a contract bet: having taken the good end of the come-out, a player
  // cannot then withdraw before the point resolves.
  test('pass line is locked once a point is on', () => {
    expect(canTakeDown('pass_line', null)).toBe(true);
    expect(canTakeDown('pass_line', 6)).toBe(false);
  });

  test("don't pass comes down freely - it is the reverse trade", () => {
    expect(canTakeDown('dont_pass', 6)).toBe(true);
  });

  test.each(['place_6', 'hard_8', 'pass_odds', 'field', 'yo'] as BetType[])(
    '%s can always be taken down',
    (betType: BetType) => {
      expect(canTakeDown(betType, 6)).toBe(true);
      expect(canTakeDown(betType, null)).toBe(true);
    }
  );
});
