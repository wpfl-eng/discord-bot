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

  export class Client {
    constructor(options: EspnClientOptions);
    setCookies(cookies: CookieOptions): void;
    getBoxscoreForWeek(options: BoxscoreOptions): Promise<BoxscoreMatchup[]>;
    getTeamsAtWeek(options: { seasonId: number; scoringPeriodId: number }): Promise<unknown[]>;
    getFreeAgents(options: { seasonId: number; scoringPeriodId: number }): Promise<unknown[]>;
    getHistoricalScoreboardForWeek(options: BoxscoreOptions): Promise<unknown[]>;
  }

  const _default: { Client: typeof Client };
  export default _default;
}
