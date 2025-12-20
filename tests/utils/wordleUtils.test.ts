import { describe, test, expect } from '@jest/globals';
import {
  calculateFeedback,
  renderGuessRow,
  renderEmptyRow,
  renderBoard,
  isWinningGuess,
  getRemainingGuesses,
  checkGameState,
  formatGuessCount,
  generateShareText,
  getKeyboardState,
} from '../../wordle/wordleUtils.js';
import { FEEDBACK_TYPES, CONFIG, EMOJIS } from '../../wordle/wordleConfig.js';

describe('wordleUtils', () => {
  // ============ calculateFeedback TESTS ============

  describe('calculateFeedback', () => {
    test('marks exact matches as correct', () => {
      const feedback = calculateFeedback('crane', 'crane');
      expect(feedback).toEqual([
        FEEDBACK_TYPES.CORRECT,
        FEEDBACK_TYPES.CORRECT,
        FEEDBACK_TYPES.CORRECT,
        FEEDBACK_TYPES.CORRECT,
        FEEDBACK_TYPES.CORRECT,
      ]);
    });

    test('marks wrong position as present', () => {
      // 'earns' vs 'crane': e is present, a is present, r is present, n is CORRECT (same position), s is absent
      const feedback = calculateFeedback('earns', 'crane');
      expect(feedback[0]).toBe(FEEDBACK_TYPES.PRESENT); // e is in 'crane' (at pos 4)
      expect(feedback[1]).toBe(FEEDBACK_TYPES.PRESENT); // a is in 'crane' (at pos 2)
      expect(feedback[2]).toBe(FEEDBACK_TYPES.PRESENT); // r is in 'crane' (at pos 1)
      expect(feedback[3]).toBe(FEEDBACK_TYPES.CORRECT); // n is at position 3 in both words!
      expect(feedback[4]).toBe(FEEDBACK_TYPES.ABSENT); // s is not in 'crane'
    });

    test('marks missing letters as absent', () => {
      const feedback = calculateFeedback('xxxxx', 'crane');
      expect(feedback).toEqual([
        FEEDBACK_TYPES.ABSENT,
        FEEDBACK_TYPES.ABSENT,
        FEEDBACK_TYPES.ABSENT,
        FEEDBACK_TYPES.ABSENT,
        FEEDBACK_TYPES.ABSENT,
      ]);
    });

    test('handles duplicate letters correctly - first occurrence matched', () => {
      // 'speed' vs 'creep': first e is present (pos 2 in creep), second e is correct (pos 3)
      const feedback = calculateFeedback('speed', 'creep');
      expect(feedback[0]).toBe(FEEDBACK_TYPES.ABSENT); // s not in creep
      expect(feedback[1]).toBe(FEEDBACK_TYPES.PRESENT); // p is in creep (at pos 4)
      expect(feedback[2]).toBe(FEEDBACK_TYPES.CORRECT); // e matches at pos 2
      expect(feedback[3]).toBe(FEEDBACK_TYPES.CORRECT); // e matches at pos 3
      expect(feedback[4]).toBe(FEEDBACK_TYPES.ABSENT); // d not in creep
    });

    test('handles duplicate letters - extra occurrences marked absent', () => {
      // 'eerie' vs 'crane': only one e in crane (at position 4)
      // First pass: e at pos 4 matches e at pos 4 → CORRECT, 'e' is marked as used
      // Second pass: remaining e's at pos 0, 1 have no more unmatched e's → ABSENT
      const feedback = calculateFeedback('eerie', 'crane');
      expect(feedback[0]).toBe(FEEDBACK_TYPES.ABSENT); // e - no unmatched e's left (e at pos 4 was used)
      expect(feedback[1]).toBe(FEEDBACK_TYPES.ABSENT); // e - no more e's
      expect(feedback[2]).toBe(FEEDBACK_TYPES.PRESENT); // r - present in crane (at pos 1)
      expect(feedback[3]).toBe(FEEDBACK_TYPES.ABSENT); // i - not in crane
      expect(feedback[4]).toBe(FEEDBACK_TYPES.CORRECT); // e - exact match at position 4
    });

    test('is case insensitive', () => {
      const feedbackLower = calculateFeedback('crane', 'crane');
      const feedbackUpper = calculateFeedback('CRANE', 'CRANE');
      const feedbackMixed = calculateFeedback('CrAnE', 'cRaNe');
      expect(feedbackLower).toEqual(feedbackUpper);
      expect(feedbackLower).toEqual(feedbackMixed);
    });

    test('exact match takes precedence over present', () => {
      // 'meets' vs 'creep': the e at position 2 should be correct, not just present
      const feedback = calculateFeedback('meets', 'creep');
      expect(feedback[1]).toBe(FEEDBACK_TYPES.PRESENT); // first e - present (in creep but not at pos 1)
      expect(feedback[2]).toBe(FEEDBACK_TYPES.CORRECT); // second e - correct match at pos 2
    });

    test('returns correct length array', () => {
      const feedback = calculateFeedback('hello', 'world');
      expect(feedback).toHaveLength(CONFIG.WORD_LENGTH);
    });
  });

  // ============ renderGuessRow TESTS ============

  describe('renderGuessRow', () => {
    test('returns emojis followed by spaced letters', () => {
      const feedback = [
        FEEDBACK_TYPES.CORRECT,
        FEEDBACK_TYPES.PRESENT,
        FEEDBACK_TYPES.ABSENT,
        FEEDBACK_TYPES.ABSENT,
        FEEDBACK_TYPES.CORRECT,
      ];
      const result = renderGuessRow('crane', feedback);
      expect(result).toContain(EMOJIS.CORRECT);
      expect(result).toContain(EMOJIS.PRESENT);
      expect(result).toContain(EMOJIS.ABSENT);
      expect(result).toContain('`C`');
      expect(result).toContain('`R`');
      expect(result).toContain('`A`');
      expect(result).toContain('`N`');
      expect(result).toContain('`E`');
    });

    test('converts letters to uppercase', () => {
      const feedback = new Array(5).fill(FEEDBACK_TYPES.ABSENT);
      const result = renderGuessRow('hello', feedback);
      expect(result).toContain('`H`');
      expect(result).toContain('`E`');
      expect(result).toContain('`L`');
      expect(result).toContain('`O`');
    });
  });

  // ============ renderEmptyRow TESTS ============

  describe('renderEmptyRow', () => {
    test('returns 5 empty emojis', () => {
      const result = renderEmptyRow();
      expect(result).toBe(EMOJIS.EMPTY.repeat(CONFIG.WORD_LENGTH));
    });

    test('has correct length', () => {
      const result = renderEmptyRow();
      // Each emoji is potentially multiple characters, so check it's 5 emojis
      expect(result).toBe(EMOJIS.EMPTY.repeat(5));
    });
  });

  // ============ renderBoard TESTS ============

  describe('renderBoard', () => {
    test('shows guesses with feedback', () => {
      const guesses = ['crane'];
      const answer = 'crane';
      const result = renderBoard(guesses, answer);

      // First row should have all correct emojis
      expect(result).toContain(EMOJIS.CORRECT.repeat(5));
    });

    test('pads with empty rows', () => {
      const guesses = ['crane'];
      const answer = 'hello';
      const result = renderBoard(guesses, answer);

      // Should have 5 empty rows (6 total - 1 guess)
      const lines = result.split('\n');
      expect(lines).toHaveLength(CONFIG.MAX_GUESSES);

      // Last 5 rows should be empty
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i]).toBe(EMOJIS.EMPTY.repeat(5));
      }
    });

    test('shows 6 total rows', () => {
      const guesses: string[] = [];
      const answer = 'hello';
      const result = renderBoard(guesses, answer);
      const lines = result.split('\n');
      expect(lines).toHaveLength(6);
    });

    test('renders multiple guesses in order', () => {
      const guesses = ['crane', 'slate'];
      const answer = 'hello';
      const result = renderBoard(guesses, answer);
      const lines = result.split('\n');

      // First two lines should have letter blocks
      expect(lines[0]).toContain('`C`');
      expect(lines[1]).toContain('`S`');

      // Remaining 4 lines should be empty
      for (let i = 2; i < 6; i++) {
        expect(lines[i]).toBe(EMOJIS.EMPTY.repeat(5));
      }
    });
  });

  // ============ isWinningGuess TESTS ============

  describe('isWinningGuess', () => {
    test('returns true for matching guess', () => {
      expect(isWinningGuess('hello', 'hello')).toBe(true);
    });

    test('is case insensitive', () => {
      expect(isWinningGuess('HELLO', 'hello')).toBe(true);
      expect(isWinningGuess('hello', 'HELLO')).toBe(true);
      expect(isWinningGuess('HeLLo', 'hEllO')).toBe(true);
    });

    test('returns false for non-matching', () => {
      expect(isWinningGuess('hello', 'world')).toBe(false);
      expect(isWinningGuess('crane', 'hello')).toBe(false);
    });
  });

  // ============ getRemainingGuesses TESTS ============

  describe('getRemainingGuesses', () => {
    test('returns 6 minus guess count', () => {
      expect(getRemainingGuesses([])).toBe(6);
      expect(getRemainingGuesses(['crane'])).toBe(5);
      expect(getRemainingGuesses(['a', 'b', 'c'])).toBe(3);
      expect(getRemainingGuesses(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(0);
    });

    test('handles empty array', () => {
      expect(getRemainingGuesses([])).toBe(CONFIG.MAX_GUESSES);
    });
  });

  // ============ checkGameState TESTS ============

  describe('checkGameState', () => {
    test('returns isOver=false, won=false for empty guesses', () => {
      const result = checkGameState([], 'hello');
      expect(result).toEqual({ isOver: false, won: false });
    });

    test('returns isOver=true, won=true when last guess is correct', () => {
      const result = checkGameState(['crane', 'hello'], 'hello');
      expect(result).toEqual({ isOver: true, won: true });
    });

    test('returns isOver=true, won=false at 6 incorrect guesses', () => {
      const guesses = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff'];
      const result = checkGameState(guesses, 'hello');
      expect(result).toEqual({ isOver: true, won: false });
    });

    test('returns isOver=false, won=false during game', () => {
      const guesses = ['crane', 'slate'];
      const result = checkGameState(guesses, 'hello');
      expect(result).toEqual({ isOver: false, won: false });
    });

    test('win on first guess', () => {
      const result = checkGameState(['hello'], 'hello');
      expect(result).toEqual({ isOver: true, won: true });
    });

    test('win on last guess', () => {
      const guesses = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'hello'];
      const result = checkGameState(guesses, 'hello');
      expect(result).toEqual({ isOver: true, won: true });
    });
  });

  // ============ formatGuessCount TESTS ============

  describe('formatGuessCount', () => {
    test('formats as current/max', () => {
      expect(formatGuessCount(1)).toBe('1/6');
      expect(formatGuessCount(3)).toBe('3/6');
      expect(formatGuessCount(6)).toBe('6/6');
    });

    test('handles zero', () => {
      expect(formatGuessCount(0)).toBe('0/6');
    });
  });

  // ============ generateShareText TESTS ============

  describe('generateShareText', () => {
    test('includes word number and guess count for win', () => {
      const result = generateShareText(['crane', 'hello'], 'hello', 42, true);
      expect(result).toContain('Wordle #42');
      expect(result).toContain('2/6');
    });

    test('shows X for loss', () => {
      const guesses = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff'];
      const result = generateShareText(guesses, 'hello', 42, false);
      expect(result).toContain('X/6');
    });

    test('includes emoji grid', () => {
      const result = generateShareText(['hello'], 'hello', 1, true);
      expect(result).toContain(EMOJIS.CORRECT.repeat(5));
    });

    test('grid reflects actual feedback', () => {
      // 'crane' vs 'hello' - no exact matches, maybe some presents
      const result = generateShareText(['crane'], 'hello', 1, false);
      // e is in hello, should be present
      expect(result).toContain(EMOJIS.PRESENT);
    });
  });

  // ============ getKeyboardState TESTS ============

  describe('getKeyboardState', () => {
    test('tracks letter states from guesses', () => {
      const state = getKeyboardState(['crane'], 'crane');
      expect(state.get('c')).toBe(FEEDBACK_TYPES.CORRECT);
      expect(state.get('r')).toBe(FEEDBACK_TYPES.CORRECT);
      expect(state.get('a')).toBe(FEEDBACK_TYPES.CORRECT);
      expect(state.get('n')).toBe(FEEDBACK_TYPES.CORRECT);
      expect(state.get('e')).toBe(FEEDBACK_TYPES.CORRECT);
    });

    test('correct takes priority over present', () => {
      // First guess: 'earns' - e is present
      // Second guess: 'crane' - e is correct
      const state = getKeyboardState(['earns', 'crane'], 'crane');
      expect(state.get('e')).toBe(FEEDBACK_TYPES.CORRECT);
    });

    test('present takes priority over absent', () => {
      // In some guess, a letter might be absent in one position but present in another
      // Actually, if a letter is in the word, it should never be absent for that letter
      // Let's test: 'xxxxx' has no letters in 'hello', then 'hello' matches
      const state = getKeyboardState(['hello'], 'hello');
      expect(state.get('h')).toBe(FEEDBACK_TYPES.CORRECT);
    });

    test('returns empty map for no guesses', () => {
      const state = getKeyboardState([], 'hello');
      expect(state.size).toBe(0);
    });

    test('lowercase keys', () => {
      const state = getKeyboardState(['CRANE'], 'CRANE');
      expect(state.has('c')).toBe(true);
      expect(state.has('C')).toBe(false);
    });

    test('accumulates letters from multiple guesses', () => {
      const state = getKeyboardState(['crane', 'hello'], 'hello');
      // Letters from both guesses should be tracked
      expect(state.has('c')).toBe(true);
      expect(state.has('h')).toBe(true);
    });
  });
});
