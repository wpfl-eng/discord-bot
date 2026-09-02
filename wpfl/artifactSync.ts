/**
 * Fetch the published artifact, shred it, and swap the result into place.
 *
 * No timers anywhere. This runs once on `ready` and again at the top of every
 * /ask; whoever asks the first question after a stale window pays a second or
 * two. A failed fetch is non-fatal -- the previous shred stays valid and the
 * run continues on slightly older data, whose as-of dates INDEX.md and the
 * answer footer both report honestly (design §3.5).
 */

import fs from 'node:fs';
import path from 'node:path';
import { ASK } from '../ask/askConfig.js';
import { shred, type ShredResult } from './shredder.js';
import { generateIndex } from './indexGenerator.js';
import {
  refreshWpflCache,
  cacheExtents,
  type FetchFn,
  type HistoryCacheResult,
} from './historyCache.js';
import { retireShred } from './liveShred.js';
import { logError } from '../errors/errorHandler.js';

export type SyncOutcome =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'reshredded'; readonly files: number; readonly etag: string | null }
  | { readonly kind: 'failed'; readonly reason: string };

export interface SyncDeps {
  readonly dataDir?: string;
  readonly fetchFn?: FetchFn;
  readonly now?: () => number;
  readonly refreshCache?: typeof refreshWpflCache;
  /** Overridden in tests; defaults to ASK.WPFL_FETCH_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /**
   * Skip every freshness window and the etag short-circuit: fetch, shred and
   * refresh the cache now. For /ask-admin resync, after draft-2026's Tuesday
   * republish. A forced call that finds a sync already in flight joins it.
   */
  readonly force?: boolean;
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

/**
 * One sync at a time, per data directory.
 *
 * ensureFresh runs at the top of every /ask and again on `ready`. Two questions
 * arriving past the staleness window would otherwise both fetch, both shred and
 * both swap -- twice the work, two retired directories where one belongs, and
 * the second rename landing on a directory the first has already recreated.
 * Later callers join the in-flight sync and get its outcome.
 */
const inFlight = new Map<string, Promise<SyncOutcome>>();

export async function ensureFresh(deps: SyncDeps = {}): Promise<SyncOutcome> {
  const key: string = deps.dataDir ?? ASK.DATA_DIR;
  const running: Promise<SyncOutcome> | undefined = inFlight.get(key);
  if (running !== undefined) return running;

  const started: Promise<SyncOutcome> = sync(deps).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

async function sync(deps: SyncDeps): Promise<SyncOutcome> {
  const dataDir: string = deps.dataDir ?? ASK.DATA_DIR;
  const fetchFn: FetchFn = deps.fetchFn ?? fetch;
  const now: () => number = deps.now ?? Date.now;
  const refreshCache: typeof refreshWpflCache = deps.refreshCache ?? refreshWpflCache;

  const force: boolean = deps.force === true;

  const index: string = path.join(dataDir, 'INDEX.md');
  if (!force && fs.existsSync(index) && now() - fs.statSync(index).mtimeMs < ASK.STALE_AFTER_MS) {
    return { kind: 'fresh' };
  }

  // Every other fetch in this feature carries a deadline; this one used not to,
  // so a hung artifact host stalled the question that triggered it -- after
  // deferReply, with nothing yet on screen.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? ASK.WPFL_FETCH_TIMEOUT_MS);

  let response: Awaited<ReturnType<FetchFn>>;
  let artifact: unknown;
  let etag: string | null;
  try {
    response = await fetchFn(ASK.ARTIFACT_URL, { signal: controller.signal });
    if (!response.ok) {
      return failed(`the artifact URL returned HTTP ${response.status}`);
    }
    etag = normalizeEtag(response.headers?.get('etag'));

    // The etag alone is not enough to short-circuit on: this branch is only
    // reached when INDEX.md is missing or stale, and touching a file that is
    // not there threw ENOENT into the catch below. The etag matched again on
    // the next call, so it failed identically forever and nothing re-shredded.
    //
    // Nor is an unchanged artifact enough on its own any more. The decade
    // cache has a window of its own, and when it has lapsed the full path
    // runs even though the artifact is the same build: a second's download
    // and a five-millisecond shred, against the thirteen fetches that are the
    // point. The cache used to refresh only when draft-2026 republished.
    if (
      !force &&
      etag !== null &&
      etag === lastSeenEtag(dataDir) &&
      fs.existsSync(index) &&
      cacheIsFresh(dataDir, now())
    ) {
      // Same build. Touch INDEX.md so the staleness window restarts rather
      // than re-checking on every question for the next six hours.
      fs.utimesSync(index, new Date(), new Date());
      return { kind: 'unchanged' };
    }

    artifact = await response.json();
  } catch (error: unknown) {
    const timedOut: boolean = error instanceof Error && error.name === 'AbortError';
    return failed(timedOut ? `the artifact fetch timed out` : String(error));
  } finally {
    clearTimeout(timeout);
  }

  // Build the whole new tree beside the live one and swap at the end, so a
  // partial shred is never readable and a failure anywhere leaves the previous
  // shred serving.
  const staging: string = `${dataDir}.new-${process.pid}-${Date.now()}`;
  try {
    const result: ShredResult = shred(artifact, staging);

    // Refresh first, then bring across only what the refresh did not write.
    //
    // This used to copy the whole previous cache into staging *before* the
    // refresh and then overwrite every file in it -- ~9.3 MB read and written
    // synchronously on the event loop (measured: player_scores.jsonl alone is
    // 8.4 MB), of which the happy path discards 100%. The copy was only ever
    // there to preserve a source whose fetch failed, and that is what this
    // preserves, at zero bytes when nothing failed.
    const previousCache: string = path.join(dataDir, 'wpfl');
    const stagedCache: string = path.join(staging, 'wpfl');
    const cache: HistoryCacheResult = await refreshCache(stagedCache);
    if (fs.existsSync(previousCache)) {
      for (const name of fs.readdirSync(previousCache)) {
        const target: string = path.join(stagedCache, name);
        if (!fs.existsSync(target)) {
          fs.cpSync(path.join(previousCache, name), target, { recursive: true });
        }
      }
    }

    // What is on disk after the copy-back, not what the refresh set out to
    // fetch: a source whose fetch failed may still be served from the previous
    // cache, and one that was never fetched at all must not be advertised.
    const cacheFiles: string[] = fs.existsSync(stagedCache) ? fs.readdirSync(stagedCache) : [];

    fs.writeFileSync(
      path.join(staging, 'INDEX.md'),
      generateIndex({
        shred: result,
        artifact,
        etag,
        wpflCacheFetchedAt: cache.sources.length > 0 ? cache.fetchedAt : null,
        wpflCacheFiles: cacheFiles,
        // Read from the files after the copy-back, so a carried-over source
        // is described as accurately as one fetched this run.
        wpflCacheExtents: cacheExtents(stagedCache),
      })
    );
    if (etag !== null) fs.writeFileSync(path.join(staging, '.etag'), `${etag}\n`);

    swap(dataDir, staging);
    return { kind: 'reshredded', files: result.files.length, etag };
  } catch (error: unknown) {
    fs.rmSync(staging, { recursive: true, force: true });
    return failed(String(error));
  }
}

/**
 * Retired directories this process has not deleted yet, so the sweep below can
 * tell its own deferred teardown from a previous process's litter.
 */
const retiring = new Set<string>();

/** Two renames on the same filesystem, so the live directory is never half-written. */
function swap(dataDir: string, staging: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    fs.renameSync(staging, dataDir);
    return;
  }

  const retired: string = `${dataDir}.old-${process.pid}-${Date.now()}`;
  fs.renameSync(dataDir, retired);
  try {
    fs.renameSync(staging, dataDir);
  } catch (error: unknown) {
    fs.renameSync(retired, dataDir);
    throw error;
  }

  // Not `rmSync` here, which is what this used to do.
  //
  // A run already in flight has this directory's *inode* as its cwd for up to
  // QUERY_TIMEOUT_MS. The rename above does not disturb it -- measured: a
  // process whose cwd is a renamed directory goes on reading its own snapshot
  // correctly. Deleting the directory is what turns its next relative read
  // into ENOENT, mid-answer. So the deletion waits for the last reader, and
  // the swap itself never does.
  retiring.add(retired);
  retireShred((): void => {
    fs.rmSync(retired, { recursive: true, force: true });
    retiring.delete(retired);
  });

  sweepLitter(dataDir);
}

/**
 * Delete abandoned staging and retired directories beside the live one.
 *
 * Deferring the teardown above means a crash between the rename and the last
 * release now strands ~10 MB on disk for good; before, the window was a single
 * synchronous call and there was nothing to sweep. Anything still owed a
 * teardown by this process is skipped, and `ensureFresh` allows only one sync
 * per directory at a time, so everything else is litter by definition.
 */
function sweepLitter(dataDir: string): void {
  const parent: string = path.dirname(dataDir);
  const prefix: string = path.basename(dataDir);

  let siblings: string[];
  try {
    siblings = fs.readdirSync(parent);
  } catch {
    return;
  }

  for (const name of siblings) {
    if (!name.startsWith(`${prefix}.old-`) && !name.startsWith(`${prefix}.new-`)) continue;
    const full: string = path.join(parent, name);
    if (retiring.has(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch (error: unknown) {
      // Housekeeping. Never fail a good shred over a directory nobody reads.
      logError('ask', `Could not sweep the abandoned shred at ${full}`, error);
    }
  }
}

/** The decade cache is fresh while its marker is inside its own window. */
function cacheIsFresh(dataDir: string, now: number): boolean {
  const marker: string = path.join(dataDir, 'wpfl', '.fetched');
  if (!fs.existsSync(marker)) return false;
  const fetchedAt: number = Date.parse(fs.readFileSync(marker, 'utf8').trim());
  return Number.isFinite(fetchedAt) && now - fetchedAt < ASK.WPFL_CACHE_STALE_AFTER_MS;
}

function lastSeenEtag(dataDir: string): string | null {
  const file: string = path.join(dataDir, '.etag');
  if (!fs.existsSync(file)) return null;
  return normalizeEtag(fs.readFileSync(file, 'utf8'));
}

function failed(reason: string): SyncOutcome {
  logError('ask', `Artifact sync failed: ${reason}. Continuing on the previous shred.`);
  return { kind: 'failed', reason };
}
