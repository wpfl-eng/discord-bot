import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addToWallet = jest.fn<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settleEscrowIds = jest.fn<any>();

jest.unstable_mockModule('../../economy/economyDb.js', () => ({ addToWallet }));
jest.unstable_mockModule('../../economy/escrowDb.js', () => ({ settleEscrowIds }));
jest.unstable_mockModule('../../economy/economyConfig.js', () => ({
  CONFIG: { GAMBLE_MIN: 10, GAMBLE_MAX: 10000 },
  formatCurrency: (n: number) => `${n}`,
  CHANNELS: {},
}));

const { processPayouts } = await import('../../discordCommands/roulette/rouletteState.js');

interface BetSpec {
  betType: string;
  amount: number;
  escrowId: number;
  userId?: string;
}

function bet(spec: BetSpec) {
  return {
    userId: spec.userId ?? 'u1',
    username: 'aj',
    betType: spec.betType,
    amount: spec.amount,
    placedAt: new Date(),
    escrowId: spec.escrowId,
  };
}

describe('roulette payouts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addToWallet.mockResolvedValue({ user_id: 'u1', wallet: 99999 });
    settleEscrowIds.mockResolvedValue(0);
  });

  test('credits a straight-up winner stake plus 35x profit', async () => {
    const results = await processPayouts(
      [bet({ betType: '17', amount: 1000, escrowId: 1 })],
      '17',
      'black'
    );

    expect(addToWallet).toHaveBeenCalledWith('u1', 36000);
    expect(results[0].won).toBe(true);
    expect(results[0].paid).toBe(true);
    expect(results[0].profit).toBe(35000);
    expect(results[0].totalReturn).toBe(36000);
  });

  test('credits an even-money winner stake plus 1x profit', async () => {
    const results = await processPayouts(
      [bet({ betType: 'red', amount: 500, escrowId: 1 })],
      '19',
      'red'
    );

    expect(addToWallet).toHaveBeenCalledWith('u1', 1000);
    expect(results[0].profit).toBe(500);
  });

  test('a loser is credited nothing and its stake is settled to the house', async () => {
    const results = await processPayouts(
      [bet({ betType: 'red', amount: 500, escrowId: 7 })],
      '17',
      'black'
    );

    expect(addToWallet).not.toHaveBeenCalled();
    expect(results[0].won).toBe(false);
    expect(results[0].paid).toBe(true);
    expect(settleEscrowIds).toHaveBeenCalledWith([7]);
  });

  // The regression this replaces recorded won:true after a failed credit, so the
  // database claimed a payout the wallet never received and the stake was lost too.
  test('a credit that throws leaves the wager unsettled and marked unpaid', async () => {
    addToWallet.mockRejectedValue(new Error('connection reset'));

    const results = await processPayouts(
      [bet({ betType: '17', amount: 1000, escrowId: 9 })],
      '17',
      'black'
    );

    expect(results[0].won).toBe(true);
    expect(results[0].paid).toBe(false);
    // Not settled: the row stays open so the startup sweep returns the stake.
    expect(settleEscrowIds).toHaveBeenCalledWith([]);
  });

  // addToWallet signals a missing user row by returning null rather than throwing.
  test('a credit that returns null is treated as a failure, not a success', async () => {
    addToWallet.mockResolvedValue(null);

    const results = await processPayouts(
      [bet({ betType: '17', amount: 1000, escrowId: 9 })],
      '17',
      'black'
    );

    expect(results[0].paid).toBe(false);
    expect(settleEscrowIds).toHaveBeenCalledWith([]);
  });

  test('an unknown bet type is never settled, so the stake is refundable', async () => {
    const results = await processPayouts(
      [bet({ betType: 'not-a-real-bet', amount: 250, escrowId: 3 })],
      '17',
      'black'
    );

    expect(results[0].paid).toBe(false);
    expect(addToWallet).not.toHaveBeenCalled();
    expect(settleEscrowIds).toHaveBeenCalledWith([]);
  });

  test('settles only the wagers that resolved cleanly in a mixed round', async () => {
    addToWallet
      .mockResolvedValueOnce({ user_id: 'u1' }) // winner credited
      .mockRejectedValueOnce(new Error('boom')); // winner failed

    const results = await processPayouts(
      [
        bet({ betType: 'red', amount: 100, escrowId: 1 }), // wins, credited
        bet({ betType: '19', amount: 100, escrowId: 2, userId: 'u2' }), // wins, fails
        bet({ betType: 'black', amount: 100, escrowId: 3 }), // loses
      ],
      '19',
      'red'
    );

    expect(results.map((r) => r.paid)).toEqual([true, false, true]);
    expect(settleEscrowIds).toHaveBeenCalledWith([1, 3]);
  });

  test('green takes every outside bet on the table', async () => {
    const results = await processPayouts(
      [
        bet({ betType: 'red', amount: 100, escrowId: 1 }),
        bet({ betType: 'black', amount: 100, escrowId: 2 }),
        bet({ betType: 'odd', amount: 100, escrowId: 3 }),
        bet({ betType: 'even', amount: 100, escrowId: 4 }),
        bet({ betType: 'first-dozen', amount: 100, escrowId: 5 }),
      ],
      '00',
      'green'
    );

    expect(results.every((r) => !r.won)).toBe(true);
    expect(addToWallet).not.toHaveBeenCalled();
  });

  test('a failure to settle does not lose the results', async () => {
    settleEscrowIds.mockRejectedValue(new Error('db down'));

    const results = await processPayouts(
      [bet({ betType: 'red', amount: 100, escrowId: 1 })],
      '19',
      'red'
    );

    expect(results).toHaveLength(1);
    expect(results[0].won).toBe(true);
  });
});
