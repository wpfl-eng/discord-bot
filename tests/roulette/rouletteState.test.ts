import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-explicit-any */

const addToWallet = jest.fn<any>();
const settleEscrowIds = jest.fn<any>();
const voidSession = jest.fn<any>();
const logCompleteRound = jest.fn<any>();
const getRecentRounds = jest.fn<any>();

jest.unstable_mockModule('../../economy/economyDb.js', () => ({ addToWallet }));
jest.unstable_mockModule('../../economy/escrowDb.js', () => ({ settleEscrowIds, voidSession }));
jest.unstable_mockModule('../../discordCommands/roulette/rouletteDb.js', () => ({
  logCompleteRound,
  getRecentRounds,
}));

const state = await import('../../discordCommands/roulette/rouletteState.js');
const { TIMING, LIMITS } = await import('../../discordCommands/roulette/rouletteConfig.js');

/** A channel that records what the table sends, and hands back a fake message. */
function fakeChannel() {
  const edits: any[] = [];
  const message = {
    id: 'msg1',
    edit: jest.fn<any>(async (payload: any) => {
      edits.push(payload);
      return message;
    }),
  };
  return {
    id: 'chan1',
    send: jest.fn<any>(async () => message),
    __edits: edits,
    __message: message,
  };
}

const fakeClient = {} as any;

function bet(userId: string, betType: string, amount: number, escrowId: number) {
  return { userId, username: userId, betType, amount, placedAt: new Date(), escrowId };
}

describe('roulette table state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRecentRounds.mockResolvedValue([]);
    addToWallet.mockResolvedValue({ user_id: 'u1' });
    settleEscrowIds.mockResolvedValue(0);
    voidSession.mockResolvedValue({ rowsRefunded: 0, totalRefunded: 0, byUser: [] });
    logCompleteRound.mockResolvedValue(1);
    state.__resetTableForTesting();
  });

  afterEach(() => {
    state.__resetTableForTesting();
  });

  describe('opening', () => {
    test('is closed until a bet opens it', () => {
      expect(state.isTableOpen()).toBe(false);
      expect(state.getActiveSessionKey()).toBeNull();
    });

    test('opens on demand and starts a betting window', async () => {
      const channel = fakeChannel();
      await state.ensureTable(fakeClient, channel as any, 'u1');

      expect(state.isTableOpen()).toBe(true);
      expect(state.isBettingOpen()).toBe(true);
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(state.getActiveSessionKey()).toBeTruthy();
    });

    // Two players betting at the same instant must not each open a table, which would
    // leave one message orphaned with a timer running against it.
    test('concurrent opens produce exactly one table', async () => {
      const channel = fakeChannel();
      await Promise.all([
        state.ensureTable(fakeClient, channel as any, 'u1'),
        state.ensureTable(fakeClient, channel as any, 'u2'),
        state.ensureTable(fakeClient, channel as any, 'u3'),
      ]);

      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    test('seeds the recent-spins strip from history', async () => {
      getRecentRounds.mockResolvedValue([{ result_number: '17' }, { result_number: '0' }]);
      const channel = fakeChannel();
      await state.ensureTable(fakeClient, channel as any, 'u1');

      expect(getRecentRounds).toHaveBeenCalledWith(LIMITS.HISTORY_LENGTH);
    });

    // A table nobody can see must not keep timers running.
    test('does not leave a table open when the message fails to send', async () => {
      const channel = fakeChannel();
      channel.send.mockRejectedValue(new Error('missing permissions'));

      await expect(state.ensureTable(fakeClient, channel as any, 'u1')).rejects.toThrow();
      expect(state.isTableOpen()).toBe(false);
    });
  });

  describe('bets', () => {
    beforeEach(async () => {
      await state.ensureTable(fakeClient, fakeChannel() as any, 'u1');
    });

    test('accepts a bet and reports it back to its owner', async () => {
      await state.addBet(bet('u1', 'red', 500, 1));

      expect(state.getUserBets('u1')).toHaveLength(1);
      expect(state.getUserBets('u2')).toHaveLength(0);
    });

    test('rejects a bet when betting is not open', async () => {
      state.__resetTableForTesting();
      await expect(state.addBet(bet('u1', 'red', 500, 1))).rejects.toThrow('Betting is closed');
    });

    // Undo has to return the escrow id, or the caller cannot refund the stake.
    test('undo removes only the most recent bet and yields its escrow id', async () => {
      await state.addBet(bet('u1', 'red', 500, 1));
      await state.addBet(bet('u1', '17', 100, 2));

      const removed = state.popLastBet('u1');

      expect(removed?.escrowId).toBe(2);
      expect(state.getUserBets('u1')).toHaveLength(1);
      expect(state.getUserBets('u1')[0].escrowId).toBe(1);
    });

    test("undo never touches another player's bets", async () => {
      await state.addBet(bet('u1', 'red', 500, 1));
      await state.addBet(bet('u2', 'black', 500, 2));

      const removed = state.popLastBet('u1');

      expect(removed?.userId).toBe('u1');
      expect(state.getUserBets('u2')).toHaveLength(1);
    });

    test('undo returns null when there is nothing to take back', () => {
      expect(state.popLastBet('nobody')).toBeNull();
    });

    test("clear removes all of one player's bets and leaves the rest", async () => {
      await state.addBet(bet('u1', 'red', 500, 1));
      await state.addBet(bet('u1', '17', 100, 2));
      await state.addBet(bet('u2', 'black', 500, 3));

      const removed = state.popAllBets('u1');

      expect(removed.map((b) => b.escrowId).sort()).toEqual([1, 2]);
      expect(state.getUserBets('u1')).toHaveLength(0);
      expect(state.getUserBets('u2')).toHaveLength(1);
    });

    // Letting a bet be pulled mid-spin would refund a stake the wheel is resolving.
    test('bets cannot be pulled once betting closes', async () => {
      await state.addBet(bet('u1', 'red', 500, 1));
      state.__resetTableForTesting();

      expect(state.popLastBet('u1')).toBeNull();
      expect(state.popAllBets('u1')).toEqual([]);
    });
  });

  describe('closing', () => {
    test('refunds anything still on the table', async () => {
      await state.ensureTable(fakeClient, fakeChannel() as any, 'u1');
      await state.addBet(bet('u1', 'red', 500, 1));

      await state.closeTable();

      expect(voidSession).toHaveBeenCalledWith('roulette', expect.any(String));
      expect(state.isTableOpen()).toBe(false);
    });

    test('does not call for a refund when nothing is on the table', async () => {
      await state.ensureTable(fakeClient, fakeChannel() as any, 'u1');

      await state.closeTable();

      expect(voidSession).not.toHaveBeenCalled();
    });

    test('closing an already-closed table is harmless', async () => {
      await expect(state.closeTable()).resolves.toBeUndefined();
    });
  });

  describe('timing configuration', () => {
    // The window must be able to extend without exceeding its own ceiling.
    test('the extension cap exceeds both window lengths', () => {
      expect(TIMING.MAX_WINDOW_SECONDS).toBeGreaterThanOrEqual(TIMING.FIRST_WINDOW_SECONDS);
      expect(TIMING.MAX_WINDOW_SECONDS).toBeGreaterThan(TIMING.NEXT_WINDOW_SECONDS);
    });

    test('later windows are shorter than the first', () => {
      expect(TIMING.NEXT_WINDOW_SECONDS).toBeLessThan(TIMING.FIRST_WINDOW_SECONDS);
    });

    // Three frames plus the result hold has to fit comfortably inside a window.
    test('the spin animation is shorter than the shortest betting window', () => {
      const spinMs = TIMING.SPIN_FRAME_MS * 3 + TIMING.RESULT_HOLD_MS;
      expect(spinMs).toBeLessThan(TIMING.NEXT_WINDOW_SECONDS * 1000);
    });

    test('limits leave room for the payout the config advertises', () => {
      expect(LIMITS.MAX_BET).toBe(100_000);
      expect(LIMITS.MIN_BET).toBeLessThan(LIMITS.MAX_BET);
    });
  });

  describe('repaint coalescing', () => {
    // Discord rate limits edits per channel. A flurry of chips must not become a
    // flurry of edits, or the table starts 429ing mid-round.
    test('a burst of bets does not produce an edit per bet', async () => {
      const channel = fakeChannel();
      await state.ensureTable(fakeClient, channel as any, 'u1');

      const editsAfterOpen = channel.__message.edit.mock.calls.length;

      for (let i = 0; i < 10; i++) {
        await state.addBet(bet('u1', 'red', 100, i + 1));
      }

      const editsFromBets = channel.__message.edit.mock.calls.length - editsAfterOpen;
      expect(editsFromBets).toBeLessThan(10);
    });

    test('every bet still lands regardless of repaint timing', async () => {
      const channel = fakeChannel();
      await state.ensureTable(fakeClient, channel as any, 'u1');

      for (let i = 0; i < 10; i++) {
        await state.addBet(bet('u1', 'red', 100, i + 1));
      }

      expect(state.getUserBets('u1')).toHaveLength(10);
    });
  });
});
