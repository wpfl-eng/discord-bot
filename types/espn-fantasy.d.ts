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
    player: {
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
    getFreeAgents(options: { seasonId: number; scoringPeriodId: number }): Promise<unknown[]>;
    getHistoricalScoreboardForWeek(options: BoxscoreOptions): Promise<unknown[]>;
    getRecentActivity(options: { seasonId: number }): Promise<ActivityAction[][]>;
  }

  const _default: { Client: typeof Client };
  export default _default;
}
