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
 * @param seasonMax  inclusive; defaults to the current year. Asking for a
 *   season that has not been played yet costs one request and returns `[]`,
 *   which is cheaper than getting the season boundary wrong every January.
 */
export async function refreshWpflCache(
  targetDir: string,
  fetchFn: FetchFn = fetch,
  seasonMax: number = new Date().getFullYear()
): Promise<HistoryCacheResult> {
  fs.mkdirSync(targetDir, { recursive: true });

  const sources: CachedSource[] = [];
  const failedSeasons: number[] = [];
  const failedSources: string[] = [];

  const write = (name: string, rows: Row[]): void => {
    const full: string = path.join(targetDir, name);
    fs.writeFileSync(full, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    sources.push({ path: name, rows: rows.length, bytes: fs.statSync(full).size });
  };

  // Each source is written only if every fetch behind it succeeded. A partial
  // write would silently drop a decade of rows and the SQL tool would answer
  // from it without complaint.
  const draft: Row[] | null = await fetchRows(
    fetchFn,
    `${ASK.WPFL_API_BASE}/draft/history`,
    { seasonMin: ASK.HISTORY_MIN_SEASON, seasonMax },
    DRAFT_HISTORY
  );
  if (draft === null) failedSources.push(DRAFT_HISTORY);
  else write(DRAFT_HISTORY, draft);

  const matchups: Row[] | null = await fetchRows(
    fetchFn,
    `${ASK.WPFL_API_BASE}/fantasyMatchupWinners`,
    { seasonMin: ASK.HISTORY_MIN_SEASON, seasonMax },
    MATCHUPS
  );
  if (matchups === null) failedSources.push(MATCHUPS);
  else write(MATCHUPS, matchups);

  const scores: Row[] = [];
  for (let season: number = ASK.PLAYER_SCORES_MIN_SEASON; season <= seasonMax; season += 1) {
    const seasonRows: Row[] | null = await fetchRows(
      fetchFn,
      `${ASK.WPFL_API_BASE}/playerscores`,
      { seasonMin: season, seasonMax: season },
      `${PLAYER_SCORES} (${season})`
    );
    if (seasonRows === null) failedSeasons.push(season);
    else scores.push(...seasonRows);
  }
  if (failedSeasons.length > 0) failedSources.push(PLAYER_SCORES);
  else write(PLAYER_SCORES, scores);

  const fetchedAt = new Date();
  if (sources.length > 0) {
    fs.writeFileSync(path.join(targetDir, '.fetched'), `${fetchedAt.toISOString()}\n`);
  }

  return { sources, fetchedAt, failedSeasons, failedSources };
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
      console.error(
        `[ASK] WPFL cache: ${label} returned HTTP ${response.status}. Keeping the previous file.`
      );
      return null;
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      console.error(`[ASK] WPFL cache: ${label} did not return a list. Keeping the previous file.`);
      return null;
    }
    return body;
  } catch (error: unknown) {
    const timedOut: boolean = error instanceof Error && error.name === 'AbortError';
    console.error(
      `[ASK] WPFL cache: ${label} failed (${timedOut ? 'timed out' : String(error)}). Keeping the previous file.`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
