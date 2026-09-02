// /ask Database Operations
// ask_sessions / ask_usage / ask_tool_calls / ask_feedback (migration 014)

import { sql } from '@vercel/postgres';

// ============ Type Definitions ============

export interface AskSession {
  readonly thread_id: string;
  readonly session_id: string;
  readonly opener_user_id: string;
  readonly question: string;
  readonly turns: number;
  readonly closed: boolean;
  /** TRUE when /ask opened the thread itself; decides who may continue it by just typing. */
  readonly bot_thread: boolean;
}

export interface UsageRecord {
  readonly userId: string;
  readonly threadId: string | null;
  readonly prompt: string;
  readonly model: string | null;
  readonly numTurns: number | null;
  /** Client-side ESTIMATE from the SDK's bundled price table. Never gates anything. */
  readonly costUsd: number;
  readonly subtype: string | null;
  readonly durationMs: number | null;
  /**
   * Whether the row counts against the caps. FALSE when the run never reached
   * the model or the SDK reported an ops failure -- not the member's consumption.
   */
  readonly counted: boolean;
  /** What the run died of, when it did. */
  readonly error: string | null;
  /** The Discord message the answer landed in, so feedback can join to the run. */
  readonly messageId: string | null;
}

export interface FeedbackCounts {
  readonly up: number;
  readonly down: number;
}

export interface ToolException {
  readonly threadId: string | null;
  readonly userId: string | null;
  readonly toolName: string;
  readonly toolInput: unknown;
  /** 'path_guard' | 'domain_guard'; null when the call failed rather than was denied. */
  readonly deniedBy: string | null;
  readonly error: string | null;
}

// ============ Caps ============

/**
 * Questions this user is charged for since `since`. Counts rows; never sums
 * cost. Uncounted rows -- a run that never reached the model, an expired login,
 * a rate limit -- stay in the table for observability and are skipped here.
 */
export async function countUserQuestionsSince(userId: string, since: Date): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) AS count FROM ask_usage
    WHERE user_id = ${userId}
      AND counted
      AND created_at >= ${since.toISOString()}
  `;
  return Number(result.rows[0]?.count ?? 0);
}

/** Queries the whole league is charged for since `since`. */
export async function countAllQuestionsSince(since: Date): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) AS count FROM ask_usage
    WHERE counted
      AND created_at >= ${since.toISOString()}
  `;
  return Number(result.rows[0]?.count ?? 0);
}

// ============ Sessions ============

export async function getSession(threadId: string): Promise<AskSession | null> {
  const result = await sql<AskSession>`
    SELECT thread_id, session_id, opener_user_id, question, turns, closed, bot_thread
    FROM ask_sessions
    WHERE thread_id = ${threadId}
  `;
  return result.rows[0] ?? null;
}

/**
 * Record the session a thread is running. On a revived thread whose session
 * has been pruned the caller starts fresh, so the same thread id can be
 * rebound to a new session -- hence the upsert rather than an insert.
 */
export async function openSession(
  threadId: string,
  sessionId: string,
  openerUserId: string,
  question: string,
  botThread: boolean
): Promise<void> {
  await sql`
    INSERT INTO ask_sessions (thread_id, session_id, opener_user_id, question, bot_thread)
    VALUES (${threadId}, ${sessionId}, ${openerUserId}, ${question}, ${botThread})
    ON CONFLICT (thread_id) DO UPDATE
      SET session_id = EXCLUDED.session_id,
          opener_user_id = EXCLUDED.opener_user_id,
          question = EXCLUDED.question,
          bot_thread = EXCLUDED.bot_thread,
          turns = 1,
          closed = FALSE,
          last_used_at = NOW()
  `;
}

/** One more turn in this thread. Returns the new count, which drives the turn caps. */
export async function recordTurn(threadId: string, costUsd: number): Promise<number> {
  const result = await sql<{ turns: number }>`
    UPDATE ask_sessions
    SET turns = turns + 1,
        total_cost_usd = total_cost_usd + ${costUsd},
        last_used_at = NOW()
    WHERE thread_id = ${threadId}
    RETURNING turns
  `;
  return result.rows[0]?.turns ?? 0;
}

/** Set when the thread archives. A closed session is never resumed. */
export async function closeSession(threadId: string): Promise<void> {
  await sql`UPDATE ask_sessions SET closed = TRUE WHERE thread_id = ${threadId}`;
}

// ============ Ledger ============

/** Written on every terminal result, success or error. */
export async function recordUsage(usage: UsageRecord): Promise<void> {
  await sql`
    INSERT INTO ask_usage (user_id, thread_id, prompt, model, num_turns, cost_usd, subtype,
                           duration_ms, counted, error, message_id)
    VALUES (${usage.userId}, ${usage.threadId}, ${usage.prompt}, ${usage.model},
            ${usage.numTurns}, ${usage.costUsd}, ${usage.subtype}, ${usage.durationMs},
            ${usage.counted}, ${usage.error}, ${usage.messageId})
  `;
}

// ============ Admin views ============
// Read by /ask-admin usage. Read-only, filtered the way the caps are.

export interface UserCount {
  readonly userId: string;
  readonly count: number;
}

export async function countByUserSince(since: Date): Promise<UserCount[]> {
  const result = await sql<{ user_id: string; count: string }>`
    SELECT user_id, COUNT(*) AS count FROM ask_usage
    WHERE counted
      AND created_at >= ${since.toISOString()}
    GROUP BY user_id
    ORDER BY count DESC
  `;
  return result.rows.map((row) => ({ userId: row.user_id, count: Number(row.count) }));
}

export interface RecentRun {
  readonly userId: string;
  readonly threadId: string | null;
  readonly prompt: string;
  readonly subtype: string | null;
  readonly costUsd: number;
  readonly durationMs: number | null;
  readonly counted: boolean;
  readonly error: string | null;
  readonly createdAt: Date;
}

export async function recentRuns(limit: number): Promise<RecentRun[]> {
  const result = await sql<{
    user_id: string;
    thread_id: string | null;
    prompt: string;
    subtype: string | null;
    cost_usd: string | number;
    duration_ms: number | null;
    counted: boolean;
    error: string | null;
    created_at: Date;
  }>`
    SELECT user_id, thread_id, prompt, subtype, cost_usd, duration_ms, counted, error, created_at
    FROM ask_usage ORDER BY created_at DESC LIMIT ${limit}
  `;
  return result.rows.map((row) => ({
    userId: row.user_id,
    threadId: row.thread_id,
    prompt: row.prompt,
    subtype: row.subtype,
    // NUMERIC arrives as a string from node-postgres.
    costUsd: Number(row.cost_usd),
    durationMs: row.duration_ms,
    counted: row.counted,
    error: row.error,
    createdAt: new Date(row.created_at),
  }));
}

export interface RecentThumbsDown {
  readonly messageId: string;
  readonly threadId: string | null;
  readonly userId: string;
  readonly updatedAt: Date;
}

export async function recentThumbsDown(limit: number): Promise<RecentThumbsDown[]> {
  const result = await sql<{
    message_id: string;
    thread_id: string | null;
    user_id: string;
    updated_at: Date;
  }>`
    SELECT message_id, thread_id, user_id, updated_at
    FROM ask_feedback WHERE rating = -1
    ORDER BY updated_at DESC LIMIT ${limit}
  `;
  return result.rows.map((row) => ({
    messageId: row.message_id,
    threadId: row.thread_id,
    userId: row.user_id,
    updatedAt: new Date(row.updated_at),
  }));
}

// ============ Feedback ============

/** One vote per person per answer; a changed mind overwrites. */
export async function recordFeedback(
  messageId: string,
  threadId: string | null,
  userId: string,
  rating: 1 | -1
): Promise<void> {
  await sql`
    INSERT INTO ask_feedback (message_id, thread_id, user_id, rating)
    VALUES (${messageId}, ${threadId}, ${userId}, ${rating})
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET rating = EXCLUDED.rating,
          updated_at = NOW()
  `;
}

export async function feedbackCounts(messageId: string): Promise<FeedbackCounts> {
  const result = await sql<{ up: string; down: string }>`
    SELECT COUNT(*) FILTER (WHERE rating = 1) AS up,
           COUNT(*) FILTER (WHERE rating = -1) AS down
    FROM ask_feedback
    WHERE message_id = ${messageId}
  `;
  return { up: Number(result.rows[0]?.up ?? 0), down: Number(result.rows[0]?.down ?? 0) };
}

/** Denials and failures only. A row here is a signal, not a log line. */
export async function recordToolException(exception: ToolException): Promise<void> {
  await sql`
    INSERT INTO ask_tool_calls (thread_id, user_id, tool_name, tool_input, denied_by, error)
    VALUES (${exception.threadId}, ${exception.userId}, ${exception.toolName},
            ${JSON.stringify(exception.toolInput ?? null)}::jsonb,
            ${exception.deniedBy}, ${exception.error})
  `;
}
