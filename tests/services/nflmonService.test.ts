import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { EmbedBuilder } from 'discord.js';
import type { Nflmon, NflmonTrade } from '../../nflmon/nflmonDb.js';

// Mock dependencies before importing
jest.unstable_mockModule('../../nflmon/nflmonDb.js', () => ({
  getOrCreateStats: jest.fn(),
  addNflmon: jest.fn(),
  addXpToAllTraining: jest.fn(),
  acceptTrade: jest.fn(),
  rejectTrade: jest.fn(),
  cancelTrade: jest.fn(),
}));

// Import after mocking
const nflmonService = await import('../../nflmon/nflmonService.js');
const nflmonDb = await import('../../nflmon/nflmonDb.js');

// Cast mocks for easier use
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetOrCreateStats = nflmonDb.getOrCreateStats as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAddNflmon = nflmonDb.addNflmon as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAddXpToAllTraining = nflmonDb.addXpToAllTraining as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAcceptTrade = nflmonDb.acceptTrade as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRejectTrade = nflmonDb.rejectTrade as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCancelTrade = nflmonDb.cancelTrade as any;

// Type definition for BenchRecord (exported from nflmonService)
type BenchRecord = {
  id: number;
  user_id: string;
  player_id: string;
  level: number;
  rarity: string;
  current_xp: number;
  iv_speed: number;
  iv_power: number;
  iv_agility: number;
  iv_awareness: number;
  iv_hp: number;
  evolution_stage: string;
  training_slot: number | null;
  is_favorite: boolean;
  nickname: string | null;
  variant: string;
  acquired_at: Date;
  acquired_source: string;
};

describe('nflmonService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPlayer', () => {
    test('returns player for valid ID', () => {
      const player = nflmonService.getPlayer('mahomes_patrick');
      expect(player).not.toBeNull();
      expect(player?.name).toBe('Patrick Mahomes');
      expect(player?.position).toBe('QB');
      expect(player?.team).toBe('KC');
    });

    test('returns null for unknown ID', () => {
      const player = nflmonService.getPlayer('unknown_player');
      expect(player).toBeNull();
    });
  });

  describe('getAllPlayers', () => {
    test('returns array of players', () => {
      const players = nflmonService.getAllPlayers();
      expect(Array.isArray(players)).toBe(true);
      expect(players.length).toBeGreaterThan(0);
    });

    test('each player has required properties', () => {
      const players = nflmonService.getAllPlayers();
      const player = players[0];
      expect(player).toHaveProperty('id');
      expect(player).toHaveProperty('name');
      expect(player).toHaveProperty('team');
      expect(player).toHaveProperty('position');
      expect(player).toHaveProperty('rarityPool');
    });
  });

  describe('getRandomPlayer', () => {
    test('returns a player from pool', () => {
      const player = nflmonService.getRandomPlayer();
      expect(player).not.toBeNull();
      expect(player).toHaveProperty('id');
      expect(player).toHaveProperty('name');
    });
  });

  describe('getPlayersByPosition', () => {
    test('filters by position case-insensitively', () => {
      const qbs = nflmonService.getPlayersByPosition('qb');
      expect(qbs.length).toBeGreaterThan(0);
      expect(qbs.every((p) => p.position.toUpperCase() === 'QB')).toBe(true);
    });

    test('returns empty array for unknown position', () => {
      const players = nflmonService.getPlayersByPosition('UNKNOWN');
      expect(players).toEqual([]);
    });
  });

  describe('getPlayersByTeam', () => {
    test('filters by team case-insensitively', () => {
      const kcPlayers = nflmonService.getPlayersByTeam('kc');
      expect(kcPlayers.length).toBeGreaterThan(0);
      expect(kcPlayers.every((p) => p.team.toUpperCase() === 'KC')).toBe(true);
    });

    test('returns empty array for unknown team', () => {
      const players = nflmonService.getPlayersByTeam('XXX');
      expect(players).toEqual([]);
    });
  });

  describe('getPlayersByRarity', () => {
    test('filters by rarity case-insensitively', () => {
      const legendaries = nflmonService.getPlayersByRarity('LEGENDARY');
      expect(legendaries.length).toBeGreaterThan(0);
      expect(legendaries.every((p) => p.rarityPool.toLowerCase() === 'legendary')).toBe(true);
    });
  });

  describe('getRandomCommonPlayers', () => {
    test('returns requested number of common players', () => {
      const players = nflmonService.getRandomCommonPlayers(3);
      expect(players.length).toBeLessThanOrEqual(3);
      expect(players.every((p) => p.rarityPool === 'common')).toBe(true);
    });

    test('returns all if count exceeds available', () => {
      const allCommon = nflmonService.getPlayersByRarity('common');
      const players = nflmonService.getRandomCommonPlayers(999);
      expect(players.length).toBe(allCommon.length);
    });
  });

  describe('getDisplayData', () => {
    test('returns null for null input', () => {
      const result = nflmonService.getDisplayData(null);
      expect(result).toBeNull();
    });

    test('returns null if player not found', () => {
      const benchRecord: BenchRecord = {
        id: 1,
        player_id: 'unknown_player_xyz',
        user_id: '123',
        level: 1,
        rarity: 'common',
        current_xp: 0,
        iv_speed: 5,
        iv_power: 5,
        iv_agility: 5,
        iv_awareness: 5,
        iv_hp: 5,
        evolution_stage: 'rookie',
        nickname: null,
        is_favorite: false,
        training_slot: null,
        variant: 'standard',
        acquired_at: new Date(),
        acquired_source: 'shop',
      };
      const result = nflmonService.getDisplayData(benchRecord);
      expect(result).toBeNull();
    });

    test('calculates all display fields correctly', () => {
      const benchRecord: BenchRecord = {
        id: 123,
        user_id: '123',
        player_id: 'mahomes_patrick',
        level: 10,
        rarity: 'legendary',
        current_xp: 500,
        iv_speed: 10,
        iv_power: 10,
        iv_agility: 10,
        iv_awareness: 10,
        iv_hp: 10,
        evolution_stage: 'rookie',
        nickname: null,
        is_favorite: false,
        training_slot: null,
        variant: 'standard',
        acquired_at: new Date(),
        acquired_source: 'shop',
      };

      const result = nflmonService.getDisplayData(benchRecord);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(123);
      expect(result?.level).toBe(10);
      expect(result?.player.name).toBe('Patrick Mahomes');
      expect(result?.displayName).toBe('Patrick Mahomes');
      expect(result?.rarityName).toBe('Legendary');
      expect(result?.stats).toBeDefined();
      expect(result?.ivTotal).toBe(50);
    });
  });

  describe('TRADE_ERRORS', () => {
    test('has all expected error keys', () => {
      expect(nflmonService.TRADE_ERRORS).toHaveProperty('NOT_FOUND');
      expect(nflmonService.TRADE_ERRORS).toHaveProperty('NOT_RECIPIENT');
      expect(nflmonService.TRADE_ERRORS).toHaveProperty('NOT_PENDING');
      expect(nflmonService.TRADE_ERRORS).toHaveProperty('NOT_SENDER');
      expect(nflmonService.TRADE_ERRORS).toHaveProperty('EXPIRED');
      expect(nflmonService.TRADE_ERRORS).toHaveProperty('INSUFFICIENT_COINS');
      expect(nflmonService.TRADE_ERRORS).toHaveProperty('SELF_TRADE');
    });
  });

  describe('rollForNflmon', () => {
    test('returns roll result with nflmon, player, and rarity', async () => {
      mockGetOrCreateStats.mockResolvedValue({ user_id: '123' });
      mockAddNflmon.mockResolvedValue({
        id: 1,
        player_id: 'mahomes_patrick',
        rarity: 'legendary',
        level: 1,
      });

      const result = await nflmonService.rollForNflmon('123', 'testuser', 'shop');

      expect(result).not.toBeNull();
      expect(result?.nflmon).toBeDefined();
      expect(result?.player).toBeDefined();
      expect(result?.rarity).toBeDefined();
    });

    test('returns null when addNflmon fails', async () => {
      mockGetOrCreateStats.mockResolvedValue({ user_id: '123' });
      mockAddNflmon.mockResolvedValue(null);

      const result = await nflmonService.rollForNflmon('123', 'testuser', 'shop');

      expect(result).toBeNull();
    });
  });

  describe('addXpToTraining', () => {
    test('returns results with XP amount', async () => {
      mockAddXpToAllTraining.mockResolvedValue([
        {
          nflmon: { id: 1, player_id: 'mahomes_patrick', level: 2 } as Nflmon,
          xpGained: 10,
          levelsGained: 1,
          evolved: false,
          newStage: null,
        },
      ]);

      const result = await nflmonService.addXpToTraining('123', 'wordle_win');

      expect(result.results).toBeDefined();
      expect(result.xpAmount).toBeGreaterThan(0);
    });

    test('returns empty results for invalid source', async () => {
      const result = await nflmonService.addXpToTraining('123', 'invalid_source');

      expect(result.results).toEqual([]);
      expect(result.xpAmount).toBe(0);
    });
  });

  describe('buildBenchEmbed', () => {
    test('returns embed with NFLmon list', () => {
      const records: BenchRecord[] = [
        {
          id: 1,
          user_id: '123',
          player_id: 'mahomes_patrick',
          level: 5,
          rarity: 'legendary',
          current_xp: 100,
          iv_speed: 10,
          iv_power: 10,
          iv_agility: 10,
          iv_awareness: 10,
          iv_hp: 10,
          evolution_stage: 'rookie',
          training_slot: null,
          is_favorite: false,
          nickname: null,
          variant: 'standard',
          acquired_at: new Date(),
          acquired_source: 'shop',
        },
      ];

      const embed = nflmonService.buildBenchEmbed(records, 1, 1, 1);

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.title).toBe('Your NFLmon Bench');
    });

    test('shows empty message when no NFLmon', () => {
      const embed = nflmonService.buildBenchEmbed([], 1, 1, 0);

      expect(embed.data.fields?.[0]?.value).toContain("You haven't caught any NFLmon yet");
    });
  });

  describe('processTradeAccept', () => {
    test('returns success with embeds on successful trade', async () => {
      mockAcceptTrade.mockResolvedValue({
        success: true,
        trade: {
          id: 1,
          from_user_id: 'user1',
          to_user_id: 'user2',
          coins_offered: 0,
        } as NflmonTrade,
        fromNflmon: { player_id: 'mahomes_patrick' } as Nflmon,
        toNflmon: { player_id: 'allen_josh' } as Nflmon,
      });

      const result = await nflmonService.processTradeAccept('123', 1);

      expect(result.success).toBe(true);
      expect(result.responseEmbed).toBeInstanceOf(EmbedBuilder);
      expect(result.announceEmbed).toBeInstanceOf(EmbedBuilder);
    });

    test('returns failure embed on trade error', async () => {
      mockAcceptTrade.mockResolvedValue({
        success: false,
        error: 'NOT_FOUND',
      });

      const result = await nflmonService.processTradeAccept('123', 999);

      expect(result.success).toBe(false);
      expect(result.responseEmbed).toBeInstanceOf(EmbedBuilder);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('processTradeReject', () => {
    test('returns success embed', async () => {
      mockRejectTrade.mockResolvedValue({} as NflmonTrade);

      const result = await nflmonService.processTradeReject('123', 1);

      expect(result.success).toBe(true);
      expect(result.responseEmbed).toBeInstanceOf(EmbedBuilder);
    });
  });

  describe('processTradeCancel', () => {
    test('returns success embed on cancel', async () => {
      // cancelTrade returns the trade if successful
      mockCancelTrade.mockResolvedValue({} as NflmonTrade);

      const result = await nflmonService.processTradeCancel('123', 1);

      expect(result.success).toBe(true);
      expect(result.responseEmbed.data.title).toBe('Trade Cancelled');
    });

    test('returns error embed on failure', async () => {
      // cancelTrade returns null if failed
      mockCancelTrade.mockResolvedValue(null);

      const result = await nflmonService.processTradeCancel('123', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_SENDER');
    });
  });
});
