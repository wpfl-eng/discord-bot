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

/** Only what this module actually uses, so a test fake is a few lines. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  /** Present on a real Response; only artifactSync reads it (for the etag). */
  readonly headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<HttpResponse>;

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
  return { text: rows.map((row: Row): string => JSON.stringify(row)).join('\n'), rows: rows.length };
}

/** Returns null on any failure -- the caller keeps whatever is already on disk. */
async function fetchRows(
  fetchFn: FetchFn,
  endpoint: string,
  params: Record<string, number>,
  label: string
): Promise<Row[] | null> {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASK.WPFL_FETCH_TIMEOUT_MS);

  try {
    const response: HttpResponse = await fetchFn(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      logError(
        'ask',
        `WPFL cache: ${label} returned HTTP ${response.status}. Keeping the previous file.`
      );
      return null;
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      logError('ask', `WPFL cache: ${label} did not return a list. Keeping the previous file.`);
      return null;
    }
    return body;
  } catch (error: unknown) {
    const timedOut: boolean = error instanceof Error && error.name === 'AbortError';
    logError(
      'ask',
      `WPFL cache: ${label} failed (${timedOut ? 'timed out' : String(error)}). Keeping the previous file.`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
