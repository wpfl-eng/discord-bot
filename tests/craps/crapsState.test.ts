import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
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

beforeEach(() => {
  jest.clearAllMocks();
  state.__resetTableForTesting();
});

afterEach(() => {
  state.__resetTableForTesting();
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
