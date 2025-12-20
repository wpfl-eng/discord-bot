import { describe, test, expect } from '@jest/globals';
import {
  ANSWER_WORDS,
  VALID_GUESSES,
  isValidWord,
  isAnswerWord,
  getRandomWord,
  getAnswerWordCount,
  getValidWordCount,
} from '../../wordle/wordleWords.js';

describe('wordleWords', () => {
  // ============ WORD LIST TESTS ============

  describe('ANSWER_WORDS', () => {
    test('is non-empty array', () => {
      expect(Array.isArray(ANSWER_WORDS)).toBe(true);
      expect(ANSWER_WORDS.length).toBeGreaterThan(0);
    });

    test('all words are exactly 5 letters', () => {
      for (const word of ANSWER_WORDS) {
        expect(word).toHaveLength(5);
      }
    });

    test('all words are lowercase', () => {
      for (const word of ANSWER_WORDS) {
        expect(word).toBe(word.toLowerCase());
      }
    });

    test('contains no duplicates', () => {
      const uniqueWords = new Set(ANSWER_WORDS);
      expect(uniqueWords.size).toBe(ANSWER_WORDS.length);
    });

    test('all words contain only letters', () => {
      const letterRegex = /^[a-z]+$/;
      for (const word of ANSWER_WORDS) {
        expect(letterRegex.test(word)).toBe(true);
      }
    });
  });

  describe('VALID_GUESSES', () => {
    test('is non-empty array', () => {
      expect(Array.isArray(VALID_GUESSES)).toBe(true);
      expect(VALID_GUESSES.length).toBeGreaterThan(0);
    });

    test('all words are exactly 5 letters', () => {
      for (const word of VALID_GUESSES) {
        expect(word).toHaveLength(5);
      }
    });

    test('all words are lowercase', () => {
      for (const word of VALID_GUESSES) {
        expect(word).toBe(word.toLowerCase());
      }
    });
  });

  // ============ isValidWord TESTS ============

  describe('isValidWord', () => {
    test('returns true for answer words', () => {
      // Pick first few answer words to test
      const testWords = ANSWER_WORDS.slice(0, 5);
      for (const word of testWords) {
        expect(isValidWord(word)).toBe(true);
      }
    });

    test('returns true for valid guess words', () => {
      // Pick first few valid guesses to test
      const testWords = VALID_GUESSES.slice(0, 5);
      for (const word of testWords) {
        expect(isValidWord(word)).toBe(true);
      }
    });

    test('returns false for random 5-letter strings not in list', () => {
      expect(isValidWord('zzzzz')).toBe(false);
      expect(isValidWord('xxxxx')).toBe(false);
      expect(isValidWord('qqqqs')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isValidWord(null as unknown as string)).toBe(false);
      expect(isValidWord(undefined as unknown as string)).toBe(false);
    });

    test('returns false for non-strings', () => {
      expect(isValidWord(12345 as unknown as string)).toBe(false);
      expect(isValidWord({} as unknown as string)).toBe(false);
      expect(isValidWord([] as unknown as string)).toBe(false);
    });

    test('is case insensitive', () => {
      const word = ANSWER_WORDS[0];
      expect(isValidWord(word.toUpperCase())).toBe(true);
      expect(isValidWord(word.toLowerCase())).toBe(true);
      // Mixed case
      expect(isValidWord(word.charAt(0).toUpperCase() + word.slice(1))).toBe(true);
    });

    test('returns false for empty string', () => {
      expect(isValidWord('')).toBe(false);
    });

    test('returns false for wrong length words', () => {
      expect(isValidWord('cat')).toBe(false); // Too short
      expect(isValidWord('elephant')).toBe(false); // Too long
    });
  });

  // ============ isAnswerWord TESTS ============

  describe('isAnswerWord', () => {
    test('returns true for words in answer list', () => {
      const testWords = ANSWER_WORDS.slice(0, 5);
      for (const word of testWords) {
        expect(isAnswerWord(word)).toBe(true);
      }
    });

    test('returns false for guess-only words', () => {
      // Find words that are in VALID_GUESSES but not in ANSWER_WORDS
      const answerSet = new Set(ANSWER_WORDS);
      const guessOnlyWords = VALID_GUESSES.filter((w) => !answerSet.has(w));

      if (guessOnlyWords.length > 0) {
        for (const word of guessOnlyWords.slice(0, 5)) {
          expect(isAnswerWord(word)).toBe(false);
        }
      }
    });

    test('returns false for invalid words', () => {
      expect(isAnswerWord('zzzzz')).toBe(false);
      expect(isAnswerWord('xxxxx')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isAnswerWord(null as unknown as string)).toBe(false);
      expect(isAnswerWord(undefined as unknown as string)).toBe(false);
    });

    test('returns false for non-strings', () => {
      expect(isAnswerWord(12345 as unknown as string)).toBe(false);
    });

    test('is case insensitive', () => {
      const word = ANSWER_WORDS[0];
      expect(isAnswerWord(word.toUpperCase())).toBe(true);
      expect(isAnswerWord(word.toLowerCase())).toBe(true);
    });
  });

  // ============ getRandomWord TESTS ============

  describe('getRandomWord', () => {
    test('returns a valid answer word', () => {
      const word = getRandomWord();
      expect(typeof word).toBe('string');
      expect(word).toHaveLength(5);
      expect(isAnswerWord(word)).toBe(true);
    });

    test('excludes specified words', () => {
      // Exclude first 10 words
      const excludeWords = ANSWER_WORDS.slice(0, 10);
      const excludeSet = new Set(excludeWords);

      // Get 20 random words and verify none are excluded
      for (let i = 0; i < 20; i++) {
        const word = getRandomWord(excludeWords);
        expect(excludeSet.has(word)).toBe(false);
      }
    });

    test('handles empty exclude list', () => {
      const word = getRandomWord([]);
      expect(isAnswerWord(word)).toBe(true);
    });

    test('handles undefined exclude list', () => {
      const word = getRandomWord();
      expect(isAnswerWord(word)).toBe(true);
    });

    test('returns word from full list when all excluded (fallback)', () => {
      // This tests the fallback behavior when all words are excluded
      const word = getRandomWord([...ANSWER_WORDS]);
      // Should still return a valid answer word (recycled)
      expect(isAnswerWord(word)).toBe(true);
    });

    test('is case insensitive for exclusions', () => {
      const excludeWords = ANSWER_WORDS.slice(0, 5).map((w) => w.toUpperCase());
      const excludeSet = new Set(ANSWER_WORDS.slice(0, 5));

      // Get random words and verify excluded words are respected
      for (let i = 0; i < 10; i++) {
        const word = getRandomWord(excludeWords);
        expect(excludeSet.has(word)).toBe(false);
      }
    });
  });

  // ============ COUNT FUNCTIONS ============

  describe('getAnswerWordCount', () => {
    test('returns count > 0', () => {
      expect(getAnswerWordCount()).toBeGreaterThan(0);
    });

    test('matches ANSWER_WORDS array length', () => {
      expect(getAnswerWordCount()).toBe(ANSWER_WORDS.length);
    });
  });

  describe('getValidWordCount', () => {
    test('returns count >= answer count', () => {
      expect(getValidWordCount()).toBeGreaterThanOrEqual(getAnswerWordCount());
    });

    test('returns count > 0', () => {
      expect(getValidWordCount()).toBeGreaterThan(0);
    });

    test('equals answer words + valid guesses (deduplicated)', () => {
      // The valid count should be the union of both sets
      const expectedSize = new Set([...ANSWER_WORDS, ...VALID_GUESSES]).size;
      expect(getValidWordCount()).toBe(expectedSize);
    });
  });
});
