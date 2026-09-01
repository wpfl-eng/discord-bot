// /ask Database Operations
// ask_sessions / ask_usage / ask_tool_calls (migration 009)

import { sql } from '@vercel/postgres';

// ============ Type Definitions ============

export interface AskSession {
  readonly thread_id: string;
  readonly session_id: string;
  readonly opener_user_id: string;
  readonly question: string;
  readonly turns: number;
  readonly closed: boolean;
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

/** Questions this user has asked since `since`. Counts rows; never sums cost. */
export async function countUserQuestionsSince(userId: string, since: Date): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) AS count FROM ask_usage
    WHERE user_id = ${userId}
      AND created_at >= ${since.toISOString()}
  `;
  return Number(result.rows[0]?.count ?? 0);
}

/** Queries the whole league has run since `since`. */
export async function countAllQuestionsSince(since: Date): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) AS count FROM ask_usage
    WHERE created_at >= ${since.toISOString()}
  `;
  return Number(result.rows[0]?.count ?? 0);
}

// ============ Sessions ============

export async function getSession(threadId: string): Promise<AskSession | null> {
  const result = await sql<AskSession>`
    SELECT thread_id, session_id, opener_user_id, question, turns, closed
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
  question: string
): Promise<void> {
  await sql`
    INSERT INTO ask_sessions (thread_id, session_id, opener_user_id, question)
    VALUES (${threadId}, ${sessionId}, ${openerUserId}, ${question})
    ON CONFLICT (thread_id) DO UPDATE
      SET session_id = EXCLUDED.session_id,
          opener_user_id = EXCLUDED.opener_user_id,
          question = EXCLUDED.question,
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
    INSERT INTO ask_usage (user_id, thread_id, prompt, model, num_turns, cost_usd, subtype, duration_ms)
    VALUES (${usage.userId}, ${usage.threadId}, ${usage.prompt}, ${usage.model},
            ${usage.numTurns}, ${usage.costUsd}, ${usage.subtype}, ${usage.durationMs})
  `;
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
