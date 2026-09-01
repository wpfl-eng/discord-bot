import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  fetchExpectedWins,
  fetchOptimalCoaching,
  fetchDraftedPoints,
  wpflApiTools,
  toToolResult,
} from '../../wpfl/wpflApiTools.js';
import type { FetchFn, HttpResponse } from '../../wpfl/historyCache.js';

const load = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', name), 'utf8'));

/** Answers with a recording and remembers the URL it was asked for. */
function replay(body: unknown, seen: string[] = []): FetchFn {
  return async (url: string): Promise<HttpResponse> => {
    seen.push(url);
    return { ok: true, status: 200, json: async (): Promise<unknown> => body };
  };
}

const failing = (status: number): FetchFn =>
  async (): Promise<HttpResponse> => ({
    ok: false,
    status,
    json: async (): Promise<unknown> => null,
  });

describe('wpflApiTools', () => {
  describe('expected_wins', () => {
    const recording = load('wpfl-expected-wins.json');

    test('returns the rows the API returned, unchanged', async () => {
      const rows = await fetchExpectedWins({ season: 2024 }, replay(recording));

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

    test('sends the season on both bounds, since the endpoint takes a range', async () => {
      const seen: string[] = [];
      await fetchExpectedWins({ season: 2024 }, replay(recording, seen));

      expect(seen[0]).toContain('seasonMin=2024');
      expect(seen[0]).toContain('seasonMax=2024');
      expect(seen[0]).toContain('/expectedwins');
    });

    test('passes the week window and the playoff flag through', async () => {
      const seen: string[] = [];
      await fetchExpectedWins(
        { season: 2024, weekMin: 3, weekMax: 5, includePlayoffs: true },
        replay(recording, seen)
      );

      expect(seen[0]).toContain('weekMin=3');
      expect(seen[0]).toContain('weekMax=5');
      expect(seen[0]).toContain('includePlayoffs=true');
    });

    test('omits the week window entirely when it was not asked for', async () => {
      const seen: string[] = [];
      await fetchExpectedWins({ season: 2024 }, replay(recording, seen));

      expect(seen[0]).not.toContain('weekMin');
      expect(seen[0]).not.toContain('weekMax');
    });
  });

  describe('optimal_coaching', () => {
    const recording = load('wpfl-optimal-coaching.json');

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
    const recording = load('wpfl-drafted-points.json');

    test('returns drafted points per owner', async () => {
      const rows = await fetchDraftedPoints({ seasonMin: 2024, seasonMax: 2024 }, replay(recording));

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
  });

  describe('failure', () => {
    test('throws with the status so the agent sees why, not an empty list', async () => {
      await expect(fetchExpectedWins({ season: 2024 }, failing(503))).rejects.toThrow(/503/);
    });

    test('surfaces a timeout as a timeout', async () => {
      const abort: FetchFn = async (): Promise<HttpResponse> => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      };

      await expect(fetchExpectedWins({ season: 2024 }, abort)).rejects.toThrow(/timed out/i);
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

    // tool() does not expose alwaysLoad as a property -- it writes
    // _meta['anthropic/alwaysLoad'], which is what the API actually reads.
    test('only expected_wins rides in the initial prompt', () => {
      const always: string[] = wpflApiTools
        .filter((t) => t._meta?.['anthropic/alwaysLoad'] === true)
        .map((t) => t.name);

      expect(always).toEqual(['expected_wins']);
    });

    test('every description warns that the API stops before the current season', () => {
      for (const definition of wpflApiTools) {
        expect(definition.description).toMatch(/2025/);
        expect(definition.description).toMatch(/ESPN/);
      }
    });

    test('every tool takes a season and declares a handler', () => {
      for (const definition of wpflApiTools) {
        expect(typeof definition.handler).toBe('function');
        expect(Object.keys(definition.inputSchema).length).toBeGreaterThan(0);
      }
    });

    // The handlers themselves are two-line adapters over the fetch functions
    // above; testing them would mean a live call, which §13.3 keeps out of CI.
    // The part with any logic in it is the formatting, tested here directly.
    test('rows are handed to the agent as JSON text, not as a stringified object', () => {
      const result = toToolResult([{ owner: 'AJ Boorde', expectedWins: 9.06 }]);

      expect(result.content[0]).toEqual({
        type: 'text',
        text: JSON.stringify([{ owner: 'AJ Boorde', expectedWins: 9.06 }], null, 1),
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
