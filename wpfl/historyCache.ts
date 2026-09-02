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
import { errorMessage, logError } from '../errors/errorHandler.js';
import { fetchJsonArray, type FetchFn } from './wpflHttp.js';
import { CACHE_MARKER, CACHE_SOURCES } from './layout.js';

/** Where one cached source's rows run, read from the file itself. */
export interface SourceExtents {
  readonly seasonMin: number;
  readonly seasonMax: number;
  /** The latest week present in the newest season; null for a source without weeks. */
  readonly latestWeek: number | null;
}

const {
  draftHistory: DRAFT_HISTORY,
  matchups: MATCHUPS,
  playerScores: PLAYER_SCORES,
} = CACHE_SOURCES;

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

  const [draft, matchups, ...scores] = await Promise.all([
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
    ...seasons.map(
      (season: number): Promise<string | null> =>
        fetchJsonl(
          fetchFn,
          `${ASK.WPFL_API_BASE}/playerscores`,
          { seasonMin: season, seasonMax: season },
          `${PLAYER_SCORES} (${season})`
        )
    ),
  ]);

  let wrote = false;
  const write = (name: string, parts: readonly string[]): void => {
    const body: string = `${parts.filter((part: string): boolean => part !== '').join('\n')}\n`;
    fs.writeFileSync(path.join(targetDir, name), body);
    wrote = true;
  };

  // Each source is written only if every fetch behind it succeeded. A partial
  // write would silently drop a decade of rows and the SQL tool would answer
  // from it without complaint; a source left unwritten is carried across from
  // the previous cache by the sync.
  if (draft !== null) write(DRAFT_HISTORY, [draft]);
  if (matchups !== null) write(MATCHUPS, [matchups]);
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
 * and two fields are all that is needed. The three sources disagree on
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
  return { seasonMin, seasonMax, latestWeek: latestWeekBySeason.get(seasonMax) ?? null };
}

/**
 * One source's rows as JSONL, serialised as soon as they land so the parsed
 * objects for one season become garbage while the other twelve requests are
 * still in flight rather than all being held live until the final join.
 * Player scores alone are ~38,000 objects against ~8.4 MB of text.
 *
 * @returns null on any failure -- the caller keeps whatever is already on disk.
 */
async function fetchJsonl(
  fetchFn: FetchFn,
  endpoint: string,
  params: Record<string, number>,
  label: string
): Promise<string | null> {
  try {
    const rows: unknown[] = await fetchJsonArray<unknown>(endpoint, params, fetchFn);
    return rows.map((row: unknown): string => JSON.stringify(row)).join('\n');
  } catch (error: unknown) {
    logError(
      'ask',
      `WPFL cache: ${label} failed (${errorMessage(error)}). Keeping the previous file.`
    );
    return null;
  }
}
