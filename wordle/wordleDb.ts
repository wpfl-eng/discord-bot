// Wordle Database Operations
// All database interactions for the Wordle game

import { sql } from '@vercel/postgres';
import { getRandomWord } from './wordleWords.js';
import { CONFIG } from './wordleConfig.js';

// ============ Type Definitions ============

/**
 * Leaderboard category types
 */
export type LeaderboardCategory = 'wins' | 'streak' | 'first_solves' | 'winrate';

/**
 * Guess distribution tracking (1-6 guesses)
 */
export interface GuessDistribution {
  readonly '1': number;
  readonly '2': number;
  readonly '3': number;
  readonly '4': number;
  readonly '5': number;
  readonly '6': number;
}

/**
 * Word record from wordle_words table
 */
export interface WordleWord {
  readonly id: number;
  readonly current_word: string;
  readonly word_number: number;
  readonly set_at: Date;
  readonly solved: boolean;
  readonly solve_count: number;
  readonly first_solver_id: string | null;
  readonly first_solver_username: string | null;
  readonly first_solved_at: Date | null;
}

/**
 * Extended word record with first solver flag
 */
export interface WordleWordWithSolverFlag extends WordleWord {
  readonly is_first_solver: boolean;
}

/**
 * User game record from wordle_user_games table
 */
export interface WordleUserGame {
  readonly id: number;
  readonly user_id: string;
  readonly username: string;
  readonly word: string;
  readonly word_number: number;
  readonly guesses: string[];
  readonly completed: boolean;
  readonly won: boolean;
  readonly completed_at: Date | null;
  readonly created_at: Date;
}

/**
 * User stats record from wordle_stats table
 */
export interface WordleStats {
  readonly user_id: string;
  readonly username: string;
  readonly games_played: number;
  readonly games_won: number;
  readonly current_streak: number;
  readonly best_streak: number;
  readonly first_solves: number;
  readonly total_guesses: number;
  readonly guess_distribution: GuessDistribution;
  readonly last_played_at: Date | null;
  readonly created_at: Date;
}

/**
 * Rotation info result
 */
export interface RotationInfo {
  readonly canRotate: boolean;
  readonly minutesRemaining: number;
}

/**
 * Data for recording a game result
 */
export interface RecordGameResultData {
  readonly userId: string;
  readonly username: string;
  readonly won: boolean;
  readonly guessCount: number;
  readonly wasFirstSolver: boolean;
}

/**
 * Leaderboard entry (varies by category)
 */
export interface LeaderboardEntry {
  readonly user_id: string;
  readonly username: string;
  readonly games_won?: number;
  readonly games_played?: number;
  readonly win_rate?: number;
  readonly best_streak?: number;
  readonly current_streak?: number;
  readonly first_solves?: number;
}

/**
 * Global stats aggregate
 */
export interface GlobalStats {
  readonly total_players: string;
  readonly total_games: string;
  readonly total_wins: string;
  readonly total_first_solves: string;
  readonly longest_streak: number;
}

// ============ Word Management ============

/**
 * Get the current active word
 * @returns Current word record or null
 */
export async function getCurrentWord(): Promise<WordleWord | null> {
  const result = await sql<WordleWord>`
    SELECT * FROM wordle_words
    ORDER BY id DESC
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Initialize the first word (used when no word exists)
 * @returns Newly created word record
 */
export async function initializeWord(): Promise<WordleWord> {
  const word = getRandomWord([]);

  const result = await sql<WordleWord>`
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
 * @returns Current or new word record
 */
export async function rotateWordIfNeeded(): Promise<WordleWord> {
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
    const usedWordsResult = await sql<{ current_word: string }>`
      SELECT DISTINCT current_word FROM wordle_words
    `;
    const excludeList = usedWordsResult.rows.map((r) => r.current_word);

    const newWord = getRandomWord(excludeList);
    const newNumber = current.word_number + 1;

    const result = await sql<WordleWord>`
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
 * @param wordId - Word record ID
 * @param userId - Discord user ID of solver
 * @param username - Discord username of solver
 * @returns Updated word record with is_first_solver flag
 */
export async function markWordSolved(
  wordId: number,
  userId: string,
  username: string
): Promise<WordleWordWithSolverFlag> {
  const result = await sql<WordleWordWithSolverFlag>`
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
 * @param currentWord - Current word record
 * @returns Rotation info with canRotate flag and minutes remaining
 */
export function getRotationInfo(currentWord: WordleWord | null): RotationInfo {
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
 * @param userId - Discord user ID
 * @param word - The word to find the game for
 * @returns User game record or null
 */
export async function getUserGame(
  userId: string,
  word: string
): Promise<WordleUserGame | null> {
  const result = await sql<WordleUserGame>`
    SELECT * FROM wordle_user_games
    WHERE user_id = ${userId} AND word = ${word}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Create a new game for a user
 * Uses ON CONFLICT to handle race conditions
 * @param userId - Discord user ID
 * @param username - Discord username
 * @param word - The word for this game
 * @param wordNumber - The word number
 * @returns New game record or null if already exists
 */
export async function createUserGame(
  userId: string,
  username: string,
  word: string,
  wordNumber: number
): Promise<WordleUserGame | null> {
  const result = await sql<WordleUserGame>`
    INSERT INTO wordle_user_games (user_id, username, word, word_number)
    VALUES (${userId}, ${username}, ${word}, ${wordNumber})
    ON CONFLICT (user_id, word) DO NOTHING
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Add a guess to a user's game
 * Appends to the JSONB guesses array
 * @param gameId - Game record ID
 * @param guess - The guess to add
 * @param currentGuesses - Current guesses array
 * @returns Updated game record
 */
export async function addGuess(
  gameId: number,
  guess: string,
  currentGuesses: string[]
): Promise<WordleUserGame> {
  const newGuesses = [...currentGuesses, guess.toLowerCase()];

  const result = await sql<WordleUserGame>`
    UPDATE wordle_user_games
    SET guesses = ${JSON.stringify(newGuesses)}::jsonb
    WHERE id = ${gameId}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Mark a game as completed
 * @param gameId - Game record ID
 * @param won - Whether the player won
 * @returns Updated game record
 */
export async function completeGame(
  gameId: number,
  won: boolean
): Promise<WordleUserGame> {
  const result = await sql<WordleUserGame>`
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
 * @param word - The word to get games for
 * @returns Array of game records
 */
export async function getGamesForWord(word: string): Promise<WordleUserGame[]> {
  const result = await sql<WordleUserGame>`
    SELECT * FROM wordle_user_games
    WHERE word = ${word}
    ORDER BY completed_at ASC
  `;
  return result.rows;
}

// ============ Stats Management ============

/**
 * Get or create a user's wordle stats
 * @param userId - Discord user ID
 * @param username - Discord username
 * @returns User stats record
 */
export async function getOrCreateStats(
  userId: string,
  username: string
): Promise<WordleStats> {
  const result = await sql<WordleStats>`
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
 * @param userId - Discord user ID
 * @returns User stats or null
 */
export async function getUserStats(userId: string): Promise<WordleStats | null> {
  const result = await sql<WordleStats>`
    SELECT * FROM wordle_stats
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Update user stats after completing a game
 * Handles streaks and guess distribution
 * @param userId - Discord user ID
 * @param won - Whether the player won
 * @param guessCount - Number of guesses used
 * @param wasFirstSolver - Whether this was the first solve
 * @returns Updated stats record
 */
export async function updateStats(
  userId: string,
  won: boolean,
  guessCount: number,
  wasFirstSolver: boolean
): Promise<WordleStats> {
  // For guess distribution, we need to update the specific key
  const guessKey = guessCount.toString();

  const result = await sql<WordleStats>`
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
 * @param data - Game result data
 * @returns Updated stats
 */
export async function recordGameResult(data: RecordGameResultData): Promise<WordleStats> {
  const { userId, username, won, guessCount, wasFirstSolver } = data;

  // Ensure stats exist
  await getOrCreateStats(userId, username);

  // Update stats
  return await updateStats(userId, won, guessCount, wasFirstSolver);
}

// ============ Leaderboards ============

/**
 * Get wordle leaderboard by category
 * @param category - Leaderboard category
 * @param limit - Number of results
 * @returns Leaderboard entries
 */
export async function getLeaderboard(
  category: LeaderboardCategory,
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  let result;

  switch (category) {
    case 'wins':
      result = await sql<LeaderboardEntry>`
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
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, best_streak, current_streak, games_played
        FROM wordle_stats
        WHERE games_played > 0
        ORDER BY best_streak DESC
        LIMIT ${limit}
      `;
      break;

    case 'first_solves':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, first_solves, games_played
        FROM wordle_stats
        WHERE first_solves > 0
        ORDER BY first_solves DESC
        LIMIT ${limit}
      `;
      break;

    case 'winrate':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, games_won, games_played,
          ROUND(100.0 * games_won / games_played, 1) as win_rate
        FROM wordle_stats
        WHERE games_played >= 10
        ORDER BY (games_won::float / games_played) DESC
        LIMIT ${limit}
      `;
      break;

    default:
      result = await sql<LeaderboardEntry>`
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
 * @returns Total player count
 */
export async function getTotalPlayers(): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM wordle_stats WHERE games_played > 0
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Get global wordle statistics
 * @returns Global stats
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  const result = await sql<GlobalStats>`
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
