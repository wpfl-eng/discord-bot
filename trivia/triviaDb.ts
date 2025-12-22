// Trivia Database Operations
// Active questions, answers, scores, and leaderboards

import { sql } from '@vercel/postgres';

// ============ Type Definitions ============

/**
 * Trivia category types
 */
export type TriviaCategory = 'nfl' | 'wpfl';

/**
 * Active question record from trivia_active table
 */
export interface TriviaActiveQuestion {
  readonly id: number;
  readonly category: TriviaCategory;
  readonly question_id: string | null;
  readonly question: string;
  readonly answer: string;
  readonly acceptable_answers: string[] | null;  // PostgreSQL TEXT[] returns as JS array
  readonly point_value: number;
  readonly source_data: string | null;
  readonly channel_id: string;
  readonly window_closes_at: Date;
  readonly is_closed: boolean;
  readonly sent_at: Date;
}

/**
 * Answer record from trivia_answers table
 */
export interface TriviaAnswer {
  readonly id: number;
  readonly question_id: number;
  readonly user_id: string;
  readonly username: string;
  readonly is_correct: boolean;
  readonly attempt_count: number;
  readonly answered_at: Date;
}

/**
 * Score record from trivia_scores table
 */
export interface TriviaScore {
  readonly user_id: string;
  readonly username: string;
  readonly total_points: number;
  readonly nfl_points: number;
  readonly wpfl_points: number;
  readonly current_streak: number;
  readonly best_streak: number;
  readonly last_correct_at: Date | null;
}

/**
 * Data for saving a new active question
 */
export interface SaveActiveQuestionData {
  readonly category: TriviaCategory;
  readonly questionId: string | null;
  readonly question: string;
  readonly answer: string;
  readonly acceptableAnswers: string | null;
  readonly pointValue: number;
  readonly sourceData: string | null;
  readonly channelId: string;
  readonly windowClosesAt: Date;
}

/**
 * Data for recording an answer
 */
export interface RecordAnswerData {
  readonly questionId: number;
  readonly userId: string;
  readonly username: string;
  readonly isCorrect: boolean;
}

/**
 * Correct answer entry with user info
 */
export interface CorrectAnswerEntry {
  readonly user_id: string;
  readonly username: string;
}

// ============ Active Questions ============

/**
 * Get the current active question for a category
 * @param category - 'nfl' or 'wpfl'
 * @returns Active question or null
 */
export async function getActiveQuestion(
  category: TriviaCategory
): Promise<TriviaActiveQuestion | null> {
  const result = await sql<TriviaActiveQuestion>`
    SELECT * FROM trivia_active
    WHERE category = ${category} AND is_closed = FALSE
    ORDER BY sent_at DESC
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Get any active question regardless of category
 * Returns the most recently posted active question if multiple exist
 * @returns Active question or null
 */
export async function getAnyActiveQuestion(): Promise<TriviaActiveQuestion | null> {
  const result = await sql<TriviaActiveQuestion>`
    SELECT * FROM trivia_active
    WHERE is_closed = FALSE
    ORDER BY sent_at DESC
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Save a new active question
 * @param data - Question data
 * @returns Created question
 */
export async function saveActiveQuestion(
  data: SaveActiveQuestionData
): Promise<TriviaActiveQuestion> {
  // Convert Date to ISO string for SQL
  const windowClosesAt = data.windowClosesAt instanceof Date
    ? data.windowClosesAt.toISOString()
    : data.windowClosesAt;

  const result = await sql<TriviaActiveQuestion>`
    INSERT INTO trivia_active
      (category, question_id, question, answer, acceptable_answers, point_value, source_data, channel_id, window_closes_at)
    VALUES
      (${data.category}, ${data.questionId}, ${data.question}, ${data.answer}, ${data.acceptableAnswers}, ${data.pointValue}, ${data.sourceData}, ${data.channelId}, ${windowClosesAt})
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Close an active question
 * @param id - Question ID
 */
export async function closeQuestion(id: number): Promise<void> {
  await sql`
    UPDATE trivia_active
    SET is_closed = TRUE
    WHERE id = ${id}
  `;
}

// ============ Question History ============

/**
 * Check if a question has been asked before
 * @param hash - Question hash (id for NFL, MD5 of source_data for WPFL)
 * @returns True if already asked
 */
export async function isQuestionAsked(hash: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM trivia_history
    WHERE question_hash = ${hash}
    LIMIT 1
  `;
  return result.rows.length > 0;
}

/**
 * Get all asked question hashes for a category
 * Note: Loads hashes into memory for efficient O(1) lookup when checking many questions.
 * Limited to 10,000 rows to prevent unbounded memory growth.
 * @param category - 'nfl' or 'wpfl'
 * @returns Set of question hashes that have been asked
 */
export async function getAskedHashes(category: TriviaCategory): Promise<Set<string>> {
  const MAX_HASHES = 10000;
  const result = await sql<{ question_hash: string }>`
    SELECT question_hash FROM trivia_history
    WHERE category = ${category}
    ORDER BY asked_at DESC
    LIMIT ${MAX_HASHES}
  `;

  if (result.rows.length >= MAX_HASHES) {
    console.warn(
      `[TRIVIA] getAskedHashes hit limit of ${MAX_HASHES} for category ${category}. Consider cleanup.`
    );
  }

  return new Set(result.rows.map(row => row.question_hash));
}

/**
 * Record that a question has been asked
 * @param hash - Question hash
 * @param category - 'nfl' or 'wpfl'
 */
export async function recordQuestionHash(
  hash: string,
  category: TriviaCategory
): Promise<void> {
  await sql`
    INSERT INTO trivia_history (question_hash, category)
    VALUES (${hash}, ${category})
    ON CONFLICT (question_hash) DO NOTHING
  `;
}

// ============ User Answers ============

/**
 * Get a user's answer for a specific question
 * @param questionId - Active question ID
 * @param userId - Discord user ID
 * @returns User's answer or null
 */
export async function getUserAnswer(
  questionId: number,
  userId: string
): Promise<TriviaAnswer | null> {
  const result = await sql<TriviaAnswer>`
    SELECT * FROM trivia_answers
    WHERE question_id = ${questionId} AND user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Record a user's answer (with attempt tracking)
 * @param data - Answer data
 * @returns The recorded answer with attempt_count
 */
export async function recordAnswer(data: RecordAnswerData): Promise<TriviaAnswer> {
  const result = await sql<TriviaAnswer>`
    INSERT INTO trivia_answers (question_id, user_id, username, is_correct, attempt_count)
    VALUES (${data.questionId}, ${data.userId}, ${data.username}, ${data.isCorrect}, 1)
    ON CONFLICT (question_id, user_id)
    DO UPDATE SET
      is_correct = ${data.isCorrect},
      answered_at = NOW(),
      attempt_count = trivia_answers.attempt_count + 1
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get all correct answers for a question
 * @param questionId - Active question ID
 * @returns Array of correct answer entries
 */
export async function getCorrectAnswers(
  questionId: number
): Promise<CorrectAnswerEntry[]> {
  const result = await sql<CorrectAnswerEntry>`
    SELECT user_id, username FROM trivia_answers
    WHERE question_id = ${questionId} AND is_correct = TRUE
    ORDER BY answered_at ASC
  `;
  return result.rows;
}

// ============ Scores ============

/**
 * Add points to a user's score
 * @param userId - Discord user ID
 * @param username - Discord username
 * @param points - Points to add
 * @param category - 'nfl' or 'wpfl'
 */
export async function addPoints(
  userId: string,
  username: string,
  points: number,
  category: TriviaCategory
): Promise<void> {
  const nflPoints = category === 'nfl' ? points : 0;
  const wpflPoints = category === 'wpfl' ? points : 0;

  await sql`
    INSERT INTO trivia_scores (user_id, username, total_points, nfl_points, wpfl_points, last_correct_at)
    VALUES (${userId}, ${username}, ${points}, ${nflPoints}, ${wpflPoints}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username},
      total_points = trivia_scores.total_points + ${points},
      nfl_points = trivia_scores.nfl_points + ${nflPoints},
      wpfl_points = trivia_scores.wpfl_points + ${wpflPoints},
      last_correct_at = NOW()
  `;
}

/**
 * Get the leaderboard
 * @param limit - Number of users to return
 * @returns Leaderboard entries
 */
export async function getLeaderboard(limit: number = 10): Promise<TriviaScore[]> {
  const result = await sql<TriviaScore>`
    SELECT user_id, username, total_points, nfl_points, wpfl_points, current_streak, best_streak
    FROM trivia_scores
    ORDER BY total_points DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Get stats for a specific user
 * @param userId - Discord user ID
 * @returns User stats or null
 */
export async function getUserStats(userId: string): Promise<TriviaScore | null> {
  const result = await sql<TriviaScore>`
    SELECT * FROM trivia_scores
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}
