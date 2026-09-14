import { describe, test, expect } from '@jest/globals';
import { optimalPoints, type SolveEntry } from '../../wpfl/lineupSolve.js';

const RB = ['RB', 'RB/WR/TE', 'Bench', 'IR'];
const WR = ['WR', 'WR/TE', 'RB/WR/TE', 'Bench', 'IR'];
const TE = ['TE', 'WR/TE', 'RB/WR/TE', 'Bench', 'IR'];
const QB = ['QB', 'Bench', 'IR'];
const K = ['K', 'Bench', 'IR'];
const DST = ['D/ST', 'Bench', 'IR'];

const entry = (
  points: number,
  eligible: readonly string[],
  slot: string = 'Bench'
): SolveEntry => ({
  points,
  eligible,
  slot,
});

/** Every slot filled with a distinct player, the way the best lineup on the day would be. */
const fullRoster = (): SolveEntry[] => [
  entry(20, QB, 'QB'),
  entry(5, QB),
  entry(12, RB, 'RB'),
  entry(8, RB, 'RB'),
  entry(15, RB),
  entry(10, WR, 'WR'),
  entry(9, WR, 'WR'),
  entry(3, WR),
  entry(6, TE, 'TE'),
  entry(7, TE),
  entry(4, RB, 'RB/WR/TE'),
  entry(9, K, 'K'),
  entry(8, DST, 'D/ST'),
];

/**
 * The best lineup a roster could have started, from ESPN's own eligibility
 * lists. The prompt forbids the model working this out; the history API
 * that publishes it lags the live week by days.
 */
describe('optimalPoints', () => {
  test('takes the best at each slot and the best leftover at flex, whoever actually started', () => {
    // QB 20, RB 15 + 12, WR 10 + 9, TE 7, flex RB 8, K 9, D/ST 8.
    expect(optimalPoints(fullRoster())).toBe(98);
  });

  test('places a multi-slot player where the total is highest, which a pick by bare position misses', () => {
    // Two tight ends both listed at WR/TE. By position: TE 30, WR 10 + 9, flex 25 -> 74 with
    // the 20-point receiver on the bench. Exact: TE 30, WR 25 (at WR/TE) + 10, flex 20 -> 85.
    const roster: SolveEntry[] = [
      entry(20, QB),
      entry(12, RB),
      entry(8, RB),
      entry(10, WR),
      entry(9, WR),
      entry(20, WR),
      entry(30, TE),
      entry(25, TE),
      entry(9, K),
      entry(8, DST),
    ];
    expect(optimalPoints(roster)).toBe(20 + 12 + 8 + 25 + 10 + 30 + 20 + 9 + 8);
  });

  test('a player in the IR slot cannot score, however many points ESPN credits him', () => {
    const roster: SolveEntry[] = [...fullRoster(), entry(40, RB, 'IR')];
    expect(optimalPoints(roster)).toBe(98);
  });

  test('a slot nobody can fill scores nothing rather than failing the solve', () => {
    const roster: SolveEntry[] = fullRoster().filter((e: SolveEntry) => !e.eligible.includes('K'));
    expect(optimalPoints(roster)).toBe(89);
  });

  test('an empty roster is 0', () => {
    expect(optimalPoints([])).toBe(0);
  });
});
