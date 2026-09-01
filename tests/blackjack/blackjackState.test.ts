import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The table talks to three stores. None of them are what these tests are about.
const getOrCreateUser = jest.fn<any>();
const addToWallet = jest.fn<any>();
const openEscrow = jest.fn<any>();
const voidEscrow = jest.fn<any>();
const voidSession = jest.fn<any>();
const settleEscrowIds = jest.fn<any>();
const recordGameResult = jest.fn<any>();
const saveTableState = jest.fn<any>();
const loadTableState = jest.fn<any>();
const clearTableState = jest.fn<any>();

jest.unstable_mockModule('../../economy/economyDb.js', () => ({ getOrCreateUser, addToWallet }));
jest.unstable_mockModule('../../economy/escrowDb.js', () => ({
  openEscrow,
  voidEscrow,
  voidSession,
  settleEscrowIds,
}));
jest.unstable_mockModule('../../blackjack/blackjackDb.js', () => ({ recordGameResult }));
jest.unstable_mockModule('../../casino/casinoPersistence.js', () => ({
  saveTableState,
  loadTableState,
  clearTableState,
}));

const state = await import('../../discordCommands/blackjack/blackjackState.js');

beforeEach(() => {
  jest.clearAllMocks();
  state.__resetTableForTesting();
});

afterEach(() => {
  state.__resetTableForTesting();
});

// ============ RECOVERY ============

describe('canVoidRound', () => {
  test('a round that has not started paying can be handed back', () => {
    expect(state.canVoidRound(false)).toBe(true);
  });

  // Between crediting a wallet and marking the escrow row settled, the row is paid but
  // still 'open'. Voiding one there pays the stake a second time.
  test('a round that has started paying cannot', () => {
    expect(state.canVoidRound(true)).toBe(false);
  });
});

// ============ INSURANCE ============

describe('everyoneAnsweredInsurance', () => {
  const took = { insuranceBet: 500, insuranceSettled: true };
  const declined = { insuranceBet: 0, insuranceSettled: true };
  const thinking = { insuranceBet: 0, insuranceSettled: false };

  test('an empty table has nobody to wait for, but there is no round to advance', () => {
    expect(state.everyoneAnsweredInsurance([])).toBe(false);
  });

  test('one seat still deciding holds the round', () => {
    expect(state.everyoneAnsweredInsurance([took, thinking])).toBe(false);
  });

  test('taking counts as an answer', () => {
    expect(state.everyoneAnsweredInsurance([took])).toBe(true);
  });

  test('declining counts as an answer', () => {
    expect(state.everyoneAnsweredInsurance([declined])).toBe(true);
  });

  test('a full table that has all answered releases the round', () => {
    expect(state.everyoneAnsweredInsurance([took, declined, took])).toBe(true);
  });
});

// ============ CLOSED TABLE ============

describe('with no table open', () => {
  test('reports itself closed', () => {
    expect(state.isTableOpen()).toBe(false);
    expect(state.getPhase()).toBe('idle');
    expect(state.getBoardMessageId()).toBeNull();
  });

  test('has no seat for anyone', () => {
    expect(state.getSeatView('u1')).toBeNull();
  });

  test('refuses to stand someone up', () => {
    expect(state.standUp('u1').ok).toBe(false);
  });

  test('refuses insurance either way', async () => {
    expect(state.declineInsurance('u1').ok).toBe(false);
    await expect(state.takeInsurance('u1')).resolves.toMatchObject({ ok: false });
  });

  test('refuses to act', async () => {
    await expect(state.act('u1', 'hit')).resolves.toMatchObject({ ok: false });
  });

  // Nothing above should have needed the database.
  test('touches no store', () => {
    expect(openEscrow).not.toHaveBeenCalled();
    expect(addToWallet).not.toHaveBeenCalled();
  });
});
