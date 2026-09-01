import { describe, test, expect } from '@jest/globals';
import {
  CONFIG,
  REWARDS,
  COLORS,
  EMOJIS,
  FEEDBACK_TYPES,
  getFeedbackEmoji,
  calculateReward,
} from '../../wordle/wordleConfig.js';

describe('wordleConfig', () => {
  // ============ CONFIG TESTS ============

  describe('CONFIG', () => {
    test('has MAX_GUESSES of 6', () => {
      expect(CONFIG.MAX_GUESSES).toBe(6);
    });

    test('has WORD_LENGTH of 5', () => {
      expect(CONFIG.WORD_LENGTH).toBe(5);
    });

    test('has ROTATION_HOURS of 1', () => {
      expect(CONFIG.ROTATION_HOURS).toBe(1);
    });
  });

  // ============ REWARDS TESTS ============

  describe('REWARDS', () => {
    test('has BASE_WIN of 2500', () => {
      expect(REWARDS.BASE_WIN).toBe(2500);
    });

    test('has FIRST_SOLVER_BONUS of 0 (first solver is rewarded with an item)', () => {
      expect(REWARDS.FIRST_SOLVER_BONUS).toBe(0);
    });

    test('has FIRST_SOLVER_ITEM', () => {
      expect(REWARDS.FIRST_SOLVER_ITEM).toBe('wordle_lucky_letter');
    });
  });

  // ============ COLORS TESTS ============

  describe('COLORS', () => {
    test('has all game state colors', () => {
      expect(COLORS.PLAYING).toBeDefined();
      expect(COLORS.WON).toBeDefined();
      expect(COLORS.LOST).toBeDefined();
      expect(COLORS.INFO).toBeDefined();
      expect(COLORS.FIRST_SOLVE).toBeDefined();
    });

    test('all colors are numbers (hex values)', () => {
      Object.values(COLORS).forEach((color) => {
        expect(typeof color).toBe('number');
      });
    });
  });

  // ============ EMOJIS TESTS ============

  describe('EMOJIS', () => {
    test('has all feedback emojis', () => {
      expect(EMOJIS.CORRECT).toBe('🟩');
      expect(EMOJIS.PRESENT).toBe('🟨');
      expect(EMOJIS.ABSENT).toBe('⬛');
      expect(EMOJIS.EMPTY).toBe('⬜');
    });
  });

  // ============ FEEDBACK_TYPES TESTS ============

  describe('FEEDBACK_TYPES', () => {
    test('has all feedback types', () => {
      expect(FEEDBACK_TYPES.CORRECT).toBe('correct');
      expect(FEEDBACK_TYPES.PRESENT).toBe('present');
      expect(FEEDBACK_TYPES.ABSENT).toBe('absent');
    });
  });

  // ============ FUNCTION TESTS ============

  describe('getFeedbackEmoji', () => {
    test('returns correct emoji for "correct"', () => {
      expect(getFeedbackEmoji('correct')).toBe('🟩');
    });

    test('returns present emoji for "present"', () => {
      expect(getFeedbackEmoji('present')).toBe('🟨');
    });

    test('returns absent emoji for "absent"', () => {
      expect(getFeedbackEmoji('absent')).toBe('⬛');
    });

    test('returns empty emoji for unknown feedback type', () => {
      expect(getFeedbackEmoji('invalid')).toBe('⬜');
    });

    test('returns empty emoji for null/undefined', () => {
      expect(getFeedbackEmoji(null as unknown as string)).toBe('⬜');
      expect(getFeedbackEmoji(undefined as unknown as string)).toBe('⬜');
    });
  });

  describe('calculateReward', () => {
    test('returns base reward for non-first solver', () => {
      expect(calculateReward(false)).toBe(REWARDS.BASE_WIN);
    });

    test('adds the first-solver bonus on top of the base reward', () => {
      expect(calculateReward(true) - calculateReward(false)).toBe(REWARDS.FIRST_SOLVER_BONUS);
    });

    test('total reward matches REWARDS config', () => {
      expect(calculateReward(false)).toBe(REWARDS.BASE_WIN);
      expect(calculateReward(true)).toBe(REWARDS.BASE_WIN + REWARDS.FIRST_SOLVER_BONUS);
    });
  });
});
