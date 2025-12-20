// Wordle Database Operations
// All database interactions for the Wordle game

import { sql } from '@vercel/postgres';
import { getRandomWord } from './wordleWords.js';
import { CONFIG } from './wordleConfig.js';

// ============ Word Management ============

/**
 * Get the current active word
 * @returns {Promise<object|null>} Current word record or null
 */
export async function getCurrentWord() {
  const result = await sql`
    SELECT * FROM wordle_words
    ORDER BY id DESC
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Initialize the first word (used when no word exists)
 * @returns {Promise<object>} Newly created word record
 */
export async function initializeWord() {
  const word = getRandomWord([]);

  const result = await sql`
    INSERT INTO wordle_words (current_word, word_number, set_at)
    VALUES (${word}, 1, NOW())
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Check if word rotation is needed and rotate if conditions are met
 * Conditions: time >= ROTATION_HOURS AND someone has attempted (win or loss)
 * Does NOT rotate if no one has touched the word
 * @returns {Promise<object>} Current or new word record
 */
export async function rotateWordIfNeeded() {
  const current = await getCurrentWord();

  // Initialize if no word exists
  if (!current) {
    return await initializeWord();
  }

  const hoursSinceSet = (Date.now() - new Date(current.set_at).getTime()) / (1000 * 60 * 60);

  // Check if anyone has attempted this word (win or loss)
  const attemptsResult = await sql`
    SELECT 1 FROM wordle_user_games
    WHERE word = ${current.current_word}
    LIMIT 1
  `;
  const hasAttempts = attemptsResult.rows.length > 0;

  // Only rotate if: time exceeded AND someone has attempted
  if (hoursSinceSet >= CONFIG.ROTATION_HOURS && hasAttempts) {
    // Get all previously used words to avoid repeats
    const usedWordsResult = await sql`
      SELECT DISTINCT current_word FROM wordle_words
    `;
    const excludeList = usedWordsResult.rows.map((r) => r.current_word);

    const newWord = getRandomWord(excludeList);
    const newNumber = current.word_number + 1;

    const result = await sql`
      INSERT INTO wordle_words (current_word, word_number, set_at)
      VALUES (${newWord}, ${newNumber}, NOW())
      RETURNING *
    `;
    return result.rows[0];
  }

  return current;
}

/**
 * Mark a word as solved and track first solver atomically
 * Uses COALESCE to ensure only the first solver gets credit
 * @param {number} wordId - Word record ID
 * @param {string} userId - Discord user ID of solver
 * @param {string} username - Discord username of solver
 * @returns {Promise<object>} Updated word record with is_first_solver flag
 */
export async function markWordSolved(wordId, userId, username) {
  const result = await sql`
    UPDATE wordle_words
    SET
      solved = TRUE,
      solve_count = solve_count + 1,
      first_solver_id = COALESCE(first_solver_id, ${userId}),
      first_solver_username = COALESCE(first_solver_username, ${username}),
      first_solved_at = COALESCE(first_solved_at, NOW())
    WHERE id = ${wordId}
    RETURNING *,
      (first_solver_id = ${userId} AND solve_count = 1) as is_first_solver
  `;
  return result.rows[0];
}

/**
 * Get time remaining until next word rotation
 * Note: This is only called when user has completed their game, so hasAttempts is implied
 * @param {object} currentWord - Current word record
 * @returns {object} { canRotate, minutesRemaining }
 */
export function getRotationInfo(currentWord) {
  if (!currentWord) {
    return { canRotate: false, minutesRemaining: 0 };
  }

  const hoursSinceSet = (Date.now() - new Date(currentWord.set_at).getTime()) / (1000 * 60 * 60);
  const hoursRemaining = Math.max(0, CONFIG.ROTATION_HOURS - hoursSinceSet);

  return {
    // canRotate when time is up (hasAttempts is implied since user completed their game)
    canRotate: hoursRemaining <= 0,
    minutesRemaining: Math.ceil(hoursRemaining * 60),
  };
}

// ============ User Game Management ============

/**
 * Get a user's game for a specific word
 * @param {string} userId - Discord user ID
 * @param {string} word - The word to find the game for
 * @returns {Promise<object|null>} User game record or null
 */
export async function getUserGame(userId, word) {
  const result = await sql`
    SELECT * FROM wordle_user_games
    WHERE user_id = ${userId} AND word = ${word}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Create a new game for a user
 * Uses ON CONFLICT to handle race conditions
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @param {string} word - The word for this game
 * @param {number} wordNumber - The word number
 * @returns {Promise<object|null>} New game record or null if already exists
 */
export async function createUserGame(userId, username, word, wordNumber) {
  const result = await sql`
    INSERT INTO wordle_user_games (user_id, username, word, word_number)
    VALUES (${userId}, ${username}, ${word}, ${wordNumber})
    ON CONFLICT (user_id, word) DO NOTHING
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Add a guess to a user's game
 * Appends to the JSONB guesses array
 * @param {number} gameId - Game record ID
 * @param {string} guess - The guess to add
 * @param {string[]} currentGuesses - Current guesses array
 * @returns {Promise<object>} Updated game record
 */
export async function addGuess(gameId, guess, currentGuesses) {
  const newGuesses = [...currentGuesses, guess.toLowerCase()];

  const result = await sql`
    UPDATE wordle_user_games
    SET guesses = ${JSON.stringify(newGuesses)}::jsonb
    WHERE id = ${gameId}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Mark a game as completed
 * @param {number} gameId - Game record ID
 * @param {boolean} won - Whether the player won
 * @returns {Promise<object>} Updated game record
 */
export async function completeGame(gameId, won) {
  const result = await sql`
    UPDATE wordle_user_games
    SET
      completed = TRUE,
      won = ${won},
      completed_at = NOW()
    WHERE id = ${gameId}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get all games for a specific word (for stats/display)
 * @param {string} word - The word to get games for
 * @returns {Promise<array>} Array of game records
 */
export async function getGamesForWord(word) {
  const result = await sql`
    SELECT * FROM wordle_user_games
    WHERE word = ${word}
    ORDER BY completed_at ASC
  `;
  return result.rows;
}

// ============ Stats Management ============

/**
 * Get or create a user's wordle stats
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @returns {Promise<object>} User stats record
 */
export async function getOrCreateStats(userId, username) {
  const result = await sql`
    INSERT INTO wordle_stats (user_id, username, created_at)
    VALUES (${userId}, ${username}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get a user's stats (without creating)
 * @param {string} userId - Discord user ID
 * @returns {Promise<object|null>} User stats or null
 */
export async function getUserStats(userId) {
  const result = await sql`
    SELECT * FROM wordle_stats
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Update user stats after completing a game
 * Handles streaks and guess distribution
 * @param {string} userId - Discord user ID
 * @param {boolean} won - Whether the player won
 * @param {number} guessCount - Number of guesses used
 * @param {boolean} wasFirstSolver - Whether this was the first solve
 * @returns {Promise<object>} Updated stats record
 */
export async function updateStats(userId, won, guessCount, wasFirstSolver) {
  // For guess distribution, we need to update the specific key
  const guessKey = guessCount.toString();

  const result = await sql`
    UPDATE wordle_stats
    SET
      games_played = games_played + 1,
      games_won = games_won + CASE WHEN ${won} THEN 1 ELSE 0 END,
      current_streak = CASE
        WHEN ${won} THEN current_streak + 1
        ELSE 0
      END,
      best_streak = CASE
        WHEN ${won} AND current_streak + 1 > best_streak
        THEN current_streak + 1
        ELSE best_streak
      END,
      first_solves = first_solves + CASE WHEN ${wasFirstSolver} THEN 1 ELSE 0 END,
      total_guesses = total_guesses + ${guessCount},
      guess_distribution = CASE
        WHEN ${won} THEN
          jsonb_set(
            guess_distribution,
            ${`{${guessKey}}`}::text[],
            to_jsonb((guess_distribution->${guessKey})::int + 1)
          )
        ELSE guess_distribution
      END,
      last_played_at = NOW()
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Record a complete game result (combines multiple operations)
 * @param {object} data - Game result data
 * @returns {Promise<object>} Updated stats
 */
export async function recordGameResult(data) {
  const { userId, username, won, guessCount, wasFirstSolver } = data;

  // Ensure stats exist
  await getOrCreateStats(userId, username);

  // Update stats
  return await updateStats(userId, won, guessCount, wasFirstSolver);
}

// ============ Leaderboards ============

/**
 * Get wordle leaderboard by category
 * @param {'wins'|'streak'|'first_solves'|'winrate'} category - Leaderboard category
 * @param {number} limit - Number of results
 * @returns {Promise<array>} Leaderboard entries
 */
export async function getLeaderboard(category, limit = 10) {
  let result;

  switch (category) {
    case 'wins':
      result = await sql`
        SELECT user_id, username, games_won, games_played,
          CASE WHEN games_played > 0
            THEN ROUND(100.0 * games_won / games_played, 1)
            ELSE 0
          END as win_rate
        FROM wordle_stats
        WHERE games_played > 0
        ORDER BY games_won DESC
        LIMIT ${limit}
      `;
      break;

    case 'streak':
      result = await sql`
        SELECT user_id, username, best_streak, current_streak, games_played
        FROM wordle_stats
        WHERE games_played > 0
        ORDER BY best_streak DESC
        LIMIT ${limit}
      `;
      break;

    case 'first_solves':
      result = await sql`
        SELECT user_id, username, first_solves, games_played
        FROM wordle_stats
        WHERE first_solves > 0
        ORDER BY first_solves DESC
        LIMIT ${limit}
      `;
      break;

    case 'winrate':
      result = await sql`
        SELECT user_id, username, games_won, games_played,
          ROUND(100.0 * games_won / games_played, 1) as win_rate
        FROM wordle_stats
        WHERE games_played >= 10
        ORDER BY (games_won::float / games_played) DESC
        LIMIT ${limit}
      `;
      break;

    default:
      result = await sql`
        SELECT user_id, username, games_won, games_played
        FROM wordle_stats
        WHERE games_played > 0
        ORDER BY games_won DESC
        LIMIT ${limit}
      `;
  }

  return result.rows;
}

/**
 * Get total number of wordle players
 * @returns {Promise<number>} Total player count
 */
export async function getTotalPlayers() {
  const result = await sql`
    SELECT COUNT(*) as count FROM wordle_stats WHERE games_played > 0
  `;
  return parseInt(result.rows[0]?.count) || 0;
}

/**
 * Get global wordle statistics
 * @returns {Promise<object>} Global stats
 */
export async function getGlobalStats() {
  const result = await sql`
    SELECT
      COUNT(*) as total_players,
      SUM(games_played) as total_games,
      SUM(games_won) as total_wins,
      SUM(first_solves) as total_first_solves,
      MAX(best_streak) as longest_streak
    FROM wordle_stats
    WHERE games_played > 0
  `;
  return result.rows[0];
}
