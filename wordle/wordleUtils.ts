// Wordle Utility Functions
// Grid rendering, feedback calculation, and game logic helpers

import { CONFIG, EMOJIS, FEEDBACK_TYPES, FeedbackType, getFeedbackEmoji } from './wordleConfig.js';

// ============ TYPE DEFINITIONS ============

export type FeedbackArray = FeedbackType[];

export interface GameState {
  readonly isOver: boolean;
  readonly won: boolean;
}

// ============ FEEDBACK CALCULATION ============

/**
 * Calculate feedback for a guess against the answer
 * Handles duplicate letters correctly per Wordle rules:
 * - A letter gets CORRECT if it's in the right position
 * - A letter gets PRESENT only if there's an unmatched instance in the answer
 * - A letter gets ABSENT if it's not in the answer or all instances are accounted for
 *
 * @param guess - The 5-letter guess
 * @param answer - The 5-letter answer
 * @returns Array of feedback types: 'correct', 'present', or 'absent'
 */
export function calculateFeedback(guess: string, answer: string): FeedbackArray {
  const guessLower = guess.toLowerCase();
  const answerLower = answer.toLowerCase();

  const result: FeedbackArray = new Array(CONFIG.WORD_LENGTH).fill(FEEDBACK_TYPES.ABSENT);
  const answerLetters: (string | null)[] = answerLower.split('');
  const guessLetters: string[] = guessLower.split('');

  // First pass: mark exact matches (CORRECT)
  // Remove matched letters from consideration for PRESENT matching
  for (let i = 0; i < CONFIG.WORD_LENGTH; i++) {
    if (guessLetters[i] === answerLetters[i]) {
      result[i] = FEEDBACK_TYPES.CORRECT;
      answerLetters[i] = null; // Mark as used
    }
  }

  // Second pass: mark letters present but in wrong position
  // Only mark PRESENT if there's an unmatched instance in the answer
  for (let i = 0; i < CONFIG.WORD_LENGTH; i++) {
    if (result[i] === FEEDBACK_TYPES.CORRECT) {
      continue; // Already matched
    }

    const letterIndex = answerLetters.indexOf(guessLetters[i]);
    if (letterIndex !== -1) {
      result[i] = FEEDBACK_TYPES.PRESENT;
      answerLetters[letterIndex] = null; // Mark as used
    }
  }

  return result;
}

// ============ RENDERING FUNCTIONS ============

/**
 * Render a single guess row with emoji feedback and letters
 * Example output: "🟩🟨⬛⬛🟩  C R A N E"
 *
 * @param guess - The 5-letter guess
 * @param feedback - Array of feedback types from calculateFeedback
 * @returns Formatted row string
 */
export function renderGuessRow(guess: string, feedback: FeedbackArray): string {
  const emojis = feedback.map((f) => getFeedbackEmoji(f)).join('');
  const letters = guess
    .toUpperCase()
    .split('')
    .map((l) => `\`${l}\``)
    .join(' ');

  return `${emojis}  ${letters}`;
}

/**
 * Render an empty row (unused guess slot)
 * Example output: "⬜⬜⬜⬜⬜"
 */
export function renderEmptyRow(): string {
  return EMOJIS.EMPTY.repeat(CONFIG.WORD_LENGTH);
}

/**
 * Render the full game board with all guesses and remaining empty slots
 *
 * @param guesses - Array of guesses made so far
 * @param answer - The answer word (for calculating feedback)
 * @returns Full board as a multi-line string
 */
export function renderBoard(guesses: string[], answer: string): string {
  const rows: string[] = [];

  for (let i = 0; i < CONFIG.MAX_GUESSES; i++) {
    if (i < guesses.length) {
      const feedback = calculateFeedback(guesses[i], answer);
      rows.push(renderGuessRow(guesses[i], feedback));
    } else {
      rows.push(renderEmptyRow());
    }
  }

  return rows.join('\n');
}

// ============ GAME STATE FUNCTIONS ============

/**
 * Check if a guess is the winning guess
 */
export function isWinningGuess(guess: string, answer: string): boolean {
  return guess.toLowerCase() === answer.toLowerCase();
}

/**
 * Get the number of remaining guesses
 */
export function getRemainingGuesses(guesses: string[]): number {
  return CONFIG.MAX_GUESSES - guesses.length;
}

/**
 * Check if the game is over (won or out of guesses)
 *
 * @param guesses - Array of guesses made so far
 * @param answer - The answer word
 * @returns Game state object
 */
export function checkGameState(guesses: string[], answer: string): GameState {
  if (guesses.length === 0) {
    return { isOver: false, won: false };
  }

  const lastGuess = guesses[guesses.length - 1];
  const won = isWinningGuess(lastGuess, answer);

  if (won) {
    return { isOver: true, won: true };
  }

  if (guesses.length >= CONFIG.MAX_GUESSES) {
    return { isOver: true, won: false };
  }

  return { isOver: false, won: false };
}

// ============ DISPLAY FORMATTING ============

/**
 * Format guess count for display
 * Example: "3/6"
 */
export function formatGuessCount(current: number): string {
  return `${current}/${CONFIG.MAX_GUESSES}`;
}

/**
 * Get a share-friendly text representation of the game
 * Used for sharing results (like real Wordle)
 *
 * @param guesses - Array of guesses made
 * @param answer - The answer word
 * @param wordNumber - The word number for this puzzle
 * @param won - Whether the player won
 * @returns Shareable text
 */
export function generateShareText(
  guesses: string[],
  answer: string,
  wordNumber: number,
  won: boolean
): string {
  const header = `Wordle #${wordNumber} ${won ? guesses.length : 'X'}/${CONFIG.MAX_GUESSES}`;

  const grid = guesses
    .map((guess) => {
      const feedback = calculateFeedback(guess, answer);
      return feedback.map((f) => getFeedbackEmoji(f)).join('');
    })
    .join('\n');

  return `${header}\n\n${grid}`;
}

// ============ KEYBOARD STATE ============

/**
 * Get keyboard letter states based on all guesses
 * Tracks which letters have been used and their best known state
 *
 * @param guesses - Array of guesses made
 * @param answer - The answer word
 * @returns Map of letter to feedback type
 */
export function getKeyboardState(guesses: string[], answer: string): Map<string, FeedbackType> {
  const letterStates = new Map<string, FeedbackType>();

  // Priority: CORRECT > PRESENT > ABSENT
  const priority: Record<FeedbackType, number> = {
    correct: 3,
    present: 2,
    absent: 1,
  };

  for (const guess of guesses) {
    const feedback = calculateFeedback(guess, answer);
    const letters = guess.toLowerCase().split('');

    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      const state = feedback[i];
      const currentState = letterStates.get(letter);

      // Only update if new state has higher priority
      if (!currentState || priority[state] > priority[currentState]) {
        letterStates.set(letter, state);
      }
    }
  }

  return letterStates;
}
