/**
 * Read-only SQL over the shredded artifact and the cached WPFL decade.
 *
 * This is what replaces the shell we declined to give the agent, and it is the
 * reason the agent can do real aggregation -- correlations, ten-year splits,
 * group-bys, and joins across the two sources -- instead of arithmetic over
 * hundreds of rows in context (design §4.3).
 *
 * Two independent controls, because neither alone is enough:
 *
 * 1. **Materialize, then lock down.** Every queryable file is copied into an
 *    in-memory database, and then `enable_external_access` is turned off and
 *    `lock_configuration` turned on. Verified against DuckDB 1.5.5: after that,
 *    agent SQL cannot read a file, glob, COPY, ATTACH, INSTALL, LOAD, or turn
 *    either setting back on, and the lockdown covers every connection on the
 *    instance.
 * 2. **A statement guard.** Not belt-and-braces: DuckDB executes *every*
 *    statement it is handed, so `SELECT 1; DELETE FROM t` deletes. The
 *    one-statement rule is the control.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { ASK } from '../ask/askConfig.js';

export interface SqlResult {
  readonly rows: Record<string, unknown>[];
  readonly truncated: boolean;
}

/**
 * Statements that would write, reach outside the database, or change its
 * configuration. Matched as whole words against the statement with string
 * literals and comments removed, so a keyword inside quoted text or an
 * identifier like `dropped_players` is left alone.
 */
const FORBIDDEN: readonly string[] = [
  'ATTACH',
  'DETACH',
  'COPY',
  'INSTALL',
  'LOAD',
  'EXPORT',
  'IMPORT',
  'PRAGMA',
  'SET',
  'RESET',
  'CREATE',
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CALL',
  'GRANT',
  'REVOKE',
];

const MUST_START_WITH = /^\s*(SELECT|WITH)\b/i;

/**
 * @returns a member-facing reason to refuse, or null if the statement may run.
 */
export function guardStatement(sql: string): string | null {
  const bare: string = stripLiteralsAndComments(sql);

  if (bare.trim() === '') {
    return 'Empty query. Send a single read-only SELECT or WITH statement.';
  }

  // Split on semicolons in code, not in strings. One trailing empty piece is
  // the allowed trailing semicolon; anything else is a second statement.
  const pieces: string[] = bare.split(';');
  const nonEmpty: string[] = pieces.filter((piece) => piece.trim() !== '');
  if (nonEmpty.length > 1) {
    return 'Send one statement at a time. Multiple statements separated by `;` are not allowed.';
  }
  if (pieces.length > 2) {
    return 'Send one statement at a time. Multiple statements separated by `;` are not allowed.';
  }

  if (!MUST_START_WITH.test(bare)) {
    return 'Only read-only queries are allowed. Start with SELECT or WITH.';
  }

  for (const keyword of FORBIDDEN) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(bare)) {
      return `\`${keyword}\` is not allowed. This database is read-only — use SELECT or WITH.`;
    }
  }

  return null;
}

/**
 * Remove string literals and comments so the guard reasons about statement
 * structure rather than about text the query happens to contain.
 */
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "''") // single-quoted strings
    .replace(/"(?:""|[^"])*"/g, '""') // quoted identifiers
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // block comments
}

interface Materialized {
  readonly connection: DuckDBConnection;
  readonly tables: string[];
  readonly dataDir: string;
  readonly builtFrom: number;
}

let current: Materialized | null = null;

/** Drop the in-memory database, so the next query rebuilds it. */
export function resetSqlDatabase(): void {
  current = null;
}

export async function tableNames(dataDir: string = ASK.DATA_DIR): Promise<string[]> {
  return (await database(dataDir)).tables;
}

export async function runSql(sql: string, dataDir: string = ASK.DATA_DIR): Promise<SqlResult> {
  const refusal: string | null = guardStatement(sql);
  if (refusal !== null) throw new Error(refusal);

  const { connection } = await database(dataDir);

  // One row past the cap, so truncation is detected rather than guessed at.
  const limited = `SELECT * FROM (${sql.replace(/;\s*$/, '')}) LIMIT ${ASK.SQL_ROW_LIMIT + 1}`;

  const timer = setTimeout(() => connection.interrupt(), ASK.SQL_TIMEOUT_MS);
  try {
    const reader = await connection.runAndReadAll(limited);
    // getRowObjectsJson converts DuckDB's own value types -- BIGINT, DECIMAL,
    // DATE, STRUCT, LIST -- into plain JSON. Without it a count comes back as a
    // JS BigInt that JSON.stringify throws on, and a struct as {entries: ...}.
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    const truncated: boolean = rows.length > ASK.SQL_ROW_LIMIT;
    return { rows: truncated ? rows.slice(0, ASK.SQL_ROW_LIMIT) : rows, truncated };
  } finally {
    clearTimeout(timer);
  }
}

/** Rebuilt whenever the shred changes, detected through INDEX.md's mtime. */
async function database(dataDir: string): Promise<Materialized> {
  const stamp: number = shredStamp(dataDir);
  if (current !== null && current.dataDir === dataDir && current.builtFrom === stamp) {
    return current;
  }

  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  const tables: string[] = [];

  for (const [table, source] of queryableSources(dataDir)) {
    try {
      await connection.run(
        `CREATE TABLE ${table} AS SELECT * FROM read_json_auto('${source.replace(/'/g, "''")}', union_by_name = true)`
      );
      tables.push(table);
    } catch (error: unknown) {
      // A body that is not table-shaped is not an error -- it is simply not a
      // table. The agent can still Read the file.
      console.warn(`[ASK] sql: skipping ${source} (${(error as Error).message.split('\n')[0]})`);
    }
  }

  await connection.run('SET enable_external_access=false');
  await connection.run('SET lock_configuration=true');

  current = { connection, tables: tables.sort(), dataDir, builtFrom: stamp };
  return current;
}

/**
 * Every shredded file becomes a table named `<directory>_<file>`, plus the 14
 * team files as one `teams` table and the cached decade as `wpfl_*`. Uniform
 * and generated, so a new body in the artifact becomes a queryable table with
 * no code change and no name collision.
 */
function queryableSources(dataDir: string): [string, string][] {
  const sources: [string, string][] = [];

  const teams: string = path.join(dataDir, 'teams');
  if (fs.existsSync(teams)) sources.push(['teams', path.join(teams, '*.json')]);

  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      sources.push([tableName(null, entry.name), path.join(dataDir, entry.name)]);
      continue;
    }
    if (!entry.isDirectory() || entry.name === 'teams') continue;

    for (const file of fs.readdirSync(path.join(dataDir, entry.name))) {
      if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
      sources.push([tableName(entry.name, file), path.join(dataDir, entry.name, file)]);
    }
  }

  return sources;
}

function tableName(directory: string | null, file: string): string {
  const base: string = file.replace(/\.jsonl?$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  return directory === null ? base : `${directory}_${base}`;
}

function shredStamp(dataDir: string): number {
  const index: string = path.join(dataDir, 'INDEX.md');
  return fs.existsSync(index) ? fs.statSync(index).mtimeMs : 0;
}

export const sqlTool: SdkMcpToolDefinition<{ query: z.ZodString }> = tool(
  'sql',
  `Read-only SQL (DuckDB) over every WPFL dataset. This is the only way to reach ten years of rows: wpfl_draft_history (every auction pick 2010-2025), wpfl_matchups (every head-to-head result), and wpfl_player_scores (~36,000 weekly player scores 2015-2025). Join those to the 2026 draft artifact, whose bodies are tables too — teams, league_board, league_dossiers, league_standings, history_seasons, history_skill_luck, night_spend_race, news_players and the rest, one table per shredded file named <directory>_<file>. Run \`SELECT table_name FROM information_schema.tables\` to see them all, or DESCRIBE <table> for its columns. One statement, SELECT or WITH only; integers come back as strings to keep full precision. Results are capped at ${ASK.SQL_ROW_LIMIT} rows — aggregate rather than asking for everything.`,
  { query: z.string().describe('A single read-only SELECT or WITH statement.') },
  async (args): Promise<CallToolResult> => {
    const result: SqlResult = await runSql(args.query);
    const notice: string = result.truncated
      ? `\n\n(Truncated at ${ASK.SQL_ROW_LIMIT} rows. Narrow the query or aggregate.)`
      : '';
    return {
      content: [
        {
          type: 'text',
          text:
            result.rows.length === 0
              ? 'No rows.'
              : `${JSON.stringify(result.rows, null, 1)}${notice}`,
        },
      ],
    };
  },
  { alwaysLoad: true }
);
