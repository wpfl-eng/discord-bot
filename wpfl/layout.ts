/**
 * What lives where inside the data directory.
 *
 * The shred root holds INDEX.md, meta.json, the per-body directories, two
 * markers (`.etag` for the artifact build, `wpfl/.fetched` for the decade
 * cache) and the cache itself under `wpfl/`. Six modules used to spell those
 * names as literals, and two markers each had two readers that disagreed on
 * how to parse them. Every path is built here, and every marker is read here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ASK } from '../ask/askConfig.js';
import { leagueDate } from '../ask/leagueTime.js';

export const indexFile = (dataDir: string): string => path.join(dataDir, 'INDEX.md');
export const metaFile = (dataDir: string): string => path.join(dataDir, 'meta.json');
export const newsAsOfFile = (dataDir: string): string => path.join(dataDir, 'news', 'as_of.json');
export const etagFile = (dataDir: string): string => path.join(dataDir, '.etag');
export const cacheDir = (dataDir: string): string => path.join(dataDir, 'wpfl');
/** Written by the cache refresh into the cache directory; holds the ISO instant of the last fetch. */
export const CACHE_MARKER = '.fetched';
export const cacheMarker = (dataDir: string): string => path.join(cacheDir(dataDir), CACHE_MARKER);

/** The decade cache's three files, each one `sql` table. */
export const CACHE_SOURCES = {
  draftHistory: 'draft_history.jsonl',
  matchups: 'matchups.jsonl',
  playerScores: 'player_scores.jsonl',
} as const;

/**
 * The `sql` table a shredded file becomes: `<directory>_<file>`, so a new
 * body in the artifact is queryable with no code change and no collision.
 * INDEX.md derives the cache's table names from this rather than restating them.
 */
export function tableName(directory: string | null, file: string): string {
  const base: string = file.replace(/\.jsonl?$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  return directory === null ? base : `${directory}_${base}`;
}

/**
 * Cloudflare returns a weak validator (`W/"abc"`) when it serves the artifact
 * compressed and a strong one (`"abc"`) when it does not, for the same build.
 * Comparing the raw header strings would therefore never match and the
 * unchanged short-circuit would be dead. Normalize both to the bare value.
 */
export function normalizeEtag(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const bare: string = raw.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
  return bare === '' ? null : bare;
}

/** The etag of the build on disk, normalized the same way the wire's is. */
export function readEtag(dataDir: string): string | null {
  return normalizeEtag(readText(etagFile(dataDir)));
}

/** When the decade cache was last fetched, or null when it never was. */
export function readCacheFetchedAt(dataDir: string): Date | null {
  const raw: string | null = readText(cacheMarker(dataDir));
  if (raw === null) return null;
  const at: number = Date.parse(raw);
  return Number.isFinite(at) ? new Date(at) : null;
}

/** The dates the shred actually carries. Null where the shred does not say. */
export interface AsOf {
  readonly generated: string | null;
  readonly factsAsOf: string | null;
  readonly newsAsOf: string | null;
  readonly etag: string | null;
  /** A league-timezone date; the marker holds a full instant. */
  readonly cacheFetchedAt: string | null;
}

/** Read from what was written, so INDEX.md, the prompt and /ask-admin agree. */
export function readAsOf(dataDir: string = ASK.DATA_DIR): AsOf {
  const meta = readJson(metaFile(dataDir)) as { generated?: unknown; facts_as_of?: unknown } | null;
  const fetchedAt: Date | null = readCacheFetchedAt(dataDir);

  return {
    generated: asString(meta?.generated),
    factsAsOf: asString(meta?.facts_as_of),
    newsAsOf: asString(readJson(newsAsOfFile(dataDir))),
    etag: readEtag(dataDir),
    cacheFetchedAt: fetchedAt === null ? null : leagueDate(fetchedAt),
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
