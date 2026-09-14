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
  PlayerStats,
  Team,
} from 'espn-fantasy-football-api/node.js';
import { getWpflMemberByEspnId, wpflMembers } from '../constants/wpflMembers.js';
import { formatNumber } from '../helpers/utils.js';
// The week and season come from ESPN, with the calendar as the fallback --
// the same helper /median reads, so the default week here, the week the
// prompt states and the week /median prints are one number (log Stage 14).
import { espnClientFromEnv, getCurrentPeriod, type NFLPeriod } from '../helpers/espnPeriod.js';
import { toToolResult, type AnyTool } from './toolResult.js';
import { leagueInstant, nflWeekWindow } from '../ask/leagueTime.js';
import { logError } from '../errors/index.js';
// Runtime values from the fork come through the shim, as in helpers/espnPeriod.ts.
import { NFLGame, WINNING_TEAM } from '../espnClient.cjs';
import { LINEUP_SLOTS, optimalPoints, type SolveEntry } from './lineupSolve.js';
import {
  columnsProse,
  freeAgentRows,
  lineupRows,
  matchupRows,
  rosterRows,
  standingsRows,
  transactionRows,
  type LiveStore,
} from './liveTables.js';

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

/**
 * Where a player's NFL game stands this week. `bye` is a team with no game in
 * the week's schedule; `unknown` is a week the schedule was not fetched for,
 * or could not be. Why it exists is on `MatchupSummary.decided`.
 */
export type GameStatus = 'final' | 'in_progress' | 'not_started' | 'bye' | 'unknown';

/** A player's game status this week, by the pro team abbreviation ESPN puts on the player. */
export type StatusLookup = (proTeam: string | undefined) => GameStatus;

export type SideResult = 'win' | 'loss' | 'tie';

export interface LineupEntry {
  readonly name: string;
  /** Lineup slot, e.g. 'WR', 'RB/WR/TE' or 'Bench' — not the player's position. */
  readonly slot: string;
  /** The player's bare position, e.g. 'RB', whatever slot they sit in. */
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
  readonly gameStatus: GameStatus;
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
  /**
   * True once ESPN has settled the matchup, or once no starter on either side
   * has a game left. ESPN settles a week only after its last game, so on a
   * Monday morning every matchup reads UNDECIDED from it even where both
   * sides are done, and a starter in the Monday game reads 0 -- the same 0 as
   * a player who took the field and scored nothing. The game status on each
   * lineup entry, and the second test here, are what a Monday question needs.
   */
  readonly decided: boolean;
  /** The result for each side, null until decided. */
  readonly homeResult: SideResult | null;
  readonly awayResult: SideResult | null;
  /**
   * Starters whose game is not final, and the sum of their projections. Null
   * when a starter's status is unknown, so an unfetched schedule never reads
   * as "nobody left to play".
   */
  readonly homePendingStarters: number | null;
  readonly homePendingProjected: number | null;
  readonly awayPendingStarters: number | null;
  readonly awayPendingProjected: number | null;
  /**
   * The best lineup the roster could have started from the points as they
   * stand (wpfl/lineupSolve.ts), and the gap to the score. Provisional while
   * starters are pending: a player who has not played counts 0.
   */
  readonly homeOptimalPoints: number;
  readonly homePointsLeft: number;
  readonly awayOptimalPoints: number | null;
  readonly awayPointsLeft: number | null;
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

/** ESPN's eligible slots for a player, with the nulls the fork can leave in the list dropped. */
function eligibleSlots(player: {
  readonly eligiblePositions?: readonly (string | null)[];
}): string[] {
  return (player.eligiblePositions ?? []).filter(
    (slot): slot is string => typeof slot === 'string'
  );
}

function positionOf(player: {
  readonly defaultPosition: string;
  readonly eligiblePositions?: readonly (string | null)[];
}): string {
  const eligible = new Set<string>(eligibleSlots(player));
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

/** One status for everyone: a past week is final, a future one not started. */
export function constantStatus(status: GameStatus): StatusLookup {
  return (): GameStatus => status;
}

/** Every game status is unknown: the schedule was not fetched. */
export const UNKNOWN_STATUS: StatusLookup = constantStatus('unknown');

/** What this reads of an NFL game from the fork's schedule lookup. */
export type NflGame = Pick<NFLGame, 'gameStatus' | 'homeTeam' | 'awayTeam'>;

/** The fork's own three game statuses, so a rewording there cannot leave every game unknown here. */
const GAME_STATUS: Readonly<Record<string, GameStatus>> = {
  [NFLGame.GAME_STATUSES.pre]: 'not_started',
  [NFLGame.GAME_STATUSES.in]: 'in_progress',
  [NFLGame.GAME_STATUSES.post]: 'final',
};

/**
 * A status per pro team from the week's schedule. A team with no game in the
 * window is on bye. Keyed on the abbreviation ESPN puts on both the game and
 * the player, so the two agree by construction (`WSH` on both).
 */
/** Where one scheduled game stands, in this module's terms. */
export function gameStatusOf(game: Pick<NFLGame, 'gameStatus'>): GameStatus {
  return GAME_STATUS[game.gameStatus] ?? 'unknown';
}

export function statusLookupFromGames(games: readonly NflGame[]): StatusLookup {
  const byTeam = new Map<string, GameStatus>();
  for (const game of games) {
    const status: GameStatus = gameStatusOf(game);
    byTeam.set(game.homeTeam.teamAbbrev, status);
    byTeam.set(game.awayTeam.teamAbbrev, status);
  }
  return (proTeam: string | undefined): GameStatus =>
    proTeam === undefined ? 'unknown' : (byTeam.get(proTeam) ?? 'bye');
}

/** ESPN's call on a matchup, as each side's result. Absent while ESPN has it UNDECIDED. */
const ESPN_RESULT: Readonly<Record<string, readonly [SideResult, SideResult]>> = {
  [WINNING_TEAM.HOME]: ['win', 'loss'],
  [WINNING_TEAM.AWAY]: ['loss', 'win'],
  [WINNING_TEAM.TIE]: ['tie', 'tie'],
};

function byScore(home: number, away: number): readonly [SideResult, SideResult] {
  if (home > away) return ['win', 'loss'];
  if (home < away) return ['loss', 'win'];
  return ['tie', 'tie'];
}

export function toBoxscores(
  matchups: readonly Boxscore[],
  status: StatusLookup = UNKNOWN_STATUS,
  owners?: ReadonlySet<string>
): MatchupSummary[] {
  return matchups
    .map((matchup): MatchupSummary => {
      const awayOwner: string | null =
        matchup.awayTeamId === undefined ? null : ownerFor(matchup.awayTeamId);
      const home: Side = sideOf(matchup.homeRoster ?? [], matchup.homeScore, status);
      const away: Side | null =
        awayOwner === null || matchup.awayScore === undefined
          ? null
          : sideOf(matchup.awayRoster ?? [], matchup.awayScore, status);
      const settled: readonly [SideResult, SideResult] | undefined = ESPN_RESULT[matchup.winner];
      const decided: boolean =
        settled !== undefined ||
        (home.pending?.starters === 0 && (away === null || away.pending?.starters === 0));
      const [homeResult, awayResult] =
        !decided || away === null ? [null, null] : (settled ?? byScore(home.score, away.score));
      return {
        homeOwner: ownerFor(matchup.homeTeamId),
        awayOwner,
        homeScore: home.score,
        awayScore: away?.score ?? null,
        homeProjected: roundedOrNull(matchup.homeProjectedScore),
        awayProjected: roundedOrNull(matchup.awayProjectedScore),
        homeWinProbability: roundedOrNull(matchup.homeWinProbability),
        awayWinProbability: roundedOrNull(matchup.awayWinProbability),
        decided,
        homeResult,
        awayResult,
        homePendingStarters: home.pending?.starters ?? null,
        homePendingProjected: home.pending?.projected ?? null,
        awayPendingStarters: away?.pending?.starters ?? null,
        awayPendingProjected: away?.pending?.projected ?? null,
        homeOptimalPoints: home.optimal,
        homePointsLeft: home.pointsLeft,
        awayOptimalPoints: away?.optimal ?? null,
        awayPointsLeft: away?.pointsLeft ?? null,
        home: home.lineup,
        away: away?.lineup ?? [],
      };
    })
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
function toLineupEntry(slot: BoxscorePlayer, status: StatusLookup): LineupEntry {
  return {
    name: slot.fullName,
    slot: slot.rosteredPosition,
    position: positionOf(slot),
    points: slot.totalPoints,
    injuryStatus: slot.injuryStatus ?? null,
    projected: projectedPoints(slot.projectedPointBreakdown),
    gameStatus: status(slot.proTeamAbbreviation),
  };
}

/** One side of a matchup: its lineup and everything the summary derives from it. */
interface Side {
  readonly lineup: LineupEntry[];
  readonly score: number;
  readonly pending: Pending | null;
  readonly optimal: number;
  readonly pointsLeft: number;
}

function sideOf(roster: readonly BoxscorePlayer[], score: number, status: StatusLookup): Side {
  const lineup: LineupEntry[] = roster.map((p: BoxscorePlayer) => toLineupEntry(p, status));
  const optimal: number = optimalPoints(roster.map(toSolveEntry));
  return {
    lineup,
    score,
    pending: pendingOf(lineup),
    optimal,
    pointsLeft: formatNumber(optimal - score),
  };
}

/** A lineup slot that scores: one of the league's starting slots, not the bench or IR. */
function isStarterSlot(slot: string): boolean {
  return LINEUP_SLOTS.includes(slot);
}

interface Pending {
  readonly starters: number;
  readonly projected: number;
}

/**
 * Starters with a game left, and what ESPN projects for them. Null when any
 * starter's status is unknown: "none pending" must never be a default.
 */
function pendingOf(lineup: readonly LineupEntry[]): Pending | null {
  const starters: LineupEntry[] = lineup.filter((entry: LineupEntry) => isStarterSlot(entry.slot));
  if (starters.some((entry: LineupEntry): boolean => entry.gameStatus === 'unknown')) return null;
  const pending: LineupEntry[] = starters.filter(
    (entry: LineupEntry): boolean =>
      entry.gameStatus === 'not_started' || entry.gameStatus === 'in_progress'
  );
  return {
    starters: pending.length,
    projected: formatNumber(
      pending.reduce((sum: number, entry: LineupEntry): number => sum + entry.projected, 0)
    ),
  };
}

function toSolveEntry(player: BoxscorePlayer): SolveEntry {
  return {
    points: player.totalPoints,
    eligible: eligibleSlots(player),
    slot: player.rosteredPosition,
  };
}

/**
 * The fork types these as numbers, but for any week ESPN is not scoring they
 * arrive undefined -- the same gap `awayScore ?? null` above covers. Rounded
 * to two places: ESPN sends the totals to eight.
 */
function roundedOrNull(value: number | undefined): number | null {
  return value === undefined ? null : formatNumber(value);
}

/**
 * A player's projected points: the fork's `projectedPointBreakdown` is one
 * number per scoring item plus a `usesPoints` flag, and ESPN's per-player
 * total is not mapped. Summed here the way the Book prices from it; the sum
 * lands within a fraction of a point of ESPN's own team total, which the
 * matchup carries separately and which is the authoritative figure.
 */
function projectedPoints(breakdown: PlayerStats | undefined): number {
  let total: number = 0;
  for (const value of Object.values(breakdown ?? {})) {
    if (typeof value === 'number') total += value;
  }
  return formatNumber(total);
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

/** Injected so the tools are tested without credentials or the network. */
export interface EspnDeps {
  readonly client: () => EspnClient;
  readonly period: () => Promise<NFLPeriod>;
  /** The clock, for the week's schedule window. Defaults to now. */
  readonly now?: () => Date;
}

const DEFAULT_DEPS: EspnDeps = { client: espnClient, period: getCurrentPeriod };

/**
 * Game statuses for the week a boxscore call is about. Only the current
 * scoring period has games in flight, so only it costs a schedule call: a
 * past week is final and a future one has not started, by definition. If the
 * schedule cannot be fetched the boxscore still returns with every status
 * unknown -- which the description defines -- rather than failing the one
 * tool a Monday question needs.
 */
async function weekStatus(deps: EspnDeps, week: number, period: NFLPeriod): Promise<StatusLookup> {
  if (week < period.scoringPeriodId) return constantStatus('final');
  if (week > period.scoringPeriodId) return constantStatus('not_started');
  try {
    const games: readonly NflGame[] = await deps
      .client()
      .getNFLGamesForPeriod(nflWeekWindow(deps.now?.() ?? new Date()));
    return statusLookupFromGames(games);
  } catch (error: unknown) {
    logError('espnTools', "Could not fetch the week's NFL schedule for game statuses", error);
    return UNKNOWN_STATUS;
  }
}

const CURRENT_SEASON_ONLY =
  'This is the live ESPN league and the only source of truth for the season in progress — the WPFL history API returns nothing for it and the draft artifact froze on draft night.';

/** The sentence every ESPN tool ends with: what it fills for `sql`, `chart` and `table`. */
const FILLS_FOR_SQL =
  'for `sql`, `chart` and `table` in this run, whole league regardless of `owners`.';

const OWNERS_ARG = z
  .array(z.string())
  .optional()
  .describe(
    'Only these owners, by canonical spelling (INDEX.md lists all 14). Omit for the whole league.'
  );

/**
 * The four ESPN tools for one run. Each fetch also fills the run's live
 * tables (wpfl/liveTables.ts) from the whole league, and only then applies the
 * `owners` filter to what the model reads, so the tables never hold a subset
 * because the question was about two teams. The tool text is identical from
 * run to run, so the prompt cache still hits; only the store differs.
 */
export function createEspnTools(store: LiveStore, deps: EspnDeps = DEFAULT_DEPS): AnyTool[] {
  return [
    tool(
      'espn_teams',
      `Every team in the live ESPN league: owner, record, playoff seed, points for and against, and the full roster with each player's injury status. Use this for standings, for who owns a player right now, and for injuries on a roster. Pass \`owners\` to get only the rosters a question is about: the whole league is fourteen rosters, the largest result any tool returns. Also fills the tables live_standings (${columnsProse('live_standings')}) and live_rosters (${columnsProse('live_rosters')}; about 210 rows, so filter by owner or position) ${FILLS_FOR_SQL} ${CURRENT_SEASON_ONLY}`,
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
        const period: NFLPeriod = await deps.period();
        const league: TeamSummary[] = toTeams(
          await deps.client().getTeamsAtWeek({
            seasonId: period.seasonId,
            scoringPeriodId: args.week ?? period.scoringPeriodId,
          })
        );
        store.replace('live_standings', standingsRows(league));
        store.replace('live_rosters', rosterRows(league));
        return toToolResult(
          league.filter((team: TeamSummary): boolean => wanted(owners, team.owner))
        );
      }
    ),

    tool(
      'espn_boxscores',
      `Head-to-head matchups for one week: both owners, both scores, ESPN's projected total and win probability for each side, and each lineup with per-player points, projection, injury status, position and slot. Before kickoff the scores are 0 and the projections are ESPN's forecast of the week as lineups stand: who is favoured in a game this week, and why. During the week each player carries game_status -- final, in_progress, not_started, bye or unknown -- so a starter at 0 whose game has not started has not played. decided is true once ESPN has settled the matchup or no starter on either side has a game left; until then result is null and pending_starters and pending_projected say who is still to play and what ESPN projects for them. optimal_points is the best lineup the roster could have started from the points as they stand and points_left the gap to the score; both are provisional while starters are pending. This is the optimal figure for the week in progress; optimal_coaching publishes it for past seasons, and where both hold the same week the API's figure is the published one. ESPN publishes the projected totals and win probability for the current week only (null otherwise); the draft-night sim's odds for every week, and a future week's opponent, are in the artifact's \`teams.schedule\`. Per-player projections sum to within a fraction of a point of ESPN's own team total. Pass \`owners\` for one matchup rather than the whole slate. Also fills the tables live_matchups (${columnsProse('live_matchups')}; one row per side, so filter home = true for one row per game) and live_lineups (${columnsProse('live_lineups')}; slot is the lineup slot, position the player's) ${FILLS_FOR_SQL} ${CURRENT_SEASON_ONLY}`,
      {
        owners: OWNERS_ARG,
        week: z.number().int().optional().describe('Week. Defaults to the current NFL week.'),
      },
      async (args): Promise<CallToolResult> => {
        const owners: ReadonlySet<string> | undefined = resolveOwners(args.owners);
        const period: NFLPeriod = await deps.period();
        // ESPN reports both periods; with one-week matchups they agree, and an
        // explicit week from the agent names both.
        const week: number = args.week ?? period.matchupPeriodId;
        const scoringPeriodId: number = args.week ?? period.scoringPeriodId;
        // Two independent round trips to two ESPN hosts, on a ticker somebody is watching.
        const [status, boxscores] = await Promise.all([
          weekStatus(deps, scoringPeriodId, period),
          deps.client().getBoxscoreForWeek({
            seasonId: period.seasonId,
            matchupPeriodId: week,
            scoringPeriodId,
          }),
        ]);
        const slate: MatchupSummary[] = toBoxscores(boxscores, status);
        store.replaceWeek('live_matchups', week, matchupRows(week, slate));
        store.replaceWeek('live_lineups', week, lineupRows(week, slate));
        return toToolResult(
          slate.filter(
            (matchup: MatchupSummary): boolean =>
              wanted(owners, matchup.homeOwner) || wanted(owners, matchup.awayOwner)
          )
        );
      }
    ),

    tool(
      'espn_free_agents',
      `Players nobody owns, with percent owned, weekly ownership change, and average auction value. Use this for waiver-wire questions. Returns the ${FREE_AGENT_LIMIT} most-owned available players, so filter by position to see the useful end of a specific pool. Also fills the table live_free_agents (${columnsProse('live_free_agents')}) ${FILLS_FOR_SQL} ${CURRENT_SEASON_ONLY}`,
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
        const period: NFLPeriod = await deps.period();
        const agents: FreeAgentSummary[] = toFreeAgents(
          await deps.client().getFreeAgents({
            seasonId: period.seasonId,
            scoringPeriodId: args.week ?? period.scoringPeriodId,
          }),
          args.position
        );
        store.replace('live_free_agents', freeAgentRows(agents));
        return toToolResult(agents);
      }
    ),

    tool(
      'espn_transactions',
      `Recent adds, drops and trades, with who moved whom, when, and the waiver bid. **Current season only** — ESPN serves this endpoint for the current season and 404s for every prior one, so do not reach for it to answer a historical question; past seasons' bids, adds and drops are the wpfl_transactions table in the sql tool. Also fills the table live_transactions (${columnsProse('live_transactions')}) ${FILLS_FOR_SQL} ${CURRENT_SEASON_ONLY}`,
      {},
      async (): Promise<CallToolResult> => {
        const period: NFLPeriod = await deps.period();
        const moves: TransactionSummary[] = toTransactions(
          await deps.client().getRecentActivity({ seasonId: period.seasonId })
        );
        store.replace('live_transactions', transactionRows(moves));
        return toToolResult(moves);
      }
    ),
  ];
}
