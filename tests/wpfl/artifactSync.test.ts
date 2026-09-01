import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeEtag,
  ensureFresh,
  type SyncOutcome,
  type SyncDeps,
} from '../../wpfl/artifactSync.js';
import type { FetchFn, HttpResponse, HistoryCacheResult } from '../../wpfl/historyCache.js';

const FIXTURE: string = path.join(process.cwd(), 'tests/fixtures/postdraft-published.json');

// artifactSync is not in the design's mandatory red-green table -- it is I/O
// orchestration. These tests cover the two parts that measurably can break:
// etag normalization (Cloudflare returns a weak etag on a compressed response
// and a strong one otherwise, so the raw strings differ for the same build)
// and the swap, which must never leave a partial shred readable.
describe('artifactSync', () => {
  describe('normalizeEtag', () => {
    test('strips the weak-validator prefix so the same build compares equal', () => {
      expect(normalizeEtag('W/"75c67b38"')).toBe('75c67b38');
      expect(normalizeEtag('"75c67b38"')).toBe('75c67b38');
      expect(normalizeEtag('75c67b38')).toBe('75c67b38');
    });

    test('a weak and a strong etag for one build normalize to the same value', () => {
      expect(normalizeEtag('W/"abc123"')).toBe(normalizeEtag('"abc123"'));
    });

    test('treats absent or empty as unknown', () => {
      expect(normalizeEtag(null)).toBeNull();
      expect(normalizeEtag('')).toBeNull();
      expect(normalizeEtag('W/""')).toBeNull();
    });
  });

  describe('ensureFresh', () => {
    let dataDir: string;
    let parent: string;
    let artifact: string;

    beforeEach(() => {
      parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-sync-'));
      dataDir = path.join(parent, 'wpfl-data');
      artifact = fs.readFileSync(FIXTURE, 'utf8');
    });

    afterEach(() => {
      fs.rmSync(parent, { recursive: true, force: true });
    });

    const respond = (etag: string | null, body?: string): HttpResponse => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string): string | null => (name.toLowerCase() === 'etag' ? etag : null),
      },
      json: async (): Promise<unknown> => JSON.parse(body ?? artifact),
    });

    const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({
      dataDir,
      fetchFn: (async () => respond('W/"etag-1"')) as FetchFn,
      // The real cache costs 12 s of network; the shred is what is under test.
      refreshCache: async (): Promise<HistoryCacheResult> => ({
        sources: [{ path: 'draft_history.jsonl', rows: 1, bytes: 10 }],
        fetchedAt: new Date('2026-08-31T00:00:00Z'),
        failedSeasons: [],
        failedSources: [],
      }),
      ...over,
    });

    test('shreds when there is no shred at all', async () => {
      const outcome: SyncOutcome = await ensureFresh(deps());

      expect(outcome.kind).toBe('reshredded');
      expect(fs.existsSync(path.join(dataDir, 'INDEX.md'))).toBe(true);
      expect(fs.existsSync(path.join(dataDir, 'meta.json'))).toBe(true);
      expect(fs.existsSync(path.join(dataDir, 'teams/aj-boorde.json'))).toBe(true);
      expect(fs.readFileSync(path.join(dataDir, '.etag'), 'utf8').trim()).toBe('etag-1');
    });

    test('does not touch the network while the shred is young', async () => {
      await ensureFresh(deps());

      const fetchFn = jest.fn(async () => respond('W/"etag-2"')) as unknown as FetchFn;
      const outcome: SyncOutcome = await ensureFresh(deps({ fetchFn }));

      expect(outcome.kind).toBe('fresh');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    test('matches a stored strong etag against a weak one from the wire', async () => {
      await ensureFresh(deps());
      // Simulate the previous shred having aged past the staleness window.
      const stale: number = Date.now() + 7 * 60 * 60 * 1000;

      const outcome: SyncOutcome = await ensureFresh(
        deps({
          now: () => stale,
          // curl -sI returns the strong form; node fetch returns the weak one.
          fetchFn: (async () => respond('"etag-1"')) as FetchFn,
        })
      );

      expect(outcome.kind).toBe('unchanged');
    });

    /**
     * The unchanged branch used to touch INDEX.md unconditionally. It is only
     * ever reached when INDEX.md is missing or stale, so a missing INDEX.md
     * beside a matching .etag -- an interrupted swap, or someone clearing a
     * file by hand -- made utimesSync throw ENOENT, which the outer catch
     * turned into `failed`. The etag still matched on the next call, so it
     * failed identically forever and the bot never re-shredded again.
     */
    test('re-shreds rather than wedging when INDEX.md is gone but the etag still matches', async () => {
      await ensureFresh(deps());
      fs.rmSync(path.join(dataDir, 'INDEX.md'));

      const outcome: SyncOutcome = await ensureFresh(
        deps({ fetchFn: (async () => respond('W/"etag-1"')) as FetchFn })
      );

      expect(outcome.kind).toBe('reshredded');
      expect(fs.existsSync(path.join(dataDir, 'INDEX.md'))).toBe(true);
    });

    /**
     * ensureFresh runs at the top of every /ask. Two questions arriving past
     * the staleness window would otherwise both fetch, both shred, and both
     * swap -- and swap() renames the live directory out from under any agent
     * whose cwd is it, then fails when the second rename lands on a directory
     * the first has already recreated.
     */
    test('collapses concurrent callers onto one fetch and one swap', async () => {
      let fetches = 0;
      const fetchFn = (async (): Promise<HttpResponse> => {
        fetches += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return respond('W/"etag-1"');
      }) as FetchFn;

      const outcomes: SyncOutcome[] = await Promise.all([
        ensureFresh(deps({ fetchFn })),
        ensureFresh(deps({ fetchFn })),
        ensureFresh(deps({ fetchFn })),
      ]);

      expect(fetches).toBe(1);
      for (const outcome of outcomes) expect(outcome.kind).toBe('reshredded');
      expect(fs.existsSync(path.join(dataDir, 'INDEX.md'))).toBe(true);
      // No staging or retired directory survived the run.
      expect(fs.readdirSync(parent)).toEqual(['wpfl-data']);
    });

    test('lets a later caller sync again once the in-flight one has finished', async () => {
      await ensureFresh(deps());
      const stale: number = Date.now() + 7 * 60 * 60 * 1000;

      const outcome: SyncOutcome = await ensureFresh(
        deps({ now: () => stale, fetchFn: (async () => respond('W/"etag-2"')) as FetchFn })
      );

      expect(outcome.kind).toBe('reshredded');
    });

    /**
     * Every other fetch in the feature (historyCache, wpflApiTools) carries an
     * AbortController and WPFL_FETCH_TIMEOUT_MS. This one did not, so a hung
     * connection to pages.dev stalled /ask indefinitely -- after deferReply,
     * with no ticker posted yet and nothing on screen.
     */
    test('gives up on a hung artifact host instead of stalling the question', async () => {
      const fetchFn = ((_url: string, init?: { signal?: AbortSignal }): Promise<HttpResponse> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as FetchFn;

      const outcome: SyncOutcome = await ensureFresh(deps({ fetchFn, timeoutMs: 25 }));

      expect(outcome.kind).toBe('failed');
      expect((outcome as { reason: string }).reason).toMatch(/timed out/i);
    });

    test('passes an abort signal to the artifact fetch', async () => {
      let signal: AbortSignal | undefined;
      const fetchFn = (async (
        _url: string,
        init?: { signal?: AbortSignal }
      ): Promise<HttpResponse> => {
        signal = init?.signal;
        return respond('W/"etag-1"');
      }) as FetchFn;

      await ensureFresh(deps({ fetchFn }));

      expect(signal).toBeInstanceOf(AbortSignal);
    });

    test('reshreds when the etag has actually changed', async () => {
      await ensureFresh(deps());
      const stale: number = Date.now() + 7 * 60 * 60 * 1000;

      const outcome: SyncOutcome = await ensureFresh(
        deps({ now: () => stale, fetchFn: (async () => respond('W/"etag-2"')) as FetchFn })
      );

      expect(outcome.kind).toBe('reshredded');
      expect(fs.readFileSync(path.join(dataDir, '.etag'), 'utf8').trim()).toBe('etag-2');
    });

    test('carries the previous WPFL cache across the swap', async () => {
      await ensureFresh(deps());
      const cacheFile: string = path.join(dataDir, 'wpfl', 'player_scores.jsonl');
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, '{"kept":true}\n');

      const stale: number = Date.now() + 7 * 60 * 60 * 1000;
      await ensureFresh(
        deps({ now: () => stale, fetchFn: (async () => respond('W/"etag-2"')) as FetchFn })
      );

      expect(fs.readFileSync(cacheFile, 'utf8')).toBe('{"kept":true}\n');
    });

    test('a refreshed cache file wins over the previous one', async () => {
      // The carry-across above only proves that a file the refresh did not
      // write survives. This proves the other half: what the refresh *did*
      // write is not then clobbered by the previous copy. The sync used to
      // copy the whole ~9.3 MB cache in before refreshing and overwrite all of
      // it; it now refreshes first and copies back only what is missing, so
      // getting that order backwards is the regression to catch.
      await ensureFresh(deps());
      const cacheFile: string = path.join(dataDir, 'wpfl', 'player_scores.jsonl');
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, '{"stale":true}\n');

      const stale: number = Date.now() + 7 * 60 * 60 * 1000;
      await ensureFresh(
        deps({
          now: () => stale,
          fetchFn: (async () => respond('W/"etag-2"')) as FetchFn,
          refreshCache: async (target: string): Promise<HistoryCacheResult> => {
            fs.mkdirSync(target, { recursive: true });
            fs.writeFileSync(path.join(target, 'player_scores.jsonl'), '{"fresh":true}\n');
            return {
              sources: [{ path: 'player_scores.jsonl', rows: 1, bytes: 16 }],
              fetchedAt: new Date('2026-09-01T00:00:00Z'),
              failedSeasons: [],
              failedSources: [],
            };
          },
        })
      );

      expect(fs.readFileSync(cacheFile, 'utf8')).toBe('{"fresh":true}\n');
    });

    describe('a failure leaves the previous shred serving', () => {
      test('reports a fetch failure without throwing and keeps the old shred', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        await ensureFresh(deps());
        const before: string = fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8');
        const stale: number = Date.now() + 7 * 60 * 60 * 1000;

        const outcome: SyncOutcome = await ensureFresh(
          deps({
            now: () => stale,
            fetchFn: (async () => {
              throw new Error('network down');
            }) as FetchFn,
          })
        );

        expect(outcome.kind).toBe('failed');
        expect(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8')).toBe(before);
        error.mockRestore();
      });

      test('keeps the old shred when the new artifact is missing a required body', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        await ensureFresh(deps());
        const before: string = fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8');
        const stale: number = Date.now() + 7 * 60 * 60 * 1000;

        const broken: Record<string, unknown> = JSON.parse(artifact) as Record<string, unknown>;
        delete broken.teams;

        const outcome: SyncOutcome = await ensureFresh(
          deps({
            now: () => stale,
            fetchFn: (async () => respond('W/"etag-3"', JSON.stringify(broken))) as FetchFn,
          })
        );

        expect(outcome.kind).toBe('failed');
        expect(fs.existsSync(path.join(dataDir, 'teams/aj-boorde.json'))).toBe(true);
        expect(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8')).toBe(before);
        // The etag must not advance, or the next run would think it is current.
        expect(fs.readFileSync(path.join(dataDir, '.etag'), 'utf8').trim()).toBe('etag-1');
        error.mockRestore();
      });

      test('leaves no temporary directory behind after a failure', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        await ensureFresh(deps());
        const stale: number = Date.now() + 7 * 60 * 60 * 1000;

        await ensureFresh(
          deps({
            now: () => stale,
            fetchFn: (async () => {
              throw new Error('network down');
            }) as FetchFn,
          })
        );

        expect(fs.readdirSync(parent)).toEqual(['wpfl-data']);
        error.mockRestore();
      });
    });
  });
});
