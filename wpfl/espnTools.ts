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
 * Team names are never load-bearing: owners come from constants/wpflMembers.ts,
 * the mapping the rest of the bot already shares, not from whatever ESPN sends
 * as `team.name` or `ownerName`.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ActivityAction,
  Boxscore,
  BoxscorePlayer,
  Client as EspnClient,
  FreeAgentPlayer,
  Player,
  Team,
} from 'espn-fantasy-football-api/node.js';
import { getWpflMemberByEspnId } from '../constants/wpflMembers.js';
// The week and season come from ESPN, with the calendar as the fallback --
// the same helper /median reads, so the default week here, the week the
// prompt states and the week /median prints are one number (log Stage 14).
import { espnClientFromEnv, getCurrentPeriod, type NFLPeriod } from '../helpers/espnPeriod.js';
import { toToolResult, type AnyTool } from './toolResult.js';
import { leagueInstant } from '../ask/leagueTime.js';

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
  /** In the league timezone, like every other date the agent is shown. */
  readonly date: string;
  readonly action: string;
  readonly owner: string;
  readonly toOwner: string | null;
  readonly player: string;
  readonly bidAmount: number;
}

/**
 * A player's bare position, from `eligiblePositions`.
 *
 * Measured live (log Stage 14): the fork's `defaultPosition` is the *slot*
 * whose id happens to equal the player's position id, so a real WR arrives
 * labelled RB/WR, a real TE labelled WR, a kicker WR/TE and a QB TQB. The
 * first live question asked for wide receivers and was handed four tight
 * ends. The eligible-slot list still carries the bare position -- a TE's
 * has TE and never a bare WR -- so it is read in a fixed order, with the
 * label as the fallback for a shape nobody has seen.
 */
const BARE_POSITIONS: readonly string[] = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'];

function positionOf(player: {
  readonly defaultPosition: string;
  readonly eligiblePositions?: readonly (string | null)[];
}): string {
  const eligible = new Set<string>(
    (player.eligiblePositions ?? []).filter((slot): slot is string => typeof slot === 'string')
  );
  return BARE_POSITIONS.find((position) => eligible.has(position)) ?? player.defaultPosition;
}

export function toTeams(teams: readonly Team[]): TeamSummary[] {
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

export function toBoxscores(matchups: readonly Boxscore[]): MatchupSummary[] {
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
  entries: readonly FreeAgentPlayer[],
  position?: string
): FreeAgentSummary[] {
  const wanted: string | undefined = position?.toLowerCase();

  // A FreeAgentPlayer extends Player on the fork, so the player fields sit on
  // the entry itself alongside its stat blocks.
  return entries
    .map((entry) => ({ entry, position: positionOf(entry) }))
    .filter(({ position }) => wanted === undefined || position.toLowerCase() === wanted)
    .map(({ entry, position }) => ({
      name: entry.fullName,
      position,
      proTeam: entry.proTeamAbbreviation ?? null,
      percentOwned: entry.percentOwned ?? null,
      percentChange: entry.percentChange ?? null,
      auctionValueAverage: entry.auctionValueAverage ?? null,
      isInjured: entry.isInjured === true,
    }))
    .sort((a, b) => (b.percentOwned ?? 0) - (a.percentOwned ?? 0))
    .slice(0, FREE_AGENT_LIMIT);
}

export function toTransactions(topics: readonly ActivityAction[][]): TransactionSummary[] {
  // `team` and `player` are both lookups the fork can miss: a message naming
  // a team no longer in the league, or a player neither on a roster nor
  // returned by the player-card endpoint.
  return topics.flat().map((action) => ({
    date: leagueInstant(new Date(action.date)),
    action: action.action,
    owner: action.team === undefined ? 'Unknown' : ownerFor(action.team.id),
    toOwner: action.ids.to === undefined ? null : ownerFor(action.ids.to),
    // Measured: an FA ADDED action carries playerPoolEntry and no `player`.
    player:
      action.player?.playerPoolEntry?.player.fullName ??
      action.player?.player?.fullName ??
      'Unknown Player',
    bidAmount: action.bidAmount ?? 0,
  }));
}

function toRosterEntry(player: Player): RosterEntry {
  return {
    name: player.fullName,
    position: positionOf(player),
    proTeam: player.proTeamAbbreviation ?? null,
    injuryStatus: player.injuryStatus ?? null,
    percentOwned: player.percentOwned ?? null,
  };
}

// A BoxscorePlayer extends Player on the fork: the name is `fullName` directly
// and the lineup slot is `rosteredPosition`.
function toLineupEntry(slot: BoxscorePlayer): LineupEntry {
  return { name: slot.fullName, position: slot.rosteredPosition, points: slot.totalPoints };
}

function ownerFor(espnId: number): string {
  return getWpflMemberByEspnId(espnId)?.owner ?? `ESPN team ${espnId}`;
}

function espnClient(): EspnClient {
  const client: EspnClient | null = espnClientFromEnv();
  if (client === null) {
    throw new Error('ESPN credentials are not configured (LEAGUE_ID, ESPN_S2, SWID).');
  }
  return client;
}

const CURRENT_SEASON_ONLY =
  'This is the live ESPN league and the only source of truth for the season in progress — the WPFL history API returns nothing for it and the draft artifact froze on draft night.';

export const espnTools: AnyTool[] = [
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
    async (args): Promise<CallToolResult> => {
      const period: NFLPeriod = await getCurrentPeriod();
      return toToolResult(
        toTeams(
          await espnClient().getTeamsAtWeek({
            seasonId: period.seasonId,
            scoringPeriodId: args.week ?? period.scoringPeriodId,
          })
        )
      );
    }
  ),

  tool(
    'espn_boxscores',
    `Head-to-head matchups for one week: both owners, both scores, and each lineup with per-player points. ${CURRENT_SEASON_ONLY}`,
    {
      week: z.number().int().optional().describe('Week. Defaults to the current NFL week.'),
    },
    async (args): Promise<CallToolResult> => {
      const period: NFLPeriod = await getCurrentPeriod();
      // ESPN reports both periods; with one-week matchups they agree, and an
      // explicit week from the agent names both.
      return toToolResult(
        toBoxscores(
          await espnClient().getBoxscoreForWeek({
            seasonId: period.seasonId,
            matchupPeriodId: args.week ?? period.matchupPeriodId,
            scoringPeriodId: args.week ?? period.scoringPeriodId,
          })
        )
      );
    }
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
    async (args): Promise<CallToolResult> => {
      const period: NFLPeriod = await getCurrentPeriod();
      return toToolResult(
        toFreeAgents(
          await espnClient().getFreeAgents({
            seasonId: period.seasonId,
            scoringPeriodId: args.week ?? period.scoringPeriodId,
          }),
          args.position
        )
      );
    }
  ),

  tool(
    'espn_transactions',
    `Recent adds, drops and trades, with who moved whom, when, and the waiver bid. **Current season only** — ESPN serves this endpoint for the current season and 404s for every prior one, so do not reach for it to answer a historical question; use the sql tool for those. ${CURRENT_SEASON_ONLY}`,
    {},
    async (): Promise<CallToolResult> => {
      const period: NFLPeriod = await getCurrentPeriod();
      return toToolResult(
        toTransactions(await espnClient().getRecentActivity({ seasonId: period.seasonId }))
      );
    }
  ),
];
