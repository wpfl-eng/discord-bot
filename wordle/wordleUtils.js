// Wordle Utility Functions
// Grid rendering, feedback calculation, and game logic helpers

import { CONFIG, EMOJIS, FEEDBACK_TYPES, getFeedbackEmoji } from './wordleConfig.js';

/**
 * Calculate feedback for a guess against the answer
 * Handles duplicate letters correctly per Wordle rules:
 * - A letter gets CORRECT if it's in the right position
 * - A letter gets PRESENT only if there's an unmatched instance in the answer
 * - A letter gets ABSENT if it's not in the answer or all instances are accounted for
 *
 * @param {string} guess - The 5-letter guess (lowercase)
 * @param {string} answer - The 5-letter answer (lowercase)
 * @returns {string[]} Array of feedback types: 'correct', 'present', or 'absent'
 */
export function calculateFeedback(guess, answer) {
  const guessLower = guess.toLowerCase();
  const answerLower = answer.toLowerCase();

  const result = new Array(CONFIG.WORD_LENGTH).fill(FEEDBACK_TYPES.ABSENT);
  const answerLetters = answerLower.split('');
  const guessLetters = guessLower.split('');

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

/**
 * Render a single guess row with emoji feedback and letters
 * Example output: "🟩🟨⬛⬛🟩  C R A N E"
 *
 * @param {string} guess - The 5-letter guess
 * @param {string[]} feedback - Array of feedback types from calculateFeedback
 * @returns {string} Formatted row string
 */
export function renderGuessRow(guess, feedback) {
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
 *
 * @returns {string} Empty row string
 */
export function renderEmptyRow() {
  return EMOJIS.EMPTY.repeat(CONFIG.WORD_LENGTH);
}

/**
 * Render the full game board with all guesses and remaining empty slots
 *
 * @param {string[]} guesses - Array of guesses made so far
 * @param {string} answer - The answer word (for calculating feedback)
 * @returns {string} Full board as a multi-line string
 */
export function renderBoard(guesses, answer) {
  const rows = [];

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

/**
 * Check if a guess is the winning guess
 *
 * @param {string} guess - The guess to check
 * @param {string} answer - The answer word
 * @returns {boolean} True if the guess matches the answer
 */
export function isWinningGuess(guess, answer) {
  return guess.toLowerCase() === answer.toLowerCase();
}

/**
 * Get the number of remaining guesses
 *
 * @param {string[]} guesses - Array of guesses made so far
 * @returns {number} Number of guesses remaining
 */
export function getRemainingGuesses(guesses) {
  return CONFIG.MAX_GUESSES - guesses.length;
}

/**
 * Check if the game is over (won or out of guesses)
 *
 * @param {string[]} guesses - Array of guesses made so far
 * @param {string} answer - The answer word
 * @returns {{ isOver: boolean, won: boolean }} Game state
 */
export function checkGameState(guesses, answer) {
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

/**
 * Format guess count for display
 * Example: "3/6"
 *
 * @param {number} current - Current number of guesses
 * @returns {string} Formatted guess count
 */
export function formatGuessCount(current) {
  return `${current}/${CONFIG.MAX_GUESSES}`;
}

/**
 * Get a share-friendly text representation of the game
 * Used for sharing results (like real Wordle)
 *
 * @param {string[]} guesses - Array of guesses made
 * @param {string} answer - The answer word
 * @param {number} wordNumber - The word number for this puzzle
 * @param {boolean} won - Whether the player won
 * @returns {string} Shareable text
 */
export function generateShareText(guesses, answer, wordNumber, won) {
  const header = `Wordle #${wordNumber} ${won ? guesses.length : 'X'}/${CONFIG.MAX_GUESSES}`;

  const grid = guesses
    .map((guess) => {
      const feedback = calculateFeedback(guess, answer);
      return feedback.map((f) => getFeedbackEmoji(f)).join('');
    })
    .join('\n');

  return `${header}\n\n${grid}`;
}

/**
 * Get keyboard letter states based on all guesses
 * Tracks which letters have been used and their best known state
 *
 * @param {string[]} guesses - Array of guesses made
 * @param {string} answer - The answer word
 * @returns {Map<string, string>} Map of letter to feedback type
 */
export function getKeyboardState(guesses, answer) {
  const letterStates = new Map();

  // Priority: CORRECT > PRESENT > ABSENT
  const priority = {
    [FEEDBACK_TYPES.CORRECT]: 3,
    [FEEDBACK_TYPES.PRESENT]: 2,
    [FEEDBACK_TYPES.ABSENT]: 1,
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
