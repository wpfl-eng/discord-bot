import { sql } from '@vercel/postgres';

// ============ Active Questions ============

/**
 * Get the current active question for a category
 * @param {string} category - 'nfl' or 'wpfl'
 * @returns {object|null} - Active question or null
 */
export async function getActiveQuestion(category) {
  const result = await sql`
    SELECT * FROM trivia_active
    WHERE category = ${category} AND is_closed = FALSE
    ORDER BY sent_at DESC
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Save a new active question
 * @param {object} data - Question data
 * @returns {object} - Created question
 */
export async function saveActiveQuestion(data) {
  const result = await sql`
    INSERT INTO trivia_active
      (category, question_id, question, answer, acceptable_answers, point_value, source_data, channel_id, window_closes_at)
    VALUES
      (${data.category}, ${data.questionId}, ${data.question}, ${data.answer}, ${data.acceptableAnswers}, ${data.pointValue}, ${data.sourceData}, ${data.channelId}, ${data.windowClosesAt})
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Close an active question
 * @param {number} id - Question ID
 */
export async function closeQuestion(id) {
  await sql`
    UPDATE trivia_active
    SET is_closed = TRUE
    WHERE id = ${id}
  `;
}

// ============ Question History ============

/**
 * Check if a question has been asked before
 * @param {string} hash - Question hash (id for NFL, MD5 of source_data for WPFL)
 * @returns {boolean}
 */
export async function isQuestionAsked(hash) {
  const result = await sql`
    SELECT 1 FROM trivia_history
    WHERE question_hash = ${hash}
    LIMIT 1
  `;
  return result.rows.length > 0;
}

/**
 * Record that a question has been asked
 * @param {string} hash - Question hash
 * @param {string} category - 'nfl' or 'wpfl'
 */
export async function recordQuestionHash(hash, category) {
  await sql`
    INSERT INTO trivia_history (question_hash, category)
    VALUES (${hash}, ${category})
    ON CONFLICT (question_hash) DO NOTHING
  `;
}

// ============ User Answers ============

/**
 * Get a user's answer for a specific question
 * @param {number} questionId - Active question ID
 * @param {string} userId - Discord user ID
 * @returns {object|null}
 */
export async function getUserAnswer(questionId, userId) {
  const result = await sql`
    SELECT * FROM trivia_answers
    WHERE question_id = ${questionId} AND user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Record a user's answer (with attempt tracking)
 * @param {object} data - Answer data
 * @returns {object} - The recorded answer with attempt_count
 */
export async function recordAnswer(data) {
  const result = await sql`
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
 * @param {number} questionId - Active question ID
 * @returns {array}
 */
export async function getCorrectAnswers(questionId) {
  const result = await sql`
    SELECT user_id, username FROM trivia_answers
    WHERE question_id = ${questionId} AND is_correct = TRUE
    ORDER BY answered_at ASC
  `;
  return result.rows;
}

// ============ Scores ============

/**
 * Add points to a user's score
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @param {number} points - Points to add
 * @param {string} category - 'nfl' or 'wpfl'
 */
export async function addPoints(userId, username, points, category) {
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
 * @param {number} limit - Number of users to return
 * @returns {array}
 */
export async function getLeaderboard(limit = 10) {
  const result = await sql`
    SELECT user_id, username, total_points, nfl_points, wpfl_points, current_streak, best_streak
    FROM trivia_scores
    ORDER BY total_points DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Get stats for a specific user
 * @param {string} userId - Discord user ID
 * @returns {object|null}
 */
export async function getUserStats(userId) {
  const result = await sql`
    SELECT * FROM trivia_scores
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}
