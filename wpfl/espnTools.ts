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
import { getWpflMemberByEspnId, wpflMembers } from '../constants/wpflMembers.js';
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
  /**
   * ESPN's designation, exactly as a roster entry carries it. Without it the
   * first live matchup question had to fetch every roster in the league --
   * fourteen of them, the largest result in the run -- to learn the status of
   * the eighteen players in its one matchup.
   */
  readonly injuryStatus: string | null;
  /**
   * ESPN's projection for the player this week, summed over the scoring items
   * the fork maps (it hands back the per-item breakdown and nothing totals
   * it). This is what says why one side is favoured and which starter the gap
   * turns on. 0 for a player ESPN has nothing for: IR, a bye.
   */
  readonly projected: number;
}

export interface MatchupSummary {
  readonly homeOwner: string;
  readonly awayOwner: string | null;
  readonly homeScore: number;
  readonly awayScore: number | null;
  /**
   * ESPN's own projected total for the lineup as set, and its win probability
   * from 0 to 1. ESPN publishes both for the current matchup period only, so
   * they are null for any other week. Null rather than absent: the first live
   * matchup question was answered from the draft-night sim, and the agent
   * wrote "no per-week win probability is published" while the fork had
   * ESPN's at 0.53 and this projection dropped it.
   */
  readonly homeProjected: number | null;
  readonly awayProjected: number | null;
  readonly homeWinProbability: number | null;
  readonly awayWinProbability: number | null;
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
 * This began as a workaround. The fork used to read `defaultPositionId`
 * through the *slot* enum, so a real WR arrived labelled RB/WR, a real TE
 * labelled WR, a kicker WR/TE and a QB TQB -- the first live question asked
 * for wide receivers and was handed four tight ends. The fork fixed that at
 * f66c9af: `defaultPosition` is now the player's actual position.
 *
 * The eligible-slot scan is kept anyway, because it is the more robust of
 * the two. It does not depend on the fork's id map being complete, and that
 * map covers only the six standard positions -- an IDP id resolves to
 * `undefined` there while the eligible list still names the position.
 *
 * Worth revisiting once the fixtures below are re-recorded against the fixed
 * fork: `defaultPosition` is authoritative for a player eligible at several
 * bare positions, where this fixed scan order just takes the first it finds.
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

/**
 * The canonical owners a call asked for, or undefined for the whole league.
 *
 * Measured on the first live matchup question: `espn_teams` returned all
 * fourteen rosters, about 30 KB and the largest thing in the run's context, to
 * answer for two of them, and `espn_boxscores` the whole slate for one game.
 * Matching is exact on the canonical spelling, case-insensitively -- INDEX.md
 * and the prompt both insist on those spellings -- and a near miss is refused
 * with the list rather than answered with an empty result the agent would
 * read as "no such team".
 */
export function resolveOwners(
  names: readonly string[] | undefined
): ReadonlySet<string> | undefined {
  if (names === undefined || names.length === 0) return undefined;

  const canonical = new Map<string, string>(
    wpflMembers.map((member): [string, string] => [member.owner.toLowerCase(), member.owner])
  );
  const resolved = new Set<string>();
  const unknown: string[] = [];
  for (const name of names) {
    const owner: string | undefined = canonical.get(name.trim().toLowerCase());
    if (owner === undefined) unknown.push(name);
    else resolved.add(owner);
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown owner${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. ` +
        `Use the canonical spellings: ${wpflMembers.map((member) => member.owner).join(', ')}.`
    );
  }
  return resolved;
}

/** True when no filter was given, or this owner is in it. A missing owner (no away team) never matches. */
function wanted(owners: ReadonlySet<string> | undefined, owner: string | null): boolean {
  if (owners === undefined) return true;
  return owner !== null && owners.has(owner);
}

export function toTeams(teams: readonly Team[], owners?: ReadonlySet<string>): TeamSummary[] {
  return teams
    .map(
      (team): TeamSummary => ({
        espnId: team.id,
        owner: ownerFor(team.id),
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        playoffSeed: team.playoffSeed,
        pointsFor: team.regularSeasonPointsFor ?? 0,
        pointsAgainst: team.regularSeasonPointsAgainst ?? 0,
        roster: (team.roster ?? []).map(toRosterEntry),
      })
    )
    .filter((team: TeamSummary): boolean => wanted(owners, team.owner));
}

export function toBoxscores(
  matchups: readonly Boxscore[],
  owners?: ReadonlySet<string>
): MatchupSummary[] {
  return matchups
    .map(
      (matchup): MatchupSummary => ({
        homeOwner: ownerFor(matchup.homeTeamId),
        awayOwner: matchup.awayTeamId === undefined ? null : ownerFor(matchup.awayTeamId),
        homeScore: matchup.homeScore,
        awayScore: matchup.awayScore ?? null,
        homeProjected: roundedOrNull(matchup.homeProjectedScore),
        awayProjected: roundedOrNull(matchup.awayProjectedScore),
        homeWinProbability: finiteOrNull(matchup.homeWinProbability),
        awayWinProbability: finiteOrNull(matchup.awayWinProbability),
        home: (matchup.homeRoster ?? []).map(toLineupEntry),
        away: (matchup.awayRoster ?? []).map(toLineupEntry),
      })
    )
    .filter(
      (matchup: MatchupSummary): boolean =>
        wanted(owners, matchup.homeOwner) || wanted(owners, matchup.awayOwner)
    );
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
    // An FA ADDED action carries playerPoolEntry and no `player`; a player off a roster carries
    // the other shape. The fork reads both now, so this no longer reaches through
    // `playerPoolEntry?.player.fullName` -- which was unguarded at `.player`.
    player: action.playerName ?? 'Unknown Player',
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
  return {
    name: slot.fullName,
    position: slot.rosteredPosition,
    points: slot.totalPoints,
    injuryStatus: slot.injuryStatus ?? null,
    projected: projectedPoints(slot.projectedPointBreakdown),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The fork types these as numbers, but for any week ESPN is not scoring they arrive undefined. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundedOrNull(value: unknown): number | null {
  const finite: number | null = finiteOrNull(value);
  return finite === null ? null : round2(finite);
}

/**
 * A player's projected points: the fork's `projectedPointBreakdown` is one
 * number per scoring item plus a `usesPoints` flag, and ESPN's per-player
 * total is not mapped. Summed here the way the Book prices from it; the sum
 * lands within a fraction of a point of ESPN's own team total, which the
 * matchup carries separately and which is the authoritative figure.
 */
function projectedPoints(breakdown: unknown): number {
  if (typeof breakdown !== 'object' || breakdown === null) return 0;
  let total: number = 0;
  for (const value of Object.values(breakdown as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) total += value;
  }
  return round2(total);
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

const OWNERS_ARG = z
  .array(z.string())
  .optional()
  .describe(
    'Only these owners, by canonical spelling (INDEX.md lists all 14). Omit for the whole league.'
  );

export const espnTools: AnyTool[] = [
  tool(
    'espn_teams',
    `Every team in the live ESPN league: owner, record, playoff seed, points for and against, and the full roster with each player's injury status. Use this for standings, for who owns a player right now, and for injuries on a roster. Pass \`owners\` to get only the rosters a question is about: the whole league is fourteen rosters, the largest result any tool returns. ${CURRENT_SEASON_ONLY}`,
    {
      owners: OWNERS_ARG,
      week: z
        .number()
        .int()
        .optional()
        .describe('Scoring period. Defaults to the current NFL week.'),
    },
    async (args): Promise<CallToolResult> => {
      // Validated before the network call, so a misspelling fails fast.
      const owners: ReadonlySet<string> | undefined = resolveOwners(args.owners);
      const period: NFLPeriod = await getCurrentPeriod();
      return toToolResult(
        toTeams(
          await espnClient().getTeamsAtWeek({
            seasonId: period.seasonId,
            scoringPeriodId: args.week ?? period.scoringPeriodId,
          }),
          owners
        )
      );
    }
  ),

  tool(
    'espn_boxscores',
    `Head-to-head matchups for one week: both owners, both scores, ESPN's projected total and win probability for each side, and each lineup with per-player points, projection and injury status. Before kickoff every score is 0 and the projections are ESPN's forecast of the week as the lineups are currently set -- the numbers for who is favoured in a game this week, and why. ESPN publishes the projected totals and win probability for the current week only (null for any other week). The draft-night sim's odds for every week are a different figure, in the artifact's \`teams.schedule\`, which is also where a future week's opponent is. The team total is ESPN's own; the per-player figures sum to within a fraction of a point of it. Pass \`owners\` for one matchup rather than the whole slate. ${CURRENT_SEASON_ONLY}`,
    {
      owners: OWNERS_ARG,
      week: z.number().int().optional().describe('Week. Defaults to the current NFL week.'),
    },
    async (args): Promise<CallToolResult> => {
      const owners: ReadonlySet<string> | undefined = resolveOwners(args.owners);
      const period: NFLPeriod = await getCurrentPeriod();
      // ESPN reports both periods; with one-week matchups they agree, and an
      // explicit week from the agent names both.
      return toToolResult(
        toBoxscores(
          await espnClient().getBoxscoreForWeek({
            seasonId: period.seasonId,
            matchupPeriodId: args.week ?? period.matchupPeriodId,
            scoringPeriodId: args.week ?? period.scoringPeriodId,
          }),
          owners
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
