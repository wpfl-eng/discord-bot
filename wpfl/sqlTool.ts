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
import { createGenerations, type Generations, type Release } from '../ask/generations.js';
import { logError } from '../errors/errorHandler.js';
import { liveShred } from './liveShred.js';
import { metaFile, tableName } from './layout.js';

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
const FORBIDDEN_WORDS: readonly string[] = [
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

/** Compiled once, not twenty times per query. */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = FORBIDDEN_WORDS.map(
  (keyword: string): readonly [string, RegExp] => [keyword, new RegExp(`\\b${keyword}\\b`, 'i')]
);

/**
 * What a statement may start with -- declared once, because the guard, the two
 * refusals, the tool description and the argument description all have to agree
 * and previously did not. The tool description told the agent to reach for
 * DESCRIBE while the guard's regex refused it; that mismatch shipped. Adding
 * EXPLAIN or SHOW here now updates every place that says so.
 *
 * All four are read-only and all four survive the `SELECT * FROM (...)` wrapper
 * the row cap uses (verified on DuckDB 1.5.5). Each still has to clear the
 * one-statement rule and the forbidden-keyword list.
 */
const READ_ONLY_STARTERS: readonly string[] = ['SELECT', 'WITH', 'DESCRIBE', 'SUMMARIZE'];

const MUST_START_WITH = new RegExp(`^\\s*(${READ_ONLY_STARTERS.join('|')})\\b`, 'i');

/** `SELECT, WITH, DESCRIBE or SUMMARIZE`, for anything a human or the agent reads. */
const STARTERS_PROSE: string = `${READ_ONLY_STARTERS.slice(0, -1).join(', ')} or ${READ_ONLY_STARTERS[READ_ONLY_STARTERS.length - 1]}`;

/**
 * @returns a member-facing reason to refuse, or null if the statement may run.
 */
export function guardStatement(sql: string): string | null {
  const bare: string = stripLiteralsAndComments(sql);

  if (bare.trim() === '') {
    return `Empty query. Send a single read-only statement starting with ${STARTERS_PROSE}.`;
  }

  // Split on semicolons in code, not in strings. One trailing empty piece is
  // the allowed trailing semicolon; anything else is a second statement.
  const pieces: string[] = bare.split(';');
  const nonEmpty: string[] = pieces.filter((piece) => piece.trim() !== '');
  // Both are reachable and neither implies the other: `SELECT 1; SELECT 2`
  // trips the first, `SELECT 1;;` only the second.
  if (nonEmpty.length > 1 || pieces.length > 2) {
    return 'Send one statement at a time. Multiple statements separated by `;` are not allowed.';
  }

  if (!MUST_START_WITH.test(bare)) {
    return `Only read-only queries are allowed. Start with ${STARTERS_PROSE}.`;
  }

  for (const [keyword, pattern] of FORBIDDEN) {
    if (pattern.test(bare)) {
      return `\`${keyword}\` is not allowed. This database is read-only — use ${STARTERS_PROSE}.`;
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
  /** `<dataDir>:<shred mtime>` -- what this database was built from. */
  readonly key: string;
}

let current: Materialized | null = null;

/**
 * Readers inside the live connection.
 *
 * The connection owns a native DuckDB instance holding the whole materialized
 * dataset and the bot process is long-lived, so a rebuild has to close the one
 * it replaces or it leaks ~11 MB of native memory per reshred. It used to close
 * it on the spot -- which is `closeSync()` under an in-flight `runAndReadAll`,
 * on whichever query happened to be running when somebody else's question
 * triggered a reshred. Retiring it instead closes it when its last reader
 * leaves, which is the same guarantee without the use-after-close.
 */
const connections: Generations = createGenerations('sql');

/** A materialized database, borrowed. It cannot be closed until `release` runs. */
interface Held {
  readonly materialized: Materialized;
  readonly release: Release;
}

/**
 * Borrow `current`, if there is one.
 *
 * The read and the borrow are one synchronous step, and that is what makes the
 * pair atomic: a rebuild can only retire `current` from another task, so it
 * cannot land between the two.
 */
function borrowCurrent(): Held | null {
  if (current === null) return null;
  return { materialized: current, release: connections.enter() };
}

/** Install a new database and retire the one it replaces. */
function install(next: Materialized): void {
  const previous: Materialized | null = current;
  current = next;
  // Assign before rotating. Both statements are in one synchronous step so
  // nothing can borrow between them either way, but this order is the one that
  // stays correct if that ever stops being true: it pairs any borrower with a
  // connection that is still open.
  connections.rotate((): void => close(previous));
}

/**
 * The build in progress, if there is one.
 *
 * MAX_CONCURRENT_QUERIES is 2, so two questions can both find the cache stale
 * and both run the whole CREATE TABLE loop over ~11 MB -- twice the work and
 * two live native instances. The second caller joins the first build.
 */
let building: Promise<void> | null = null;
let buildingKey: string | null = null;

/** Drop the in-memory database, so the next query rebuilds it. */
export function resetSqlDatabase(): void {
  const previous: Materialized | null = current;
  current = null;
  building = null;
  buildingKey = null;
  connections.rotate((): void => close(previous));
}

function close(materialized: Materialized | null): void {
  if (materialized === null) return;
  try {
    materialized.connection.closeSync();
  } catch (error: unknown) {
    console.warn('[ASK] sql: could not close the previous connection:', error);
  }
}

/** Tests only: what the shred became. */
export async function tableNames(dataDir: string = ASK.DATA_DIR): Promise<string[]> {
  const held: Held = await database(dataDir);
  try {
    return held.materialized.tables;
  } finally {
    held.release();
  }
}

/**
 * Build the database for the live shred now, in the background, so the first
 * `sql` call after a boot or a reshred does not pay the ~11 MB materialization
 * inside a member's turn. A call that arrives mid-build joins it.
 */
export function warmSqlDatabase(): void {
  database(ASK.DATA_DIR)
    .then((held: Held): void => held.release())
    .catch((error: unknown): void => {
      logError('ask', 'Could not warm the SQL database', error);
    });
}

export async function runSql(sql: string, dataDir: string = ASK.DATA_DIR): Promise<SqlResult> {
  const refusal: string | null = guardStatement(sql);
  if (refusal !== null) throw new Error(refusal);

  const held: Held = await database(dataDir);
  const { connection } = held.materialized;

  // One row past the cap, so truncation is detected rather than guessed at.
  // The newlines are load-bearing: a statement ending in a `--` comment would
  // otherwise swallow the closing paren and the LIMIT onto the same line, and
  // DuckDB reports `syntax error at end of input`.
  const limited = `SELECT * FROM (\n${sql.replace(/;\s*$/, '')}\n) LIMIT ${ASK.SQL_ROW_LIMIT + 1}`;

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
    held.release();
  }
}

/**
 * Borrow the database for this shred, building it first if it is not there.
 * Rebuilt whenever the shred changes; concurrent callers share one build.
 */
async function database(dataDir: string): Promise<Held> {
  const key = `${dataDir}:${shredStamp(dataDir)}`;

  const live: Held | null = borrowCurrent();
  if (live !== null && live.materialized.key === key) return live;
  live?.release();

  // Bounded, rather than a retry loop: each pass completes one build and then
  // borrows whatever is live -- this build, or a newer one that replaced it
  // while this caller was suspended. Either is a consistent snapshot, and
  // neither can be closed while the borrow is out. Only resetSqlDatabase(),
  // which tests call, can leave nothing to borrow at all.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await ensureBuilt(dataDir, key);
    const built: Held | null = borrowCurrent();
    if (built !== null) return built;
  }
  throw new Error('The SQL database could not be materialized.');
}

function ensureBuilt(dataDir: string, key: string): Promise<void> {
  if (building !== null && buildingKey === key) return building;

  buildingKey = key;
  building = build(dataDir, key).finally((): void => {
    if (buildingKey === key) {
      building = null;
      buildingKey = null;
    }
  });
  return building;
}

async function build(dataDir: string, key: string): Promise<void> {
  // ~11 MB read off the live shred, a file at a time. A reshred landing
  // half-way through would otherwise unlink the sources under the loop.
  const shred: Release = liveShred.enter();
  const tables: string[] = [];
  let connection: DuckDBConnection;

  try {
    const instance = await DuckDBInstance.create(':memory:');
    connection = await instance.connect();

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
  } finally {
    shred();
  }

  install({ connection, tables: tables.sort(), key });
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

/**
 * meta.json's mtime, not INDEX.md's.
 *
 * INDEX.md is the wrong file to watch: artifactSync deliberately touches it on
 * the `unchanged` path, to restart the six-hour staleness window without
 * re-fetching. Keying on it meant that up to four times a day a sync which had
 * just concluded *nothing changed* threw away the materialized database, and
 * the next question paid a full ~11 MB rebuild inside a member's turn -- the
 * exact cost the etag short-circuit exists to avoid. meta.json is written only
 * by a real shred, and the swap is a rename, which preserves the new mtime.
 */
function shredStamp(dataDir: string): number {
  return fs.statSync(metaFile(dataDir), { throwIfNoEntry: false })?.mtimeMs ?? 0;
}

export const sqlTool: SdkMcpToolDefinition<{ query: z.ZodString }> = tool(
  'sql',
  `Read-only SQL (DuckDB) over every WPFL dataset. This is the only way to reach ten years of rows: wpfl_draft_history (every auction pick since 2010), wpfl_matchups (every head-to-head result), and wpfl_player_scores (weekly player scores since 2015); INDEX.md says where each table's rows end. Join those to the 2026 draft artifact, whose bodies are tables too — teams, league_board, league_dossiers, league_standings, history_seasons, history_skill_luck, night_spend_race, news_players and the rest, one table per shredded file named <directory>_<file>. Run \`SELECT table_name FROM information_schema.tables\` to see them all, or DESCRIBE <table> for its columns. One statement, and it must start with ${STARTERS_PROSE}; integers come back as strings to keep full precision. Results are capped at ${ASK.SQL_ROW_LIMIT} rows — aggregate rather than asking for everything.`,
  { query: z.string().describe(`A single read-only statement starting with ${STARTERS_PROSE}.`) },
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
  }
);
