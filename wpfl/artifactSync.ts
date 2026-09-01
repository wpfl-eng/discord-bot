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
import { refreshWpflCache, type FetchFn, type HistoryCacheResult } from './historyCache.js';
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
 * both swap -- and swap() renames the live directory, which is the agent's own
 * cwd, out from under any run already reading it, then fails when the second
 * rename lands on a directory the first has recreated. Later callers join the
 * in-flight sync and get its outcome.
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

  const index: string = path.join(dataDir, 'INDEX.md');
  if (fs.existsSync(index) && now() - fs.statSync(index).mtimeMs < ASK.STALE_AFTER_MS) {
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
    if (etag !== null && etag === lastSeenEtag(dataDir) && fs.existsSync(index)) {
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

    // Copy rather than move: the live directory must stay complete until the
    // swap, and the cache refresh below can take ten seconds or more.
    const previousCache: string = path.join(dataDir, 'wpfl');
    if (fs.existsSync(previousCache)) {
      fs.cpSync(previousCache, path.join(staging, 'wpfl'), { recursive: true });
    }
    const cache: HistoryCacheResult = await refreshCache(path.join(staging, 'wpfl'));

    fs.writeFileSync(
      path.join(staging, 'INDEX.md'),
      generateIndex({
        shred: result,
        artifact,
        etag,
        wpflCacheFetchedAt: cache.sources.length > 0 ? cache.fetchedAt : null,
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
  fs.rmSync(retired, { recursive: true, force: true });
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
