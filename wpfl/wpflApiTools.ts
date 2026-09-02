/**
 * The three WPFL history endpoints that are server-computed aggregates.
 *
 * The row-shaped endpoints are cached and reachable only through SQL (§3.7), so
 * there is no second path that could disagree with the first. These three are
 * different in kind: their answer depends on parameters a cache cannot
 * enumerate, and `optimalPointsFor` in particular requires an optimal-lineup
 * solve that cannot be reconstructed from raw scores at all.
 *
 * The system prompt carries a hard rule about them: never compute expected
 * wins or optimal-coaching numbers by hand from cached rows. /ewins and
 * /optimal publish these figures to the same channel, and a bot that
 * contradicts itself in front of the league is worse than one that says "let
 * me call that" (design §4.2).
 */

import { z } from 'zod';
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ASK } from '../ask/askConfig.js';
import { fetchJsonArray, type FetchFn } from './wpflHttp.js';
import type {
  ExpectedWinsResponse,
  OptimalCoachingResponse,
  DraftedPointsResponse,
} from '../types/api.js';

/**
 * The row shapes are `types/api.ts`'s, not this module's own.
 *
 * /ewins and /optimal read the same three endpoints through those interfaces,
 * and the system prompt promises the agent's number is the same number those
 * commands publish. Two independent declarations of the payload is exactly how
 * that promise comes apart quietly, so there is one declaration and these are
 * aliases for it.
 */
export type ExpectedWinsRow = ExpectedWinsResponse;
export type OptimalCoachingRow = OptimalCoachingResponse;
export type DraftedPointsRow = DraftedPointsResponse;

/** Every description says this, so the agent reaches for ESPN rather than retrying an empty season. */
const HISTORY_ONLY =
  'The WPFL history API lags the live season by days or weeks — complete for past seasons, partial or empty for the one in progress. For anything current, use the ESPN tools.';

export async function fetchExpectedWins(
  params: {
    season: number;
    weekMin?: number;
    weekMax?: number;
    includePlayoffs?: boolean;
  },
  fetchFn: FetchFn = fetch
): Promise<ExpectedWinsRow[]> {
  // The endpoint takes a range; a single season is that season on both bounds.
  return fetchJsonArray<ExpectedWinsRow>(
    `${ASK.WPFL_API_BASE}/expectedwins`,
    {
      seasonMin: params.season,
      seasonMax: params.season,
      includePlayoffs: params.includePlayoffs ?? false,
      weekMin: params.weekMin,
      weekMax: params.weekMax,
    },
    fetchFn
  );
}

export async function fetchOptimalCoaching(
  params: { season: number; week?: number },
  fetchFn: FetchFn = fetch
): Promise<OptimalCoachingRow[]> {
  return fetchJsonArray<OptimalCoachingRow>(
    `${ASK.WPFL_API_BASE}/optimalcoaching/pointsfor/${params.season}`,
    { week: params.week },
    fetchFn
  );
}

export async function fetchDraftedPoints(
  params: { seasonMin: number; seasonMax: number; weekMax?: number },
  fetchFn: FetchFn = fetch
): Promise<DraftedPointsRow[]> {
  return fetchJsonArray<DraftedPointsRow>(
    `${ASK.WPFL_API_BASE}/draft/draftedpoints`,
    { seasonMin: params.seasonMin, seasonMax: params.seasonMax, weekMax: params.weekMax },
    fetchFn
  );
}

/** Rows as indented JSON. An empty result says so, so it is not read as zeroes. */
export function toToolResult(rows: readonly unknown[]): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: rows.length === 0 ? 'No rows for those parameters.' : JSON.stringify(rows, null, 1),
      },
    ],
  };
}

// A tool definition's handler is contravariant in its own schema, so a
// heterogeneous array of them cannot be typed more precisely than the library
// types its own collection -- CreateSdkMcpServerOptions.tools is
// Array<SdkMcpToolDefinition<any>>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wpflApiTools: SdkMcpToolDefinition<any>[] = [
  tool(
    'expected_wins',
    `Expected wins against actual wins for all 14 owners in one season, computed by the league's own history API from every weekly score. Expected wins is what an owner's scores would have won against an average schedule, so the gap to actual wins is schedule luck. Never compute this yourself from cached scores: /ewins publishes this exact figure to the league. ${HISTORY_ONLY}`,
    {
      season: z.number().int().describe('Season, e.g. 2024.'),
      weekMin: z
        .number()
        .int()
        .optional()
        .describe('First week to include. Omit for the whole season.'),
      weekMax: z
        .number()
        .int()
        .optional()
        .describe('Last week to include. Omit for the whole season.'),
      includePlayoffs: z
        .boolean()
        .optional()
        .describe('Include playoff weeks. Defaults to false, i.e. the regular season.'),
    },
    async (args): Promise<CallToolResult> => toToolResult(await fetchExpectedWins(args))
  ),

  tool(
    'optimal_coaching',
    `Actual points scored against the best the roster could have scored, for all 14 owners in one season. The gap is lineup-setting skill. The optimal figure needs a lineup solve and cannot be reconstructed from raw scores, so always call this rather than working it out: /optimal publishes this exact figure. ${HISTORY_ONLY}`,
    {
      season: z.number().int().describe('Season, e.g. 2024.'),
      week: z
        .number()
        .int()
        .optional()
        .describe(
          'Cumulative through this week. The API aggregates weeks 1..week, so week 5 is the season to date, not week 5 alone. Omit for the full season.'
        ),
    },
    async (args): Promise<CallToolResult> => toToolResult(await fetchOptimalCoaching(args))
  ),

  tool(
    'drafted_points',
    `Total points scored by the players each owner drafted, across a season range. Answers "did the draft hold up?" Note the API populates only draftedPoints; rosteredOptimalPoints and actualPoints come back as 0 and mean nothing — do not cite them. ${HISTORY_ONLY}`,
    {
      seasonMin: z.number().int().describe('First season in the range.'),
      seasonMax: z.number().int().describe('Last season in the range, inclusive.'),
      weekMax: z
        .number()
        .int()
        .optional()
        .describe('Only count points through this week. Omit for the whole season.'),
    },
    async (args): Promise<CallToolResult> => toToolResult(await fetchDraftedPoints(args))
  ),
];
