import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { EmbedBuilder, Client } from 'discord.js';

// Mock dependencies before importing
jest.unstable_mockModule('../../achievements/achievementDb.js', () => ({
  grantAchievement: jest.fn(),
}));

jest.unstable_mockModule('../../economy/economyDb.js', () => ({
  addToWallet: jest.fn(),
}));

jest.unstable_mockModule('../../economy/economyConfig.js', () => ({
  CHANNELS: {
    TOWN_SQUARE: '123456789', // Mock channel ID for testing
  },
  formatCurrency: (amount: number) => `🪙 ${amount.toLocaleString()}`,
}));

jest.unstable_mockModule('../../wordle/wordleDb.js', () => ({
  getUserStats: jest.fn(),
}));

// Import after mocking
const { checkForAchievements } = await import('../../achievements/achievementService.js');
const achievementDb = await import('../../achievements/achievementDb.js');
const economyDb = await import('../../economy/economyDb.js');
const wordleDb = await import('../../wordle/wordleDb.js');
const { ACTION_TYPES } = await import('../../achievements/achievementConfig.js');

// Cast mocks for easier use
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGrantAchievement = achievementDb.grantAchievement as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAddToWallet = economyDb.addToWallet as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetUserStats = wordleDb.getUserStats as any;

describe('achievementService', () => {
  let mockClient: Partial<Client>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockChannel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockChannelFetch: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockChannel = {
      send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      isTextBased: () => true,
    };

    mockChannelFetch = jest.fn<() => Promise<unknown>>().mockResolvedValue(mockChannel);

    mockClient = {
      channels: {
        fetch: mockChannelFetch,
      } as unknown as Client['channels'],
    };
  });

  describe('checkForAchievements', () => {
    describe('THIEF achievement', () => {
      test('grants THIEF on ROB_SUCCESS action', async () => {
        mockGrantAchievement.mockResolvedValue({
          user_id: '123',
          username: 'testuser',
          achievement_key: 'THIEF',
          achieved_at: new Date(),
        });
        mockAddToWallet.mockResolvedValue({ wallet: 200 });

        const result = await checkForAchievements({
          actionType: ACTION_TYPES.ROB_SUCCESS,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(achievementDb.grantAchievement).toHaveBeenCalledWith('123', 'testuser', 'THIEF');
        expect(economyDb.addToWallet).toHaveBeenCalledWith('123', 100);
        expect(result).toContain('THIEF');
      });

      test('does not grant already owned achievement', async () => {
        mockGrantAchievement.mockResolvedValue(null);

        const result = await checkForAchievements({
          actionType: ACTION_TYPES.ROB_SUCCESS,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(result).not.toContain('THIEF');
        expect(economyDb.addToWallet).not.toHaveBeenCalled();
      });
    });

    describe('WORDLE_FIRST_SOLVE achievement', () => {
      test('grants WORDLE_FIRST_SOLVE on first solve action', async () => {
        mockGrantAchievement.mockResolvedValue({
          user_id: '123',
          username: 'testuser',
          achievement_key: 'WORDLE_FIRST_SOLVE',
          achieved_at: new Date(),
        });
        mockAddToWallet.mockResolvedValue({ wallet: 600 });

        const result = await checkForAchievements({
          actionType: ACTION_TYPES.WORDLE_FIRST_SOLVE,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(achievementDb.grantAchievement).toHaveBeenCalledWith(
          '123',
          'testuser',
          'WORDLE_FIRST_SOLVE'
        );
        expect(result).toContain('WORDLE_FIRST_SOLVE');
      });
    });

    describe('WORDLE_5_SOLVES achievement', () => {
      test('grants WORDLE_5_SOLVES when stats show >= 5 wins', async () => {
        mockGetUserStats.mockResolvedValue({ games_won: 5 });
        mockGrantAchievement.mockResolvedValue({
          user_id: '123',
          username: 'testuser',
          achievement_key: 'WORDLE_5_SOLVES',
          achieved_at: new Date(),
        });
        mockAddToWallet.mockResolvedValue({ wallet: 850 });

        const result = await checkForAchievements({
          actionType: ACTION_TYPES.WORDLE_SOLVE,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(result).toContain('WORDLE_5_SOLVES');
      });

      test('does not grant WORDLE_5_SOLVES when stats show < 5 wins', async () => {
        mockGetUserStats.mockResolvedValue({ games_won: 4 });

        await checkForAchievements({
          actionType: ACTION_TYPES.WORDLE_SOLVE,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(achievementDb.grantAchievement).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'WORDLE_5_SOLVES'
        );
      });
    });

    describe('WORDLE_10_SOLVES achievement', () => {
      test('grants WORDLE_10_SOLVES when stats show >= 10 wins', async () => {
        mockGetUserStats.mockResolvedValue({ games_won: 10 });
        mockGrantAchievement.mockResolvedValue({
          user_id: '123',
          username: 'testuser',
          achievement_key: 'WORDLE_10_SOLVES',
          achieved_at: new Date(),
        });
        mockAddToWallet.mockResolvedValue({ wallet: 1100 });

        const result = await checkForAchievements({
          actionType: ACTION_TYPES.WORDLE_SOLVE,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(result).toContain('WORDLE_10_SOLVES');
      });
    });

    describe('unknown action types', () => {
      test('returns empty array for unmapped action types', async () => {
        const result = await checkForAchievements({
          actionType: ACTION_TYPES.GAMBLE_WIN,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(result).toEqual([]);
        expect(achievementDb.grantAchievement).not.toHaveBeenCalled();
      });
    });

    describe('announcement', () => {
      test('sends announcement embed to town-square channel', async () => {
        mockGrantAchievement.mockResolvedValue({
          user_id: '123',
          username: 'testuser',
          achievement_key: 'THIEF',
          achieved_at: new Date(),
        });
        mockAddToWallet.mockResolvedValue({ wallet: 200 });

        await checkForAchievements({
          actionType: ACTION_TYPES.ROB_SUCCESS,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(mockChannel.send).toHaveBeenCalledWith({
          embeds: [expect.any(EmbedBuilder)],
        });
      });

      test('handles missing channel gracefully', async () => {
        mockChannelFetch.mockResolvedValue(null);
        mockGrantAchievement.mockResolvedValue({
          user_id: '123',
          username: 'testuser',
          achievement_key: 'THIEF',
          achieved_at: new Date(),
        });
        mockAddToWallet.mockResolvedValue({ wallet: 200 });

        // Should not throw
        const result = await checkForAchievements({
          actionType: ACTION_TYPES.ROB_SUCCESS,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(result).toContain('THIEF');
      });
    });

    describe('error handling', () => {
      test('catches and logs errors without crashing', async () => {
        mockGrantAchievement.mockRejectedValue(new Error('DB error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const result = await checkForAchievements({
          actionType: ACTION_TYPES.ROB_SUCCESS,
          userId: '123',
          username: 'testuser',
          client: mockClient as Client,
        });

        expect(result).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
      });
    });
  });
});
