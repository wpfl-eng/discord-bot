import { describe, test, expect } from '@jest/globals';
import {
  fetchExpectedWins,
  fetchOptimalCoaching,
  fetchDraftedPoints,
  wpflApiTools,
} from '../../wpfl/wpflApiTools.js';
import { toToolResult } from '../../wpfl/toolResult.js';
import type { FetchFn, HttpResponse } from '../../wpfl/wpflHttp.js';
import { fakeResponse, loadFixture } from './support.js';

/** Answers with a recording and remembers the URL it was asked for. */
function replay(body: unknown, seen: string[] = []): FetchFn {
  return async (url: string): Promise<HttpResponse> => {
    seen.push(url);
    return fakeResponse({ body });
  };
}

const failing =
  (status: number): FetchFn =>
  async (): Promise<HttpResponse> =>
    fakeResponse({ status });

describe('wpflApiTools', () => {
  describe('expected_wins', () => {
    const recording = loadFixture('wpfl-expected-wins.json');

    test('returns the rows the API returned, unchanged', async () => {
      const rows = await fetchExpectedWins({ seasonMin: 2024, seasonMax: 2024 }, replay(recording));

      expect(rows).toHaveLength(14);
      expect(rows[0]).toEqual({
        owner: 'AJ Boorde',
        expectedWins: 9.06,
        actualWins: 10,
        seasonMin: 2024,
        seasonMax: 2024,
        weekMin: 1,
        weekMax: 17,
      });
    });

    // Verified live: 2024 alone gives 9.06, 2025 alone 4.62, and the range
    // 2024-2025 one row of 13.68 -- the API sums, which is what the prompt's
    // never-by-hand rule needs it to do. Both bounds are required because the
    // API's own default for a missing bound is the latest season, which
    // silently widens the window.
    test('carries both season bounds, so the API sums the range itself', async () => {
      const range = loadFixture('wpfl-expected-wins-range.json');
      const seen: string[] = [];
      const rows = await fetchExpectedWins(
        { seasonMin: 2023, seasonMax: 2025 },
        replay(range, seen)
      );

      expect(seen[0]).toContain('seasonMin=2023');
      expect(seen[0]).toContain('seasonMax=2025');
      expect(seen[0]).toContain('/expectedwins');
      // One row per owner for the whole range, both bounds on the row.
      expect(rows).toHaveLength(14);
      expect(rows[0]).toMatchObject({ owner: 'AJ Boorde', seasonMin: 2023, seasonMax: 2025 });
    });

    test('passes the week window and the playoff flag through', async () => {
      const seen: string[] = [];
      await fetchExpectedWins(
        { seasonMin: 2024, seasonMax: 2024, weekMin: 3, weekMax: 5, includePlayoffs: true },
        replay(recording, seen)
      );

      expect(seen[0]).toContain('weekMin=3');
      expect(seen[0]).toContain('weekMax=5');
      expect(seen[0]).toContain('includePlayoffs=true');
    });

    test('omits the week window entirely when it was not asked for', async () => {
      const seen: string[] = [];
      await fetchExpectedWins({ seasonMin: 2024, seasonMax: 2024 }, replay(recording, seen));

      expect(seen[0]).not.toContain('weekMin');
      expect(seen[0]).not.toContain('weekMax');
    });
  });

  describe('optimal_coaching', () => {
    const recording = loadFixture('wpfl-optimal-coaching.json');

    test('returns actual against optimal points for every owner', async () => {
      const rows = await fetchOptimalCoaching({ season: 2024, week: 16 }, replay(recording));

      expect(rows).toHaveLength(14);
      expect(rows[0]).toEqual({
        owner: 'Nixon Ball',
        actualPointsFor: 1946.78,
        optimalPointsFor: 2087.62,
        season: 2024,
        week: 16,
      });
    });

    test('puts the season in the path and the week in the query', async () => {
      const seen: string[] = [];
      await fetchOptimalCoaching({ season: 2024, week: 16 }, replay(recording, seen));

      expect(seen[0]).toContain('/optimalcoaching/pointsfor/2024');
      expect(seen[0]).toContain('week=16');
    });

    test('asks for the full season when no week is given', async () => {
      const seen: string[] = [];
      await fetchOptimalCoaching({ season: 2024 }, replay(recording, seen));

      expect(seen[0]).toContain('/optimalcoaching/pointsfor/2024');
      expect(seen[0]).not.toContain('week=');
    });
  });

  describe('drafted_points', () => {
    const recording = loadFixture('wpfl-drafted-points.json');

    test('returns drafted points per owner', async () => {
      const rows = await fetchDraftedPoints(
        { seasonMin: 2024, seasonMax: 2024 },
        replay(recording)
      );

      expect(rows).toHaveLength(14);
      expect(rows[0]).toEqual({
        owner: 'Forrest Britton',
        draftedPoints: 1744.68,
        rosteredOptimalPoints: 0,
        actualPoints: 0,
      });
    });

    test('carries the season range and the week ceiling', async () => {
      const seen: string[] = [];
      await fetchDraftedPoints(
        { seasonMin: 2020, seasonMax: 2024, weekMax: 15 },
        replay(recording, seen)
      );

      expect(seen[0]).toContain('seasonMin=2020');
      expect(seen[0]).toContain('seasonMax=2024');
      expect(seen[0]).toContain('weekMax=15');
    });

    // Verified live: weeks 5-8 of 2024 return different totals from weeks 1-8,
    // so the floor is honoured server-side and a window is a real window.
    test('carries the week floor as well as the ceiling', async () => {
      const seen: string[] = [];
      await fetchDraftedPoints(
        { seasonMin: 2024, seasonMax: 2024, weekMin: 5, weekMax: 8 },
        replay(recording, seen)
      );

      expect(seen[0]).toContain('weekMin=5');
      expect(seen[0]).toContain('weekMax=8');
    });

    test('omits the week window entirely when it was not asked for', async () => {
      const seen: string[] = [];
      await fetchDraftedPoints({ seasonMin: 2024, seasonMax: 2024 }, replay(recording, seen));

      expect(seen[0]).not.toContain('weekMin');
      expect(seen[0]).not.toContain('weekMax');
    });
  });

  describe('failure', () => {
    test('throws with the status so the agent sees why, not an empty list', async () => {
      await expect(
        fetchExpectedWins({ seasonMin: 2024, seasonMax: 2024 }, failing(503))
      ).rejects.toThrow(/503/);
    });

    test('surfaces a timeout as a timeout', async () => {
      const abort: FetchFn = async (): Promise<HttpResponse> => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      };

      await expect(fetchExpectedWins({ seasonMin: 2024, seasonMax: 2024 }, abort)).rejects.toThrow(
        /timed out/i
      );
    });
  });

  describe('the MCP tool definitions', () => {
    test('exposes exactly the three computed aggregates', () => {
      expect(wpflApiTools.map((t) => t.name).sort()).toEqual([
        'drafted_points',
        'expected_wins',
        'optimal_coaching',
      ]);
    });

    // This asserted that only expected_wins rode in the initial prompt. Stage
    // 14 reversed the split: every schema loads upfront, declared once on the
    // server (tests/wpfl/mcpServer.test.ts), so no definition carries a flag.
    test('carries no alwaysLoad of its own; the server declares it for all eight', () => {
      for (const definition of wpflApiTools) {
        expect(definition._meta?.['anthropic/alwaysLoad']).toBeUndefined();
      }
    });

    test('every description warns that the API lags the season in progress, without a year', () => {
      for (const definition of wpflApiTools) {
        expect(definition.description).toMatch(/lags the live season/i);
        expect(definition.description).not.toMatch(/\b20\d\d\b/);
        expect(definition.description).toMatch(/ESPN/);
      }
    });

    test('every tool takes a season and declares a handler', () => {
      for (const definition of wpflApiTools) {
        expect(typeof definition.handler).toBe('function');
        expect(Object.keys(definition.inputSchema).length).toBeGreaterThan(0);
      }
    });

    // The parameter names are the API's own query names, so the league's
    // endpoint documentation is the tool documentation and the agent learns
    // one convention rather than one per tool.
    test('the range tools take seasonMin and seasonMax, named as the API names them', () => {
      const byName = new Map(wpflApiTools.map((t) => [t.name, Object.keys(t.inputSchema)]));

      expect(byName.get('expected_wins')).toEqual(
        expect.arrayContaining(['seasonMin', 'seasonMax', 'weekMin', 'weekMax', 'includePlayoffs'])
      );
      expect(byName.get('expected_wins')).not.toContain('season');
      expect(byName.get('drafted_points')).toEqual(
        expect.arrayContaining(['seasonMin', 'seasonMax', 'weekMin', 'weekMax'])
      );
      expect(byName.get('optimal_coaching')).toEqual(['season', 'week']);
    });

    test('expected_wins says a range comes back as one summed row per owner', () => {
      const definition = wpflApiTools.find((t) => t.name === 'expected_wins');

      expect(definition?.description).toMatch(/one row per owner/i);
      expect(definition?.description).toMatch(/per season/i);
    });

    // A range spanning departed owners returns every owner who played in it;
    // seasonMax=2024 alone returned 21. "All 14 owners" was true for one
    // season and wrong for a range.
    test('no description promises a fixed owner count', () => {
      for (const definition of wpflApiTools) {
        expect(definition.description).not.toMatch(/\b14\b/);
      }
    });

    test('optimal_coaching says its week is inclusive, and what omitting it means', () => {
      const definition = wpflApiTools.find((t) => t.name === 'optimal_coaching');

      expect(definition?.description).toMatch(/through and including/i);
      expect(definition?.description).toMatch(/omit/i);
    });

    test('drafted_points says its window is inclusive on both ends', () => {
      const definition = wpflApiTools.find((t) => t.name === 'drafted_points');

      expect(definition?.description).toMatch(/inclusive/i);
    });

    // The handlers themselves are two-line adapters over the fetch functions
    // above; testing them would mean a live call, which §13.3 keeps out of CI.
    // The part with any logic in it is the formatting, tested here directly.
    // Compact: the indentation this used to carry was a fifth of every
    // character the tools returned on the first live matchup question.
    test('rows are handed to the agent as compact JSON text', () => {
      const result = toToolResult([{ owner: 'AJ Boorde', expectedWins: 9.06 }]);

      expect(result.content[0]).toEqual({
        type: 'text',
        text: '[{"owner":"AJ Boorde","expectedWins":9.06}]',
      });
      expect(result.isError).toBeUndefined();
    });

    test('an empty result says so in words rather than returning a bare []', () => {
      const block = toToolResult([]).content[0];

      expect(block.type).toBe('text');
      expect(block.type === 'text' ? block.text : '').toMatch(/no rows/i);
    });
  });
});
