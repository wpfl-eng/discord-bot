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
      headers: { get: (name: string): string | null => (name.toLowerCase() === 'etag' ? etag : null) },
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
