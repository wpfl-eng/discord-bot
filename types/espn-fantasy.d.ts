// ESPN Fantasy Football API types (custom fork)
declare module 'espn-fantasy-football-api/node.js' {
  export interface EspnClientOptions {
    leagueId: number;
  }

  export interface CookieOptions {
    espnS2?: string;
    SWID?: string;
  }

  export interface BoxscoreOptions {
    seasonId: number;
    matchupPeriodId: number;
    scoringPeriodId: number;
  }

  export interface BoxscoreMatchup {
    homeTeamId: number;
    homeScore: number;
    awayTeamId?: number;
    awayScore?: number;
    homeRoster?: BoxscorePlayer[];
    awayRoster?: BoxscorePlayer[];
  }

  /** A lineup slot in a boxscore. */
  export interface BoxscorePlayer {
    player: EspnPlayer;
    /** Lineup slot, e.g. 'WR', 'Flex', 'Bench'. */
    position: string;
    totalPoints: number;
  }

  /**
   * A player as the fork returns it, on a roster or in the free-agent pool.
   */
  export interface EspnPlayer {
    id: number;
    fullName: string;
    firstName?: string;
    lastName?: string;
    /** The player's own position, e.g. 'RB'. */
    defaultPosition: string;
    eligiblePositions?: string[];
    proTeam?: string;
    proTeamAbbreviation?: string;
    injuryStatus?: string;
    isInjured?: boolean;
    availabilityStatus?: string;
    percentOwned?: number;
    percentChange?: number;
    percentStarted?: number;
    auctionValueAverage?: number;
    averageDraftPosition?: number;
  }

  /** getFreeAgents wraps each player alongside its stat blocks. */
  export interface FreeAgentEntry {
    player: EspnPlayer;
  }

  /**
   * ESPN Team data returned by getTeamsAtWeek
   */
  export interface EspnTeam {
    id: number;
    wins: number;
    losses: number;
    ties: number;
    playoffSeed: number;
    finalStandingsPosition?: number;
    /** Always ' ' on the fork, which is why constants/wpflMembers.ts exists. */
    name?: string;
    abbreviation?: string;
    regularSeasonPointsFor?: number;
    regularSeasonPointsAgainst?: number;
    totalPointsScored?: number;
    roster?: EspnPlayer[];
  }

  /**
   * Player information in activity
   */
  export interface ActivityPlayer {
    playerPoolEntry?: {
      player: {
        fullName: string;
      };
    };
    /**
     * Optional: a recorded FA ADDED action carries playerPoolEntry and no
     * `player` at all. discordCommands/activity/activity.ts already reads this
     * with optional chaining.
     */
    player?: {
      fullName: string;
    };
  }

  /**
   * Activity action types
   */
  export type ActivityActionType = 'FA ADDED' | 'DROPPED' | 'TRADED' | 'WAIVER ADDED';

  /**
   * Single activity action (transaction)
   */
  export interface ActivityAction {
    team: { id: number };
    ids: { to?: number };
    player: ActivityPlayer;
    bidAmount?: number;
    date: number;
    action: ActivityActionType;
  }

  export class Client {
    constructor(options: EspnClientOptions);
    setCookies(cookies: CookieOptions): void;
    getBoxscoreForWeek(options: BoxscoreOptions): Promise<BoxscoreMatchup[]>;
    getTeamsAtWeek(options: { seasonId: number; scoringPeriodId: number }): Promise<EspnTeam[]>;
    getFreeAgents(options: {
      seasonId: number;
      scoringPeriodId: number;
    }): Promise<FreeAgentEntry[]>;
    getHistoricalScoreboardForWeek(options: BoxscoreOptions): Promise<unknown[]>;
    getRecentActivity(options: { seasonId: number }): Promise<ActivityAction[][]>;
  }

  const _default: { Client: typeof Client };
  export default _default;
}
