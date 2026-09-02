import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  refreshWpflCache,
  cacheExtents,
  type FetchFn,
  type HttpResponse,
  type HistoryCacheResult,
} from '../../wpfl/historyCache.js';

type Row = Record<string, unknown>;

/** Records every URL asked for and answers from a per-endpoint script. */
function fakeFetch(
  answer: (url: URL) => { status?: number; rows?: Row[]; throws?: boolean },
  seen: string[] = []
): FetchFn {
  return async (input: string): Promise<HttpResponse> => {
    seen.push(input);
    const url: URL = new URL(input);
    const planned = answer(url);
    if (planned.throws === true) throw new Error('network down');
    const status: number = planned.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async (): Promise<unknown> => planned.rows ?? [],
    };
  };
}

const rows = (n: number, tag: string): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, tag }));

describe('historyCache', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-wpfl-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const lines = (name: string): string[] =>
    fs.readFileSync(path.join(dir, name), 'utf8').trimEnd().split('\n');

  describe('what it fetches', () => {
    test('asks each endpoint for the range it covers, one request per player-scores season', async () => {
      const seen: string[] = [];
      await refreshWpflCache(
        dir,
        fakeFetch(() => ({ rows: rows(2, 'x') }), seen),
        2026
      );

      const draft: string | undefined = seen.find((u) => u.includes('/draft/history'));
      const matchups: string | undefined = seen.find((u) => u.includes('fantasyMatchupWinners'));
      const scores: string[] = seen.filter((u) => u.includes('/playerscores'));

      expect(draft).toContain('seasonMin=2010');
      expect(draft).toContain('seasonMax=2026');
      expect(matchups).toContain('seasonMin=2010');
      expect(matchups).toContain('seasonMax=2026');

      // Player scores start in 2015 and are fetched a season at a time.
      expect(scores).toHaveLength(2026 - 2015 + 1);
      expect(scores.some((u) => u.includes('seasonMin=2015') && u.includes('seasonMax=2015'))).toBe(
        true
      );
      expect(scores.some((u) => u.includes('seasonMin=2026') && u.includes('seasonMax=2026'))).toBe(
        true
      );
    });
  });

  describe('concurrency', () => {
    test('issues every request together rather than one after another', async () => {
      // The whole point of the refresh being parallel. Sequentially these 13
      // requests measured 26-70 s against the live API, and every second is
      // paid inside the /ask that triggered the reshred, after deferReply.
      let inFlight = 0;
      let peak = 0;
      const release: (() => void)[] = [];

      const fetchFn: FetchFn = async (): Promise<HttpResponse> => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight -= 1;
        return { ok: true, status: 200, json: async (): Promise<unknown> => [] };
      };

      const done = refreshWpflCache(dir, fetchFn, 2017);
      // Let every fetch that is going to start, start.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const started: number = peak;
      for (const resolve of release) resolve();
      await done;

      // draft history + matchups + one per season 2015-2017 = 5.
      expect(started).toBe(5);
    });
  });

  describe('jsonl output', () => {
    test('writes one line per row, per source', async () => {
      const result: HistoryCacheResult = await refreshWpflCache(
        dir,
        fakeFetch((url) => {
          if (url.pathname.includes('draft/history')) return { rows: rows(7, 'draft') };
          if (url.pathname.includes('fantasyMatchupWinners')) return { rows: rows(5, 'match') };
          return { rows: rows(3, 'score') };
        }),
        2016
      );

      expect(lines('draft_history.jsonl')).toHaveLength(7);
      expect(lines('matchups.jsonl')).toHaveLength(5);
      // Two seasons, 2015 and 2016, three rows each.
      expect(lines('player_scores.jsonl')).toHaveLength(6);

      const counts: Record<string, number> = Object.fromEntries(
        result.sources.map((s) => [s.path, s.rows])
      );
      expect(counts['draft_history.jsonl']).toBe(7);
      expect(counts['matchups.jsonl']).toBe(5);
      expect(counts['player_scores.jsonl']).toBe(6);
    });

    test('every line is a self-contained JSON record', async () => {
      await refreshWpflCache(
        dir,
        fakeFetch(() => ({ rows: rows(4, 'x') })),
        2015
      );

      for (const line of lines('draft_history.jsonl')) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    test('records when it fetched, both in the result and on disk', async () => {
      const result: HistoryCacheResult = await refreshWpflCache(
        dir,
        fakeFetch(() => ({ rows: rows(1, 'x') })),
        2015
      );

      expect(result.fetchedAt).toBeInstanceOf(Date);
      expect(fs.existsSync(path.join(dir, '.fetched'))).toBe(true);
      expect(fs.readFileSync(path.join(dir, '.fetched'), 'utf8')).toContain(
        result.fetchedAt.toISOString().slice(0, 10)
      );
    });

    test('an empty season is not a failure -- the API returns [] for a season not yet played', async () => {
      const result: HistoryCacheResult = await refreshWpflCache(
        dir,
        fakeFetch((url) =>
          url.searchParams.get('seasonMin') === '2016' ? { rows: [] } : { rows: rows(2, 'x') }
        ),
        2016
      );

      expect(result.failedSeasons).toEqual([]);
      expect(lines('player_scores.jsonl')).toHaveLength(2);
    });
  });

  /**
   * INDEX.md stopped saying "the history API stops at 2025" and says instead
   * where each table's rows actually end. Read from the files on disk, so a
   * source carried over from a previous cache is described as accurately as
   * one fetched this run (log Stage 14, decision 11).
   */
  describe('cacheExtents', () => {
    test("reports each source's season range and the latest week of its newest season", () => {
      fs.writeFileSync(
        path.join(dir, 'matchups.jsonl'),
        [
          '{"week":"1","season":"2015","teamA":"a"}',
          '{"week":"17","season":"2024","teamA":"a"}',
          '{"week":"3","season":"2025","teamA":"a"}',
          '{"week":"2","season":"2025","teamA":"a"}',
        ].join('\n') + '\n'
      );
      fs.writeFileSync(
        path.join(dir, 'draft_history.jsonl'),
        ['{"owner":"x","season":2010}', '{"owner":"x","season":2025}'].join('\n') + '\n'
      );

      const extents = cacheExtents(dir);

      expect(extents['matchups.jsonl']).toEqual({
        seasonMin: 2015,
        seasonMax: 2025,
        latestWeek: 3,
      });
      expect(extents['draft_history.jsonl']).toEqual({
        seasonMin: 2010,
        seasonMax: 2025,
        latestWeek: null,
      });
    });

    test('accepts season and week as strings or numbers, as the three sources differ', () => {
      fs.writeFileSync(
        path.join(dir, 'player_scores.jsonl'),
        ['{"week":1,"season":2015}', '{"week":18,"season":2025}'].join('\n') + '\n'
      );

      expect(cacheExtents(dir)['player_scores.jsonl']).toEqual({
        seasonMin: 2015,
        seasonMax: 2025,
        latestWeek: 18,
      });
    });

    test('omits a source whose file is absent or empty', () => {
      fs.writeFileSync(path.join(dir, 'matchups.jsonl'), '\n');

      expect(cacheExtents(dir)).toEqual({});
    });
  });

  describe('a failed fetch leaves the previous cache intact', () => {
    test('does not clobber player_scores.jsonl when one season fails, and names the season', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      fs.writeFileSync(path.join(dir, 'player_scores.jsonl'), '{"previous":true}\n');

      const result: HistoryCacheResult = await refreshWpflCache(
        dir,
        fakeFetch((url) =>
          url.pathname.includes('playerscores') && url.searchParams.get('seasonMin') === '2016'
            ? { status: 502 }
            : { rows: rows(2, 'x') }
        ),
        2016
      );

      expect(result.failedSeasons).toEqual([2016]);
      expect(lines('player_scores.jsonl')).toEqual(['{"previous":true}']);
      error.mockRestore();
    });

    test('still writes the sources that succeeded', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result: HistoryCacheResult = await refreshWpflCache(
        dir,
        fakeFetch((url) =>
          url.pathname.includes('playerscores') ? { status: 500 } : { rows: rows(3, 'x') }
        ),
        2015
      );

      expect(fs.existsSync(path.join(dir, 'draft_history.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'matchups.jsonl'))).toBe(true);
      expect(result.failedSources).toContain('player_scores.jsonl');
      error.mockRestore();
    });

    test('does not clobber a source whose own fetch threw', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      fs.writeFileSync(path.join(dir, 'draft_history.jsonl'), '{"previous":true}\n');

      const result: HistoryCacheResult = await refreshWpflCache(
        dir,
        fakeFetch((url) =>
          url.pathname.includes('draft/history') ? { throws: true } : { rows: rows(1, 'x') }
        ),
        2015
      );

      expect(result.failedSources).toContain('draft_history.jsonl');
      expect(lines('draft_history.jsonl')).toEqual(['{"previous":true}']);
      error.mockRestore();
    });

    test('reports a total failure without throwing, so a stale cache still serves', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result: HistoryCacheResult = await refreshWpflCache(
        dir,
        fakeFetch(() => ({ throws: true })),
        2015
      );

      expect(result.failedSources).toHaveLength(3);
      expect(result.sources).toEqual([]);
      error.mockRestore();
    });
  });
});
