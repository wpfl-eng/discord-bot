/**
 * Guards one decision in migrations/014_ask_agent.sql that is invisible from
 * TypeScript and expensive to rediscover: `ask_usage` must not carry a foreign
 * key onto `ask_sessions`.
 *
 * It did. The ledger is written from inside runAsk(), on every terminal result,
 * before the Discord layer has had a chance to write the session row -- and on
 * a run that died before the SDK emitted a session id there is no session row
 * to write at all. Verified against Postgres 16: the exact insert the code
 * performs, in the order the code performs it, fails with
 *
 *   insert or update on table "ask_usage" violates foreign key constraint
 *   "ask_usage_thread_id_fkey"
 *
 * writeLedger() catches and logs, so the failure is silent -- and since
 * checkCaps counts rows in ask_usage, the daily and monthly limits counted
 * nothing at all.
 *
 * An append-only accounting ledger should not depend on a mutable, prunable
 * session table for its right to exist. thread_id stays as a correlation key
 * with its own index.
 */

import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migration: string = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/014_ask_agent.sql'),
  'utf8'
);

/** The body of one CREATE TABLE statement, without the surrounding noise. */
function tableBody(name: string): string {
  const match: RegExpMatchArray | null = migration.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`, 'i')
  );
  if (match === null) throw new Error(`migration 014 does not create ${name}`);
  return match[1];
}

describe('migration 014', () => {
  test('creates all four tables', () => {
    expect(() => tableBody('ask_sessions')).not.toThrow();
    expect(() => tableBody('ask_usage')).not.toThrow();
    expect(() => tableBody('ask_tool_calls')).not.toThrow();
    expect(() => tableBody('ask_feedback')).not.toThrow();
  });

  /**
   * Stage 14 additions. The migration was still unapplied, so these are
   * columns on the CREATE rather than a fifteenth file of ALTERs.
   */
  describe('what a member is charged for', () => {
    test('the ledger says whether a row counts against the caps, defaulting to yes', () => {
      expect(tableBody('ask_usage')).toMatch(/counted\s+BOOLEAN NOT NULL DEFAULT TRUE/i);
    });

    test('the ledger keeps what a run died of, so an uncounted row explains itself', () => {
      expect(tableBody('ask_usage')).toMatch(/\berror\s+TEXT/i);
    });

    test('the ledger records the answer message, so feedback can join to its run', () => {
      expect(tableBody('ask_usage')).toMatch(/message_id\s+TEXT/i);
    });
  });

  describe('which threads the bot opened', () => {
    test('a session records whether /ask created its thread, defaulting to no', () => {
      expect(tableBody('ask_sessions')).toMatch(/bot_thread\s+BOOLEAN NOT NULL DEFAULT FALSE/i);
    });
  });

  describe('feedback', () => {
    test('is keyed by the Discord message, not the ledger row, so a vote survives a failed ledger write', () => {
      const body: string = tableBody('ask_feedback');

      expect(body).toMatch(/message_id\s+TEXT NOT NULL/i);
      expect(body).not.toMatch(/REFERENCES/i);
    });

    test('is one vote per person per answer, so a changed mind overwrites', () => {
      expect(tableBody('ask_feedback')).toMatch(/UNIQUE \(message_id, user_id\)/i);
    });

    test('a rating is thumbs up or thumbs down and nothing else', () => {
      expect(tableBody('ask_feedback')).toMatch(
        /rating\s+SMALLINT NOT NULL CHECK \(rating IN \(-1, 1\)\)/i
      );
    });
  });

  test('the usage ledger does not reference ask_sessions', () => {
    expect(tableBody('ask_usage')).not.toMatch(/REFERENCES/i);
  });

  test('no table references another, so no write ordering is load-bearing', () => {
    expect(migration).not.toMatch(/REFERENCES/i);
  });

  test('thread_id is still indexed on both child tables, having lost the constraint', () => {
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS \S+\s+ON ask_usage \(thread_id/i);
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS \S+\s+ON ask_tool_calls \(thread_id/i);
  });

  test('stays wrapped in one transaction', () => {
    expect(migration).toMatch(/^\s*BEGIN;/m);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
  });

  test('is idempotent, because nothing tracks which migrations have run', () => {
    const creates: string[] = migration.match(/CREATE (TABLE|INDEX)[^(]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      expect(statement).toMatch(/IF NOT EXISTS/i);
    }
  });
});
