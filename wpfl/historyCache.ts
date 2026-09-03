/**
 * Cache the WPFL history API's four row-shaped endpoints as JSONL, so the SQL
 * tool can join ten years of prices to what those players went on to score,
 * and what their owners then paid for at the wire.
 *
 * The shredded artifact is under 1 MB across ~40 files -- already sized for
 * Read and Grep. The WPFL decade is not: player scores alone are ~38,000 rows
 * and ~2.5M tokens. This is the only dataset that genuinely needs SQL, and the
 * design's own motivating question -- "has anyone ever paid up for a WR the way
 * I did and had it work?" -- cannot be answered without it (design §3.7).
 *
 * Refreshed on the same lazy schedule as the shred, which matters in season:
 * the WPFL API begins populating the current year as weeks complete.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ASK } from '../ask/askConfig.js';
import { getCurrentNFLSeason } from '../helpers/utils.js';
import { errorMessage, logError } from '../errors/errorHandler.js';
import { fetchJsonArray, type FetchFn } from './wpflHttp.js';
import { CACHE_MARKER, CACHE_SOURCES } from './layout.js';
import { wpflMembers, type WpflMember } from '../constants/wpflMembers.js';

/** Where one cached source's rows run, read from the file itself. */
export interface SourceExtents {
  readonly seasonMin: number;
  readonly seasonMax: number;
  /** The latest week present in the newest season; null for a source without weeks. */
  readonly latestWeek: number | null;
  /**
   * Every season's own latest week, keyed by season. Player scores stop at
   * week 13 in some seasons and 18 in others, and an answer that compared
   * "points per season" across them was comparing coverage; INDEX.md says
   * where each season stops so the agent compares per week. Empty for a
   * source without weeks.
   */
  readonly latestWeekBySeason: Readonly<Record<string, number>>;
  /** The first row's keys: what the `sql` table's columns are, read from the file rather than assumed. */
  readonly columns: readonly string[];
}

const {
  draftHistory: DRAFT_HISTORY,
  matchups: MATCHUPS,
  playerScores: PLAYER_SCORES,
  transactions: TRANSACTIONS,
} = CACHE_SOURCES;

/**
 * The columns that name an owner, per source. Enumerated rather than found by
 * matching values, so an NFL player who shares an owner's name is never
 * rewritten into the owner. `winner` and `loser` are derived below, after the
 * roster pass, and listed here for the collision pass that runs on the text.
 */
const NAME_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [DRAFT_HISTORY]: ['owner'],
  [MATCHUPS]: ['teamA', 'teamB', 'homeTeam', 'winner', 'loser'],
  [PLAYER_SCORES]: ['owner'],
  [TRANSACTIONS]: ['owner'],
};

/**
 * @param targetDir  the `wpfl/` directory inside the shred root
 * @param seasonMax  inclusive; defaults to the season in progress. Asking for a
 *   season that has not been played yet costs one request and returns `[]`,
 *   which is cheaper than getting the boundary wrong -- but the boundary is the
 *   NFL season rather than the calendar year, so a January refresh still asks
 *   for the season actually being played.
 *
 * The fourteen requests go out together. Run one after another the original
 * thirteen took 26-70 seconds against the live API (measured: ~5.5 s cold,
 * ~2 s warm, x13), and every one of those seconds is paid inside the /ask
 * that triggered the reshred, after deferReply, with nothing on screen. All
 * thirteen at once returned 200 in 7.0 s wall-clock -- the host is
 * latency-bound, not throughput-bound, so concurrency is what helps and it
 * does not throttle. Transactions are one more request of ~2,000 rows for the
 * whole history, nothing like player scores, so they are not split by season.
 *
 * Nothing is returned. What was written is on disk, which is what the sync
 * reads back and INDEX.md describes; a result object restating it had no
 * reader outside the tests.
 */
export async function refreshWpflCache(
  targetDir: string,
  fetchFn: FetchFn = fetch,
  seasonMax: number = getCurrentNFLSeason()
): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });

  const seasons: number[] = [];
  for (let season: number = ASK.PLAYER_SCORES_MIN_SEASON; season <= seasonMax; season += 1) {
    seasons.push(season);
  }

  const [draft, matchups, transactions, ...scores] = await Promise.all([
    fetchJsonl(
      fetchFn,
      `${ASK.WPFL_API_BASE}/draft/history`,
      { seasonMin: ASK.HISTORY_MIN_SEASON, seasonMax },
      DRAFT_HISTORY
    ),
    fetchJsonl(
      fetchFn,
      `${ASK.WPFL_API_BASE}/fantasyMatchupWinners`,
      { seasonMin: ASK.HISTORY_MIN_SEASON, seasonMax },
      MATCHUPS
    ),
    // From the same floor as the rest: the API has bids from 2020 and returns
    // nothing for earlier seasons, and a floor written here would be a year
    // that goes wrong the day the API back-fills one.
    fetchJsonl(
      fetchFn,
      `${ASK.WPFL_API_BASE}/transactions`,
      { seasonMin: ASK.HISTORY_MIN_SEASON, seasonMax },
      TRANSACTIONS
    ),
    ...seasons.map(
      (season: number): Promise<string | null> =>
        fetchJsonl(
          fetchFn,
          `${ASK.WPFL_API_BASE}/playerscores`,
          { seasonMin: season, seasonMax: season },
          PLAYER_SCORES,
          `${PLAYER_SCORES} (${season})`
        )
    ),
  ]);

  let wrote = false;
  const write = (name: string, parts: readonly string[]): void => {
    const joined: string = parts.filter((part: string): boolean => part !== '').join('\n');
    // On the joined text, so a collision between two seasons' spellings of
    // one owner -- fetched by separate requests -- is seen as one.
    const body: string = `${resolveCaseCollisions(joined, NAME_COLUMNS[name] ?? [])}\n`;
    fs.writeFileSync(path.join(targetDir, name), body);
    wrote = true;
  };

  // Each source is written only if every fetch behind it succeeded. A partial
  // write would silently drop a decade of rows and the SQL tool would answer
  // from it without complaint; a source left unwritten is carried across from
  // the previous cache by the sync.
  if (draft !== null) write(DRAFT_HISTORY, [draft]);
  if (matchups !== null) write(MATCHUPS, [matchups]);
  if (transactions !== null) write(TRANSACTIONS, [transactions]);
  if (scores.every((part: string | null): part is string => part !== null)) {
    write(PLAYER_SCORES, scores);
  }

  if (wrote) {
    fs.writeFileSync(path.join(targetDir, CACHE_MARKER), `${new Date().toISOString()}\n`);
  }
}

/**
 * The season range and latest week of each cached source, from the files on
 * disk rather than from what this run fetched, so a source carried over from
 * a previous cache is described as accurately as one fetched today. This is
 * what lets INDEX.md say where the rows actually end instead of naming a
 * year that was wrong the moment the API gained a current-season row. Every
 * file present gets a key -- null when it holds no rows to scan -- so what is
 * there and where its rows run are one answer.
 *
 * A regex scan, not a parse: player scores alone are ~36,000 lines and 8 MB,
 * and two fields are all that is needed. The sources disagree on
 * whether season and week are strings or numbers, so both forms match.
 */
export function cacheExtents(dir: string): Record<string, SourceExtents | null> {
  const extents: Record<string, SourceExtents | null> = {};
  for (const name of Object.values(CACHE_SOURCES)) {
    const file: string = path.join(dir, name);
    if (fs.existsSync(file)) extents[name] = scanExtents(fs.readFileSync(file, 'utf8'));
  }
  return extents;
}

const SEASON_FIELD = /"season":"?(\d{4})"?/;
const WEEK_FIELD = /"week":"?(\d+)"?/;

function scanExtents(text: string): SourceExtents | null {
  let seasonMin: number = Number.POSITIVE_INFINITY;
  let seasonMax: number = Number.NEGATIVE_INFINITY;
  const latestWeekBySeason = new Map<number, number>();

  for (const line of text.split('\n')) {
    const season: RegExpExecArray | null = SEASON_FIELD.exec(line);
    if (season === null) continue;
    const year: number = Number(season[1]);
    seasonMin = Math.min(seasonMin, year);
    seasonMax = Math.max(seasonMax, year);

    const week: RegExpExecArray | null = WEEK_FIELD.exec(line);
    if (week !== null) {
      latestWeekBySeason.set(year, Math.max(latestWeekBySeason.get(year) ?? 0, Number(week[1])));
    }
  }

  if (seasonMax === Number.NEGATIVE_INFINITY) return null;
  return {
    seasonMin,
    seasonMax,
    latestWeek: latestWeekBySeason.get(seasonMax) ?? null,
    latestWeekBySeason: Object.fromEntries(
      [...latestWeekBySeason.entries()].sort(([a], [b]): number => a - b)
    ),
    columns: firstRowKeys(text),
  };
}

/** The keys of the first JSONL line, or none when it does not parse. */
function firstRowKeys(text: string): string[] {
  const end: number = text.indexOf('\n');
  const line: string = (end === -1 ? text : text.slice(0, end)).trim();
  try {
    const row: unknown = JSON.parse(line);
    return row !== null && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : [];
  } catch {
    return [];
  }
}

/** Fields the API sends as strings on one endpoint and numbers on another. */
const NUMERIC_FIELDS: ReadonlySet<string> = new Set(['season', 'week']);
/** Codes, which a GROUP BY must see one spelling of. */
const CODE_FIELDS: ReadonlySet<string> = new Set(['playerNflPosition', 'playerNflTeam']);

/**
 * The API is inconsistent in ways that break SQL. `fantasyMatchupWinners`
 * serialises `season` and `week` as strings, so `WHERE season >= 2016` is a
 * binder error and `MAX(week)` is "9"; the older draft rows carry `"RB  "`
 * and `Pit` beside `RB` and `PIT`, so a naive GROUP BY splits a position in
 * two. Normalised once, at write time, so every table agrees with itself and
 * the agent never has to know. Exported for its test.
 */
export function normalizeRow(row: unknown): unknown {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      out[key] = value;
      continue;
    }
    const trimmed: string = value.trim();
    if (NUMERIC_FIELDS.has(key) && /^\d+$/.test(trimmed)) out[key] = Number(trimmed);
    else if (CODE_FIELDS.has(key)) out[key] = trimmed.toUpperCase();
    else out[key] = trimmed;
  }
  return out;
}

/**
 * The roster's spelling of every current owner, keyed by the lower-cased,
 * whitespace-collapsed form. The prompt calls these 14 spellings canonical;
 * this is what makes the cache obey the same list rather than a second one.
 */
const ROSTER: ReadonlyMap<string, string> = new Map(
  wpflMembers.map((member: WpflMember): [string, string] => [fold(member.owner), member.owner])
);

function fold(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The roster's spelling when the name is a current owner's in all but case and spacing; else as sent, spacing collapsed. */
function canonicalName(value: string): string {
  const collapsed: string = value.trim().replace(/\s+/g, ' ');
  return ROSTER.get(collapsed.toLowerCase()) ?? collapsed;
}

/**
 * One row as the table will hold it: the API's inconsistencies normalised,
 * the one key the API names differently from every other endpoint renamed,
 * owner names on this source's name columns canonicalised, and on matchups
 * the outcome written once rather than derived in every query. Exported for
 * its test.
 *
 * The rename rule is narrow on purpose: only a column that names the *same*
 * join key under a different spelling. `manager` is `owner`; `addedPlayer` is
 * a different role, not a different spelling, and keeps the API's name.
 */
export function shapeRow(source: string, row: unknown): unknown {
  const normalized: unknown = normalizeRow(row);
  if (!isRecord(normalized)) return normalized;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized)) {
    out[source === TRANSACTIONS && key === 'manager' ? 'owner' : key] = value;
  }
  for (const column of NAME_COLUMNS[source] ?? []) {
    const value: unknown = out[column];
    if (typeof value === 'string') out[column] = canonicalName(value);
  }
  if (source === MATCHUPS) Object.assign(out, outcome(out));
  return out;
}

/**
 * Who won a matchup, from the canonical team names. Five real matchups are
 * ties, where `>` and `>=` disagree; a tie has no winner and no loser, and
 * null is what `COUNT(winner)` and `WHERE winner = ...` both read correctly.
 */
function outcome(row: Record<string, unknown>): { winner: unknown; loser: unknown } {
  const { teamA, teamB, teamAPoints, teamBPoints } = row;
  if (typeof teamAPoints !== 'number' || typeof teamBPoints !== 'number') {
    return { winner: null, loser: null };
  }
  if (teamAPoints > teamBPoints) return { winner: teamA, loser: teamB };
  if (teamBPoints > teamAPoints) return { winner: teamB, loser: teamA };
  return { winner: null, loser: null };
}

/**
 * Within one source, spellings that differ only by case are one owner.
 *
 * The roster pass above covers the 14 current owners. This is the backstop
 * that does not depend on who is in the league: the day an owner with a case
 * variant leaves, the roster stops naming them, and without this their rows
 * would re-split on the next refresh -- today's defect, back. The
 * capitalised spelling wins, else the most frequent; a name with only one
 * spelling is left exactly as the API sent it.
 *
 * On the serialised text rather than the rows, because player scores arrive
 * one season per request and are serialised as each lands; the collision
 * between 2015's `todd ellis` and 2018's `Todd Ellis` is only visible once the
 * seasons are joined. A regex over the JSONL costs one scan and, when nothing
 * collides -- the normal case -- returns the input untouched. Exported for
 * its test.
 */
export function resolveCaseCollisions(jsonl: string, columns: readonly string[]): string {
  if (columns.length === 0 || jsonl === '') return jsonl;
  // The value as JSON.stringify wrote it, escapes and all, so what is matched
  // can be written back verbatim.
  const pattern = new RegExp(`"(${columns.join('|')})":"((?:[^"\\\\]|\\\\.)*)"`, 'g');

  const spellings = new Map<string, Map<string, number>>();
  for (const match of jsonl.matchAll(pattern)) {
    const value: string = match[2];
    const seen: Map<string, number> = spellings.get(value.toLowerCase()) ?? new Map();
    seen.set(value, (seen.get(value) ?? 0) + 1);
    spellings.set(value.toLowerCase(), seen);
  }

  const canonical = new Map<string, string>();
  for (const [key, seen] of spellings) {
    if (seen.size > 1) canonical.set(key, pickSpelling(seen));
  }
  if (canonical.size === 0) return jsonl;

  return jsonl.replace(pattern, (whole: string, column: string, value: string): string => {
    const chosen: string | undefined = canonical.get(value.toLowerCase());
    return chosen === undefined || chosen === value ? whole : `"${column}":"${chosen}"`;
  });
}

function pickSpelling(seen: ReadonlyMap<string, number>): string {
  const capitalised: string[] = [...seen.keys()].filter((spelling: string): boolean =>
    spelling.split(' ').every((word: string): boolean => /^[A-Z]/.test(word))
  );
  const pool: string[] = capitalised.length > 0 ? capitalised : [...seen.keys()];
  return pool.sort(
    (a: string, b: string): number => (seen.get(b) ?? 0) - (seen.get(a) ?? 0) || a.localeCompare(b)
  )[0];
}

/**
 * One source's rows as JSONL, serialised as soon as they land so the parsed
 * objects for one season become garbage while the other thirteen requests are
 * still in flight rather than all being held live until the final join.
 * Player scores alone are ~38,000 objects against ~8.4 MB of text.
 *
 * @param source the cache file the rows are bound for; picks their shaping.
 * @param label  names the request in the failure log; defaults to the source.
 * @returns null on any failure -- the caller keeps whatever is already on disk.
 */
async function fetchJsonl(
  fetchFn: FetchFn,
  endpoint: string,
  params: Record<string, number>,
  source: string,
  label: string = source
): Promise<string | null> {
  try {
    const rows: unknown[] = await fetchJsonArray<unknown>(endpoint, params, fetchFn);
    return rows.map((row: unknown): string => JSON.stringify(shapeRow(source, row))).join('\n');
  } catch (error: unknown) {
    logError(
      'ask',
      `WPFL cache: ${label} failed (${errorMessage(error)}). Keeping the previous file.`
    );
    return null;
  }
}
