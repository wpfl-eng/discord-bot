import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureFresh, type SyncOutcome, type SyncDeps } from '../../wpfl/artifactSync.js';
import type { HistoryCacheResult } from '../../wpfl/historyCache.js';
import type { FetchFn, HttpResponse } from '../../wpfl/wpflHttp.js';
import { liveShred } from '../../wpfl/liveShred.js';
import type { Release } from '../../ask/generations.js';
import { ASK } from '../../ask/askConfig.js';

const FIXTURE: string = path.join(process.cwd(), 'tests/fixtures/postdraft-published.json');

// artifactSync is not in the design's mandatory red-green table -- it is I/O
// orchestration. These tests cover the parts that measurably can break: the
// etag short-circuit (normalization itself is tested with wpfl/layout.ts) and
// the swap, which must never leave a partial shred readable.
describe('artifactSync', () => {
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
      // Simulate the previous shred having aged past the staleness window,
      // with the decade cache still inside its own window so that the etag
      // is the only thing deciding.
      const stale: number = Date.now() + 7 * 60 * 60 * 1000;
      fs.mkdirSync(path.join(dataDir, 'wpfl'), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'wpfl', '.fetched'),
        `${new Date(stale).toISOString()}\n`
      );

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

    /**
     * The swap renames the live directory aside and used to delete it on the
     * spot. Measured on this host: a process whose cwd is that directory reads
     * straight through the rename, and it is the delete that turns its next
     * relative read into ENOENT -- mid-answer, on a run that can last
     * QUERY_TIMEOUT_MS. The delete now waits for the reader.
     */
    describe('a run still reading the old shred', () => {
      const reshred = (at: number): Promise<SyncOutcome> =>
        ensureFresh(
          deps({ now: () => at, fetchFn: (async () => respond('W/"etag-2"')) as FetchFn })
        );

      test('keeps its directory on disk until it lets go', async () => {
        await ensureFresh(deps());
        const before: string = fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8');

        const reader: Release = liveShred.enter();
        expect((await reshred(Date.now() + 7 * 60 * 60 * 1000)).kind).toBe('reshredded');

        const retired: string[] = fs
          .readdirSync(parent)
          .filter((name: string): boolean => name.startsWith('wpfl-data.old-'));
        expect(retired).toHaveLength(1);
        // Still the whole previous shred, not a husk: this is what the running
        // agent is reading by relative path.
        expect(fs.readFileSync(path.join(parent, retired[0], 'meta.json'), 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(parent, retired[0], 'teams/aj-boorde.json'))).toBe(true);
        expect(liveShred.pending()).toBe(1);

        reader();

        expect(fs.readdirSync(parent)).toEqual(['wpfl-data']);
        expect(liveShred.pending()).toBe(0);
      });

      test('does not delay the swap', async () => {
        await ensureFresh(deps());
        const reader: Release = liveShred.enter();

        // A four-minute query must never hold up a reshred, which is why the
        // teardown is deferred rather than the swap made to wait.
        const outcome: SyncOutcome = await reshred(Date.now() + 7 * 60 * 60 * 1000);

        expect(outcome.kind).toBe('reshredded');
        expect(fs.readFileSync(path.join(dataDir, '.etag'), 'utf8').trim()).toBe('etag-2');
        reader();
      });

      /**
       * Deferring the teardown means a crash between the rename and the last
       * release strands ~10 MB on disk for good. Before, the window was one
       * synchronous call and there was nothing to sweep.
       */
      test('sweeps what an earlier process abandoned, and only that', async () => {
        await ensureFresh(deps());
        const abandonedShred: string = path.join(parent, 'wpfl-data.old-99999-1');
        const abandonedStaging: string = path.join(parent, 'wpfl-data.new-99999-2');
        fs.mkdirSync(abandonedShred);
        fs.writeFileSync(path.join(abandonedShred, 'meta.json'), '{}');
        fs.mkdirSync(abandonedStaging);

        const reader: Release = liveShred.enter();
        await reshred(Date.now() + 7 * 60 * 60 * 1000);

        expect(fs.existsSync(abandonedShred)).toBe(false);
        expect(fs.existsSync(abandonedStaging)).toBe(false);
        // The one this process still owes a teardown is not litter.
        expect(
          fs
            .readdirSync(parent)
            .filter((name: string): boolean => name.startsWith('wpfl-data.old-'))
        ).toHaveLength(1);

        reader();
        expect(fs.readdirSync(parent)).toEqual(['wpfl-data']);
      });
    });

    /**
     * The decade cache used to refresh only when the artifact's etag changed,
     * so in season its 2026 rows appeared exactly as often as draft-2026 was
     * republished, and never otherwise. It now has a window of its own: an
     * unchanged etag is only "unchanged" while the cache is also fresh (log
     * Stage 14, decision 11).
     */
    describe('the decade cache has its own window', () => {
      const cacheMarker = (): string => path.join(dataDir, 'wpfl', '.fetched');
      const cacheAt = (iso: string): void => {
        fs.mkdirSync(path.dirname(cacheMarker()), { recursive: true });
        fs.writeFileSync(cacheMarker(), `${iso}\n`);
      };

      test('an unchanged etag with a fresh cache is still unchanged', async () => {
        await ensureFresh(deps());
        const stale: number = Date.now() + 7 * 60 * 60 * 1000;
        cacheAt(new Date(stale - 60 * 60 * 1000).toISOString());
        const refresh = jest.fn(async () => ({
          sources: [],
          fetchedAt: new Date(),
          failedSeasons: [],
          failedSources: [],
        }));

        const outcome: SyncOutcome = await ensureFresh(
          deps({ now: () => stale, refreshCache: refresh as never })
        );

        expect(outcome.kind).toBe('unchanged');
        expect(refresh).not.toHaveBeenCalled();
      });

      test('an unchanged etag with a stale cache takes the full path and refreshes it', async () => {
        await ensureFresh(deps());
        const stale: number = Date.now() + 7 * 60 * 60 * 1000;
        cacheAt(new Date(stale - 2 * ASK.WPFL_CACHE_STALE_AFTER_MS).toISOString());
        const refresh = jest.fn(async (target: string) => {
          fs.mkdirSync(target, { recursive: true });
          fs.writeFileSync(path.join(target, '.fetched'), `${new Date(stale).toISOString()}\n`);
          return { sources: [], fetchedAt: new Date(stale), failedSeasons: [], failedSources: [] };
        });

        const outcome: SyncOutcome = await ensureFresh(
          deps({ now: () => stale, refreshCache: refresh as never })
        );

        expect(outcome.kind).toBe('reshredded');
        expect(refresh).toHaveBeenCalledTimes(1);
      });

      test('a missing cache marker counts as stale', async () => {
        await ensureFresh(deps());
        fs.rmSync(path.join(dataDir, 'wpfl'), { recursive: true, force: true });
        const stale: number = Date.now() + 7 * 60 * 60 * 1000;

        const outcome: SyncOutcome = await ensureFresh(deps({ now: () => stale }));

        expect(outcome.kind).toBe('reshredded');
      });
    });

    /** For /ask-admin resync: skip every window, honour nothing but the fetch. */
    describe('force', () => {
      test('re-syncs a young shred with an unchanged etag', async () => {
        await ensureFresh(deps());
        const fetchFn = jest.fn(async () => respond('W/"etag-1"')) as unknown as FetchFn;

        const outcome: SyncOutcome = await ensureFresh(deps({ fetchFn, force: true }));

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(outcome.kind).toBe('reshredded');
      });

      test('still reports a failed fetch honestly', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        await ensureFresh(deps());

        const outcome: SyncOutcome = await ensureFresh(
          deps({
            force: true,
            fetchFn: (async () => {
              throw new Error('network down');
            }) as FetchFn,
          })
        );

        expect(outcome.kind).toBe('failed');
        error.mockRestore();
      });
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
