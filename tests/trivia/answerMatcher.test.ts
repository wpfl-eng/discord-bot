import { describe, test, expect } from '@jest/globals';
import { checkAnswer, TriviaQuestion } from '../../trivia/answerMatcher.js';

describe('answerMatcher', () => {
  describe('checkAnswer', () => {
    const question: TriviaQuestion = {
      answer: 'Tom Brady',
      acceptable_answers: ['Brady', 'T. Brady'],
    };

    describe('exact matching', () => {
      test('matches exact answer (case insensitive)', () => {
        expect(checkAnswer('Tom Brady', question)).toBe(true);
        expect(checkAnswer('TOM BRADY', question)).toBe(true);
        expect(checkAnswer('tom brady', question)).toBe(true);
      });

      test('matches with extra whitespace', () => {
        expect(checkAnswer('  Tom Brady  ', question)).toBe(true);
        expect(checkAnswer('Tom Brady ', question)).toBe(true);
      });
    });

    describe('acceptable answers', () => {
      test('matches acceptable answers', () => {
        expect(checkAnswer('Brady', question)).toBe(true);
        expect(checkAnswer('T. Brady', question)).toBe(true);
      });

      test('matches acceptable answers case insensitive', () => {
        expect(checkAnswer('BRADY', question)).toBe(true);
        expect(checkAnswer('t. brady', question)).toBe(true);
      });
    });

    describe('substring matching', () => {
      test('matches when answer contains acceptable (substring)', () => {
        expect(checkAnswer('Tom Brady is the GOAT', question)).toBe(true);
        expect(checkAnswer('I think Brady wins', question)).toBe(true);
      });

      test('does NOT match when acceptable contains answer (prevents single letter matches)', () => {
        // This tests that "Tom" doesn't match just because "Tom Brady" contains "Tom"
        // The matching should require the user answer to contain the full acceptable answer
        const shortQuestion: TriviaQuestion = { answer: 'A' };
        expect(checkAnswer('ABC', shortQuestion)).toBe(true); // Contains A
        expect(checkAnswer('XYZ', shortQuestion)).toBe(false); // Doesn't contain A
      });
    });

    describe('wrong answers', () => {
      test('returns false for wrong answers', () => {
        expect(checkAnswer('Peyton Manning', question)).toBe(false);
        expect(checkAnswer('Aaron Rodgers', question)).toBe(false);
      });

      test('returns false for partial names not in acceptable', () => {
        expect(checkAnswer('Tom', question)).toBe(false);
      });
    });

    describe('null/undefined input handling (bug fix)', () => {
      test('handles null user answer gracefully', () => {
        expect(checkAnswer(null, question)).toBe(false);
      });

      test('handles undefined user answer gracefully', () => {
        expect(checkAnswer(undefined, question)).toBe(false);
      });

      test('handles empty string', () => {
        expect(checkAnswer('', question)).toBe(false);
      });

      test('handles whitespace-only string', () => {
        expect(checkAnswer('   ', question)).toBe(false);
      });
    });

    describe('null/undefined question handling', () => {
      test('handles null question', () => {
        expect(checkAnswer('test', null)).toBe(false);
      });

      test('handles undefined question', () => {
        expect(checkAnswer('test', undefined)).toBe(false);
      });

      test('handles question with missing answer', () => {
        expect(checkAnswer('test', {} as TriviaQuestion)).toBe(false);
      });

      test('handles question with empty answer', () => {
        expect(checkAnswer('test', { answer: '' })).toBe(false);
      });
    });

    describe('edge cases', () => {
      test('handles empty acceptable_answers array', () => {
        const q: TriviaQuestion = { answer: 'Test' };
        expect(checkAnswer('Test', q)).toBe(true);
        expect(checkAnswer('Wrong', q)).toBe(false);
      });

      test('handles question with only acceptable_answers', () => {
        const q: TriviaQuestion = {
          answer: 'Main Answer',
          acceptable_answers: ['Alt1', 'Alt2'],
        };
        expect(checkAnswer('Main Answer', q)).toBe(true);
        expect(checkAnswer('Alt1', q)).toBe(true);
        expect(checkAnswer('Alt2', q)).toBe(true);
      });

      test('handles special characters in answer', () => {
        const q: TriviaQuestion = { answer: "Ja'Marr Chase" };
        expect(checkAnswer("Ja'Marr Chase", q)).toBe(true);
        expect(checkAnswer("ja'marr chase", q)).toBe(true);
      });

      test('handles numbers in answer', () => {
        const q: TriviaQuestion = { answer: '2020' };
        expect(checkAnswer('2020', q)).toBe(true);
        expect(checkAnswer('The year was 2020', q)).toBe(true);
      });
    });
  });
});
