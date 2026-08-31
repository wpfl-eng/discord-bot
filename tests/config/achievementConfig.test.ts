import { describe, test, expect } from '@jest/globals';
import {
  ACHIEVEMENTS,
  ACTION_TYPES,
  getAchievement,
  getAllAchievementKeys,
} from '../../achievements/achievementConfig.js';

describe('achievementConfig', () => {
  // ============ ACHIEVEMENTS TESTS ============

  describe('ACHIEVEMENTS', () => {
    test('has all defined achievements', () => {
      expect(ACHIEVEMENTS.WORDLE_FIRST_SOLVE).toBeDefined();
      expect(ACHIEVEMENTS.WORDLE_5_SOLVES).toBeDefined();
      expect(ACHIEVEMENTS.WORDLE_10_SOLVES).toBeDefined();
    });

    test('each achievement has required properties', () => {
      Object.values(ACHIEVEMENTS).forEach((achievement) => {
        expect(typeof achievement.name).toBe('string');
        expect(typeof achievement.description).toBe('string');
        expect(typeof achievement.rewardValue).toBe('number');
        expect(achievement.name.length).toBeGreaterThan(0);
        expect(achievement.description.length).toBeGreaterThan(0);
        expect(achievement.rewardValue).toBeGreaterThan(0);
      });
    });

    test('WORDLE_FIRST_SOLVE has correct data', () => {
      expect(ACHIEVEMENTS.WORDLE_FIRST_SOLVE.name).toBe('Word Wizard');
      expect(ACHIEVEMENTS.WORDLE_FIRST_SOLVE.rewardValue).toBe(500);
    });
  });

  // ============ ACTION_TYPES TESTS ============

  describe('ACTION_TYPES', () => {
    test('has GAMBLE actions', () => {
      expect(ACTION_TYPES.GAMBLE_WIN).toBe('GAMBLE_WIN');
      expect(ACTION_TYPES.GAMBLE_LOSE).toBe('GAMBLE_LOSE');
    });

    test('has BLACKJACK actions', () => {
      expect(ACTION_TYPES.BLACKJACK_WIN).toBe('BLACKJACK_WIN');
      expect(ACTION_TYPES.BLACKJACK_LOSE).toBe('BLACKJACK_LOSE');
    });

    test('has SLOTS actions', () => {
      expect(ACTION_TYPES.SLOTS_WIN).toBe('SLOTS_WIN');
      expect(ACTION_TYPES.SLOTS_LOSE).toBe('SLOTS_LOSE');
    });

    test('has STOCK actions', () => {
      expect(ACTION_TYPES.STOCK_BUY).toBe('STOCK_BUY');
      expect(ACTION_TYPES.STOCK_SELL).toBe('STOCK_SELL');
    });

    test('has REDZONE actions', () => {
      expect(ACTION_TYPES.REDZONE_WIN).toBe('REDZONE_WIN');
      expect(ACTION_TYPES.REDZONE_LOSE).toBe('REDZONE_LOSE');
    });

    test('has WORDLE actions', () => {
      expect(ACTION_TYPES.WORDLE_SOLVE).toBe('WORDLE_SOLVE');
      expect(ACTION_TYPES.WORDLE_FIRST_SOLVE).toBe('WORDLE_FIRST_SOLVE');
    });
  });

  // ============ FUNCTION TESTS ============

  describe('getAchievement', () => {
    test('returns achievement for valid key', () => {
      const achievement = getAchievement('WORDLE_FIRST_SOLVE');
      expect(achievement).not.toBeNull();
      expect(achievement?.name).toBe('Word Wizard');
    });

    test('returns all achievements correctly', () => {
      expect(getAchievement('WORDLE_FIRST_SOLVE')?.name).toBe('Word Wizard');
      expect(getAchievement('WORDLE_5_SOLVES')?.name).toBe('Vocabulary Builder');
      expect(getAchievement('WORDLE_10_SOLVES')?.name).toBe('Lexicon Master');
    });

    test('returns null for unknown key', () => {
      expect(getAchievement('INVALID_KEY')).toBeNull();
      expect(getAchievement('wordle_first_solve')).toBeNull(); // Case sensitive
    });

    test('returns null for null/undefined', () => {
      expect(getAchievement(null as unknown as string)).toBeNull();
      expect(getAchievement(undefined as unknown as string)).toBeNull();
    });
  });

  describe('getAllAchievementKeys', () => {
    test('returns array of all achievement keys', () => {
      const keys = getAllAchievementKeys();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBe(8);
    });

    test('includes all achievement keys', () => {
      const keys = getAllAchievementKeys();
      expect(keys).toContain('WORDLE_FIRST_SOLVE');
      expect(keys).toContain('WORDLE_5_SOLVES');
      expect(keys).toContain('WORDLE_10_SOLVES');
    });
  });
});
