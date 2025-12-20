// Wordle Word Lists
// Loads words from text files for the Wordle game

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse a text file containing words (one per line)
 * @param {string} filename - The filename to parse
 * @returns {string[]} Array of words
 */
function loadWordsFromFile(filename) {
  try {
    const filePath = join(__dirname, filename);
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length === 5);
  } catch (error) {
    console.error(`Error loading ${filename}:`, error.message);
    return [];
  }
}

/**
 * Answer words - Common, recognizable 5-letter words that can be THE answer
 * Loaded from wordleAnswers.txt
 */
export const ANSWER_WORDS = loadWordsFromFile('wordleAnswers.txt');

/**
 * Valid guesses - Additional words that can be guessed but won't be answers
 * Loaded from wordleGuesses.txt
 */
export const VALID_GUESSES = loadWordsFromFile('wordleGuesses.txt');

// Pre-compute Sets for O(1) lookup performance
const answerSet = new Set(ANSWER_WORDS);
const validSet = new Set([...ANSWER_WORDS, ...VALID_GUESSES]);

/**
 * Check if a word is a valid guess (can be entered as a guess)
 * @param {string} word - The word to check
 * @returns {boolean} True if the word is valid
 */
export function isValidWord(word) {
  if (!word || typeof word !== 'string') {
    return false;
  }
  return validSet.has(word.toLowerCase());
}

/**
 * Check if a word can be an answer (is in the answer word list)
 * @param {string} word - The word to check
 * @returns {boolean} True if the word can be an answer
 */
export function isAnswerWord(word) {
  if (!word || typeof word !== 'string') {
    return false;
  }
  return answerSet.has(word.toLowerCase());
}

/**
 * Get a random answer word, optionally excluding certain words
 * @param {string[]} excludeWords - Array of words to exclude (already used)
 * @returns {string} A random answer word
 */
export function getRandomWord(excludeWords = []) {
  const excludeSet = new Set(excludeWords.map((w) => w.toLowerCase()));
  const available = ANSWER_WORDS.filter((w) => !excludeSet.has(w.toLowerCase()));

  if (available.length === 0) {
    // Fallback: if all words exhausted, pick from full list (unlikely but safe)
    console.warn('All answer words have been used, recycling...');
    return ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)];
  }

  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Get the total count of answer words available
 * @returns {number} Number of possible answer words
 */
export function getAnswerWordCount() {
  return ANSWER_WORDS.length;
}

/**
 * Get the total count of valid guess words
 * @returns {number} Number of valid guess words (including answers)
 */
export function getValidWordCount() {
  return validSet.size;
}
