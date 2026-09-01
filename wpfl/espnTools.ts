/**
 * The live 2026 ESPN league — the only source of current-season truth.
 *
 * The WPFL history API is the archive and returns [] for the season in
 * progress; the artifact is a frozen post-draft report. Everything about the
 * season as it happens comes from here (design §4.2).
 *
 * Every one of these responses nests a handful of fantasy-relevant fields
 * inside large raw blobs — a single transaction action embeds the whole 8.8 KB
 * ESPN team object, roster included. So each tool projects. Handing the agent
 * the raw shape would spend its context on ids and stat blocks nobody asked
 * about.
 *
 * Team names are never load-bearing: the fork returns `' '` for every
 * `team.name` and has no `ownerName`, so constants/wpflMembers.ts is not merely
 * the preferred owner mapping, it is the only one available.
 */

import { z } from 'zod';
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import pkg from 'espn-fantasy-football-api/node.js';
import type {
  ActivityAction,
  BoxscoreMatchup,
  BoxscorePlayer,
  Client as EspnClient,
  EspnPlayer,
  EspnTeam,
  FreeAgentEntry,
} from 'espn-fantasy-football-api/node.js';
import { getWpflMemberByEspnId } from '../constants/wpflMembers.js';
import { getCurrentNFLWeek, getCurrentNFLSeason } from '../helpers/utils.js';
import { toToolResult } from './wpflApiTools.js';

const { Client } = pkg;

export interface RosterEntry {
  readonly name: string;
  readonly position: string;
  readonly proTeam: string | null;
  readonly injuryStatus: string | null;
  readonly percentOwned: number | null;
}

export interface TeamSummary {
  readonly espnId: number;
  readonly owner: string;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly playoffSeed: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly roster: RosterEntry[];
}

export interface LineupEntry {
  readonly name: string;
  /** Lineup slot, e.g. 'WR' or 'Bench' — not necessarily the player's position. */
  readonly position: string;
  readonly points: number;
}

export interface MatchupSummary {
  readonly homeOwner: string;
  readonly awayOwner: string | null;
  readonly homeScore: number;
  readonly awayScore: number | null;
  readonly home: LineupEntry[];
  readonly away: LineupEntry[];
}

export interface FreeAgentSummary {
  readonly name: string;
  readonly position: string;
  readonly proTeam: string | null;
  readonly percentOwned: number | null;
  readonly percentChange: number | null;
  readonly auctionValueAverage: number | null;
  readonly isInjured: boolean;
}

export interface TransactionSummary {
  readonly date: string;
  readonly action: string;
  readonly owner: string;
  readonly toOwner: string | null;
  readonly player: string;
  readonly bidAmount: number;
}

export function toTeams(teams: readonly EspnTeam[]): TeamSummary[] {
  return teams.map((team) => ({
    espnId: team.id,
    owner: ownerFor(team.id),
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    playoffSeed: team.playoffSeed,
    pointsFor: team.regularSeasonPointsFor ?? 0,
    pointsAgainst: team.regularSeasonPointsAgainst ?? 0,
    roster: (team.roster ?? []).map(toRosterEntry),
  }));
}

export function toBoxscores(matchups: readonly BoxscoreMatchup[]): MatchupSummary[] {
  return matchups.map((matchup) => ({
    homeOwner: ownerFor(matchup.homeTeamId),
    awayOwner: matchup.awayTeamId === undefined ? null : ownerFor(matchup.awayTeamId),
    homeScore: matchup.homeScore,
    awayScore: matchup.awayScore ?? null,
    home: (matchup.homeRoster ?? []).map(toLineupEntry),
    away: (matchup.awayRoster ?? []).map(toLineupEntry),
  }));
}

/**
 * Measured live: the unfiltered pool is 837 players, ~140 KB, ~35K tokens in a
 * single tool result. It is long-tailed — almost all of it is players nobody
 * would pick up — so the tool keeps the most-owned end rather than spending a
 * third of the agent's context on the rest.
 */
export const FREE_AGENT_LIMIT = 50;

export function toFreeAgents(
  entries: readonly FreeAgentEntry[],
  position?: string
): FreeAgentSummary[] {
  const wanted: string | undefined = position?.toLowerCase();

  return entries
    .filter(
      (entry) => wanted === undefined || entry.player.defaultPosition.toLowerCase() === wanted
    )
    .map((entry) => ({
      name: entry.player.fullName,
      position: entry.player.defaultPosition,
      proTeam: entry.player.proTeamAbbreviation ?? null,
      percentOwned: entry.player.percentOwned ?? null,
      percentChange: entry.player.percentChange ?? null,
      auctionValueAverage: entry.player.auctionValueAverage ?? null,
      isInjured: entry.player.isInjured === true,
    }))
    .sort((a, b) => (b.percentOwned ?? 0) - (a.percentOwned ?? 0))
    .slice(0, FREE_AGENT_LIMIT);
}

export function toTransactions(topics: readonly ActivityAction[][]): TransactionSummary[] {
  return topics.flat().map((action) => ({
    date: new Date(action.date).toISOString(),
    action: action.action,
    owner: ownerFor(action.team.id),
    toOwner: action.ids.to === undefined ? null : ownerFor(action.ids.to),
    // Measured: an FA ADDED action carries playerPoolEntry and no `player`.
    player:
      action.player.playerPoolEntry?.player.fullName ??
      action.player.player?.fullName ??
      'Unknown Player',
    bidAmount: action.bidAmount ?? 0,
  }));
}

function toRosterEntry(player: EspnPlayer): RosterEntry {
  return {
    name: player.fullName,
    position: player.defaultPosition,
    proTeam: player.proTeamAbbreviation ?? null,
    injuryStatus: player.injuryStatus ?? null,
    percentOwned: player.percentOwned ?? null,
  };
}

function toLineupEntry(slot: BoxscorePlayer): LineupEntry {
  return { name: slot.player.fullName, position: slot.position, points: slot.totalPoints };
}

function ownerFor(espnId: number): string {
  return getWpflMemberByEspnId(espnId)?.owner ?? `ESPN team ${espnId}`;
}

function espnClient(): EspnClient {
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (LEAGUE_ID === undefined || ESPN_S2 === undefined || SWID === undefined) {
    throw new Error('ESPN credentials are not configured (LEAGUE_ID, ESPN_S2, SWID).');
  }
  const client = new Client({ leagueId: Number.parseInt(LEAGUE_ID, 10) });
  client.setCookies({ espnS2: ESPN_S2, SWID });
  return client;
}

/**
 * `getFullYear()` would name the wrong season for all of January and February
 * -- the weeks that carry the fantasy playoffs and the championship. ESPN would
 * return nothing for the season that has not started, and the agent would tell
 * the league in public that it has no data for the game they just played.
 */
const currentSeason = getCurrentNFLSeason;

const CURRENT_SEASON_ONLY =
  'This is the live ESPN league and the only source of truth for the season in progress — the WPFL history API returns nothing for it and the draft artifact froze on draft night.';

// See the note in wpflApiTools.ts on why this collection is typed the way the
// library types its own.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const espnTools: SdkMcpToolDefinition<any>[] = [
  tool(
    'espn_teams',
    `Every team in the live ESPN league: owner, record, playoff seed, points for and against, and the full roster with each player's injury status. Use this for standings, for who owns a player right now, and for injuries on a roster. ${CURRENT_SEASON_ONLY}`,
    {
      week: z
        .number()
        .int()
        .optional()
        .describe('Scoring period. Defaults to the current NFL week.'),
    },
    async (args): Promise<CallToolResult> =>
      toToolResult(
        toTeams(
          await espnClient().getTeamsAtWeek({
            seasonId: currentSeason(),
            scoringPeriodId: args.week ?? getCurrentNFLWeek(),
          })
        )
      ),
    { alwaysLoad: true }
  ),

  tool(
    'espn_boxscores',
    `Head-to-head matchups for one week: both owners, both scores, and each lineup with per-player points. ${CURRENT_SEASON_ONLY}`,
    {
      week: z.number().int().optional().describe('Week. Defaults to the current NFL week.'),
    },
    async (args): Promise<CallToolResult> => {
      const week: number = args.week ?? getCurrentNFLWeek();
      return toToolResult(
        toBoxscores(
          await espnClient().getBoxscoreForWeek({
            seasonId: currentSeason(),
            matchupPeriodId: week,
            scoringPeriodId: week,
          })
        )
      );
    },
    { alwaysLoad: false }
  ),

  tool(
    'espn_free_agents',
    `Players nobody owns, with percent owned, weekly ownership change, and average auction value. Use this for waiver-wire questions. Returns the ${FREE_AGENT_LIMIT} most-owned available players, so filter by position to see the useful end of a specific pool. ${CURRENT_SEASON_ONLY}`,
    {
      position: z
        .string()
        .optional()
        .describe("Filter to one position, e.g. 'RB', 'WR', 'QB', 'TE', 'D/ST'. Omit for all."),
      week: z
        .number()
        .int()
        .optional()
        .describe('Scoring period. Defaults to the current NFL week.'),
    },
    async (args): Promise<CallToolResult> =>
      toToolResult(
        toFreeAgents(
          await espnClient().getFreeAgents({
            seasonId: currentSeason(),
            scoringPeriodId: args.week ?? getCurrentNFLWeek(),
          }),
          args.position
        )
      ),
    { alwaysLoad: false }
  ),

  tool(
    'espn_transactions',
    `Recent adds, drops and trades, with who moved whom, when, and the waiver bid. **Current season only** — ESPN serves this endpoint for the current season and 404s for every prior one, so do not reach for it to answer a historical question; use the sql tool for those. ${CURRENT_SEASON_ONLY}`,
    {},
    async (): Promise<CallToolResult> =>
      toToolResult(
        toTransactions(await espnClient().getRecentActivity({ seasonId: currentSeason() }))
      ),
    { alwaysLoad: false }
  ),
];
