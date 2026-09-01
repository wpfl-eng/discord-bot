import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { CrapsBet } from '../../discordCommands/craps/crapsEngine.js';
import type { BetType } from '../../discordCommands/craps/crapsConfig.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The table talks to three stores. None of them are what these tests are about.
const addToWallet = jest.fn<any>();
const openEscrow = jest.fn<any>();
const voidEscrow = jest.fn<any>();
const voidEscrowIds = jest.fn<any>();
const voidSession = jest.fn<any>();
const settleEscrowIds = jest.fn<any>();
const logSession = jest.fn<any>();
const updateStats = jest.fn<any>();
const saveTableState = jest.fn<any>();
const loadTableState = jest.fn<any>();
const clearTableState = jest.fn<any>();

jest.unstable_mockModule('../../economy/economyDb.js', () => ({ addToWallet }));
jest.unstable_mockModule('../../economy/escrowDb.js', () => ({
  openEscrow,
  voidEscrow,
  voidEscrowIds,
  voidSession,
  settleEscrowIds,
}));
jest.unstable_mockModule('../../craps/crapsDb.js', () => ({ logSession, updateStats }));
jest.unstable_mockModule('../../casino/casinoPersistence.js', () => ({
  saveTableState,
  loadTableState,
  clearTableState,
}));

const state = await import('../../discordCommands/craps/crapsState.js');

/** Only the three fields snapshotRebets reads are meaningful here. */
function bet(userId: string, betType: string, amount: number): CrapsBet {
  return {
    id: `${userId}-${betType}-${amount}`,
    userId,
    username: userId,
    betType: betType as BetType,
    amount,
    placedAt: new Date(),
    status: 'active',
    escrowIds: [1],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.__resetTableForTesting();
});

afterEach(() => {
  state.__resetTableForTesting();
});

// ============ RECOVERY ============

describe('canVoidTurn', () => {
  test('a turn that has not started paying can be handed back', () => {
    expect(state.canVoidTurn(false)).toBe(true);
  });

  // Between crediting a wallet and marking the escrow row settled, the row is paid but
  // still 'open'. Voiding one there pays the stake a second time.
  test('a turn that has started paying cannot', () => {
    expect(state.canVoidTurn(true)).toBe(false);
  });
});

// ============ REBET ============

describe('snapshotRebets', () => {
  test('an empty table produces nothing to repeat', () => {
    expect(state.snapshotRebets([]).size).toBe(0);
  });

  test('groups a player’s bets under them', () => {
    const snapshot = state.snapshotRebets([
      bet('u1', 'pass_line', 500),
      bet('u1', 'place_6', 600),
      bet('u2', 'field', 100),
    ]);

    expect(snapshot.get('u1')).toEqual([
      { betType: 'pass_line', amount: 500 },
      { betType: 'place_6', amount: 600 },
    ]);
    expect(snapshot.get('u2')).toEqual([{ betType: 'field', amount: 100 }]);
  });

  // The bug this replaced appended to one map for the life of the process, so Rebet
  // grew every round and eventually replayed a session's worth of bets in one click.
  test('is rebuilt each time rather than accumulated', () => {
    const first = state.snapshotRebets([bet('u1', 'pass_line', 500)]);
    const second = state.snapshotRebets([bet('u1', 'place_6', 600)]);

    expect(first.get('u1')).toHaveLength(1);
    expect(second.get('u1')).toEqual([{ betType: 'place_6', amount: 600 }]);
  });
});

// ============ CLOSED TABLE ============

describe('with no table open', () => {
  test('reports itself cold', () => {
    expect(state.isTableOpen()).toBe(false);
    expect(state.getCurrentPoint()).toBeNull();
    expect(state.isBettingOpen()).toBe(false);
    expect(state.isAwaitingRoll()).toBe(false);
    expect(state.getBoardMessageId()).toBeNull();
  });

  test('has nothing for anyone to repeat or take down', async () => {
    expect(state.getLastRoundBets('u1')).toEqual([]);
    expect(state.getUserBets('u1')).toEqual([]);
    await expect(state.undoLastBet('u1')).resolves.toBeNull();
    await expect(state.takeDownAll('u1')).resolves.toBe(0);
  });

  test('nobody holds the dice', () => {
    expect(state.getShooter()).toBeNull();
    expect(state.isShooter('u1')).toBe(false);
  });

  // Nothing above should have needed the database.
  test('touches no store', () => {
    expect(openEscrow).not.toHaveBeenCalled();
    expect(voidEscrowIds).not.toHaveBeenCalled();
  });
});
