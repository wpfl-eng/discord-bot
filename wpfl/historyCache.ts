/**
 * Cache the WPFL history API's three row-shaped endpoints as JSONL, so the SQL
 * tool can join ten years of prices to what those players went on to score.
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
import { logError } from '../errors/errorHandler.js';
import { fetchJsonArray, type FetchFn } from './wpflHttp.js';

export type { HttpResponse, FetchFn } from './wpflHttp.js';

export interface CachedSource {
  readonly path: string;
  readonly rows: number;
  readonly bytes: number;
}

export interface HistoryCacheResult {
  readonly sources: CachedSource[];
  readonly fetchedAt: Date;
  /** Player-scores seasons whose fetch failed. An empty season is not a failure. */
  readonly failedSeasons: number[];
  /** Files left untouched because at least one of their fetches failed. */
  readonly failedSources: string[];
}

type Row = unknown;

/** Where one cached source's rows run, read from the file itself. */
export interface SourceExtents {
  readonly seasonMin: number;
  readonly seasonMax: number;
  /** The latest week present in the newest season; null for a source without weeks. */
  readonly latestWeek: number | null;
}

const DRAFT_HISTORY = 'draft_history.jsonl';
const MATCHUPS = 'matchups.jsonl';
const PLAYER_SCORES = 'player_scores.jsonl';

/**
 * @param targetDir  the `wpfl/` directory inside the shred root
 * @param seasonMax  inclusive; defaults to the season in progress. Asking for a
 *   season that has not been played yet costs one request and returns `[]`,
 *   which is cheaper than getting the boundary wrong -- but the boundary is the
 *   NFL season rather than the calendar year, so a January refresh still asks
 *   for the season actually being played.
 *
 * The thirteen requests go out together. Run one after another they took 26-70
 * seconds against the live API (measured: ~5.5 s cold, ~2 s warm, x13), and
 * every one of those seconds is paid inside the /ask that triggered the
 * reshred, after deferReply, with nothing on screen. All thirteen at once
 * returned 200 in 7.0 s wall-clock -- the host is latency-bound, not
 * throughput-bound, so concurrency is what helps and it does not throttle.
 */
export async function refreshWpflCache(
  targetDir: string,
  fetchFn: FetchFn = fetch,
  seasonMax: number = getCurrentNFLSeason()
): Promise<HistoryCacheResult> {
  fs.mkdirSync(targetDir, { recursive: true });

  const seasons: number[] = [];
  for (let season: number = ASK.PLAYER_SCORES_MIN_SEASON; season <= seasonMax; season += 1) {
    seasons.push(season);
  }

  const [draft, matchups, ...scores] = await Promise.all([
    fetchChunk(
      fetchFn,
      `${ASK.WPFL_API_BASE}/draft/history`,
      { seasonMin: ASK.HISTORY_MIN_SEASON, seasonMax },
      DRAFT_HISTORY
    ),
    fetchChunk(
      fetchFn,
      `${ASK.WPFL_API_BASE}/fantasyMatchupWinners`,
      { seasonMin: ASK.HISTORY_MIN_SEASON, seasonMax },
      MATCHUPS
    ),
    ...seasons.map(
      (season: number): Promise<Chunk | null> =>
        fetchChunk(
          fetchFn,
          `${ASK.WPFL_API_BASE}/playerscores`,
          { seasonMin: season, seasonMax: season },
          `${PLAYER_SCORES} (${season})`
        )
    ),
  ]);

  const sources: CachedSource[] = [];
  const failedSources: string[] = [];

  const write = (name: string, chunks: readonly Chunk[]): void => {
    const full: string = path.join(targetDir, name);
    const body: string = chunks
      .map((chunk: Chunk): string => chunk.text)
      .filter((text: string): boolean => text !== '')
      .join('\n');
    fs.writeFileSync(full, `${body}\n`);
    sources.push({
      path: name,
      rows: chunks.reduce((total: number, chunk: Chunk): number => total + chunk.rows, 0),
      bytes: fs.statSync(full).size,
    });
  };

  // Each source is written only if every fetch behind it succeeded. A partial
  // write would silently drop a decade of rows and the SQL tool would answer
  // from it without complaint.
  if (draft === null) failedSources.push(DRAFT_HISTORY);
  else write(DRAFT_HISTORY, [draft]);

  if (matchups === null) failedSources.push(MATCHUPS);
  else write(MATCHUPS, [matchups]);

  const failedSeasons: number[] = seasons.filter(
    (_season: number, index: number): boolean => scores[index] === null
  );
  if (failedSeasons.length > 0) failedSources.push(PLAYER_SCORES);
  else write(PLAYER_SCORES, scores as Chunk[]);

  const fetchedAt = new Date();
  if (sources.length > 0) {
    fs.writeFileSync(path.join(targetDir, '.fetched'), `${fetchedAt.toISOString()}\n`);
  }

  return { sources, fetchedAt, failedSeasons, failedSources };
}

/**
 * The season range and latest week of each cached source, from the files on
 * disk rather than from what this run fetched, so a source carried over from
 * a previous cache is described as accurately as one fetched today. This is
 * what lets INDEX.md say where the rows actually end instead of naming a
 * year that was wrong the moment the API gained a current-season row.
 *
 * A regex scan, not a parse: player scores alone are ~36,000 lines and 8 MB,
 * and two fields are all that is needed. The three sources disagree on
 * whether season and week are strings or numbers, so both forms match.
 */
export function cacheExtents(dir: string): Record<string, SourceExtents> {
  const extents: Record<string, SourceExtents> = {};
  for (const name of [DRAFT_HISTORY, MATCHUPS, PLAYER_SCORES]) {
    const file: string = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const found: SourceExtents | null = scanExtents(fs.readFileSync(file, 'utf8'));
    if (found !== null) extents[name] = found;
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
  return { seasonMin, seasonMax, latestWeek: latestWeekBySeason.get(seasonMax) ?? null };
}

/** One source's rows, already serialised. */
interface Chunk {
  readonly text: string;
  readonly rows: number;
}

/**
 * Serialise as soon as the rows land, so the parsed objects for one season
 * become garbage while the other twelve requests are still in flight rather
 * than all being held live until the final join. Player scores alone are
 * ~38,000 objects against ~8.4 MB of text.
 */
async function fetchChunk(
  fetchFn: FetchFn,
  endpoint: string,
  params: Record<string, number>,
  label: string
): Promise<Chunk | null> {
  const rows: Row[] | null = await fetchRows(fetchFn, endpoint, params, label);
  if (rows === null) return null;
  return {
    text: rows.map((row: Row): string => JSON.stringify(row)).join('\n'),
    rows: rows.length,
  };
}

/** Returns null on any failure -- the caller keeps whatever is already on disk. */
async function fetchRows(
  fetchFn: FetchFn,
  endpoint: string,
  params: Record<string, number>,
  label: string
): Promise<Row[] | null> {
  try {
    return await fetchJsonArray<Row>(endpoint, params, fetchFn);
  } catch (error: unknown) {
    const reason: string = error instanceof Error ? error.message : String(error);
    logError('ask', `WPFL cache: ${label} failed (${reason}). Keeping the previous file.`);
    return null;
  }
}
