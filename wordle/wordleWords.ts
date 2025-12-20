// Wordle Word Lists
// Loads words from text files for the Wordle game

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============ PRIVATE FUNCTIONS ============

/**
 * Parse a text file containing words (one per line)
 * @param filename - The filename to parse (relative to this module)
 * @returns Array of 5-letter words (lowercase)
 */
function loadWordsFromFile(filename: string): string[] {
  try {
    const filePath = join(__dirname, filename);
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length === 5);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error loading ${filename}:`, errorMessage);
    return [];
  }
}

// ============ WORD LISTS ============

/**
 * Answer words - Common, recognizable 5-letter words that can be THE answer
 * Loaded from wordleAnswers.txt
 */
export const ANSWER_WORDS: readonly string[] = loadWordsFromFile('wordleAnswers.txt');

/**
 * Valid guesses - Additional words that can be guessed but won't be answers
 * Loaded from wordleGuesses.txt
 */
export const VALID_GUESSES: readonly string[] = loadWordsFromFile('wordleGuesses.txt');

// Pre-compute Sets for O(1) lookup performance
const answerSet: ReadonlySet<string> = new Set(ANSWER_WORDS);
const validSet: ReadonlySet<string> = new Set([...ANSWER_WORDS, ...VALID_GUESSES]);

// ============ VALIDATION FUNCTIONS ============

/**
 * Check if a word is a valid guess (can be entered as a guess)
 * @param word - The word to check
 * @returns True if the word is valid
 */
export function isValidWord(word: string | null | undefined): boolean {
  if (!word || typeof word !== 'string') {
    return false;
  }
  return validSet.has(word.toLowerCase());
}

/**
 * Check if a word can be an answer (is in the answer word list)
 * @param word - The word to check
 * @returns True if the word can be an answer
 */
export function isAnswerWord(word: string | null | undefined): boolean {
  if (!word || typeof word !== 'string') {
    return false;
  }
  return answerSet.has(word.toLowerCase());
}

// ============ WORD SELECTION ============

/**
 * Get a random answer word, optionally excluding certain words
 * @param excludeWords - Array of words to exclude (already used)
 * @returns A random answer word
 */
export function getRandomWord(excludeWords: string[] = []): string {
  const excludeSet = new Set(excludeWords.map((w) => w.toLowerCase()));
  const available = ANSWER_WORDS.filter((w) => !excludeSet.has(w.toLowerCase()));

  if (available.length === 0) {
    // Fallback: if all words exhausted, pick from full list (unlikely but safe)
    console.warn('All answer words have been used, recycling...');
    return ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)];
  }

  return available[Math.floor(Math.random() * available.length)];
}

// ============ COUNT FUNCTIONS ============

/**
 * Get the total count of answer words available
 * @returns Number of possible answer words
 */
export function getAnswerWordCount(): number {
  return ANSWER_WORDS.length;
}

/**
 * Get the total count of valid guess words
 * @returns Number of valid guess words (including answers)
 */
export function getValidWordCount(): number {
  return validSet.size;
}
