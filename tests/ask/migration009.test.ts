/**
 * Guards one decision in migrations/009_ask_agent.sql that is invisible from
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
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/009_ask_agent.sql'),
  'utf8'
);

/** The body of one CREATE TABLE statement, without the surrounding noise. */
function tableBody(name: string): string {
  const match: RegExpMatchArray | null = migration.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`, 'i')
  );
  if (match === null) throw new Error(`migration 009 does not create ${name}`);
  return match[1];
}

describe('migration 009', () => {
  test('creates all three tables', () => {
    expect(() => tableBody('ask_sessions')).not.toThrow();
    expect(() => tableBody('ask_usage')).not.toThrow();
    expect(() => tableBody('ask_tool_calls')).not.toThrow();
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
