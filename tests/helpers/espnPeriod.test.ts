import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// The fork is mocked rather than reached: this suite is about the fallback and caching logic, and
// a test that needs live ESPN credentials is a test nobody can run.
interface LeagueInfoResponse {
  currentScoringPeriodId?: number;
  currentMatchupPeriodId?: number;
}
const mockGetLeagueInfo = jest.fn<() => Promise<LeagueInfoResponse>>();
const mockSetCookies = jest.fn();

jest.unstable_mockModule('espn-fantasy-football-api/node.js', () => ({
  default: {
    Client: class {
      setCookies = mockSetCookies;
      getLeagueInfo = mockGetLeagueInfo;
    },
  },
}));

const mockLogError = jest.fn();
jest.unstable_mockModule('../../errors/index.js', () => ({ logError: mockLogError }));

const { getCurrentPeriod, resetPeriodCache } = await import('../../helpers/espnPeriod.js');
const { getCurrentNFLWeek, getCurrentNFLSeason } = await import('../../helpers/utils.js');

const CREDENTIALS = { LEAGUE_ID: '457631', ESPN_S2: 'cookie', SWID: '{swid}' };

describe('getCurrentPeriod', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    resetPeriodCache();
    mockGetLeagueInfo.mockReset();
    mockLogError.mockReset();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe('when ESPN answers', () => {
    beforeEach(() => {
      Object.assign(process.env, CREDENTIALS);
      // ESPN's week deliberately disagrees with the calendar, so the assertions cannot pass by
      // coincidence if the fallback runs instead.
      mockGetLeagueInfo.mockResolvedValue({
        currentScoringPeriodId: 7,
        currentMatchupPeriodId: 6,
      });
    });

    test('uses ESPN for the week and reports the source', async () => {
      const period = await getCurrentPeriod();

      expect(period.scoringPeriodId).toBe(7);
      expect(period.matchupPeriodId).toBe(6);
      expect(period.source).toBe('espn');
    });

    test('still takes the season from the calendar', async () => {
      // ESPN cannot say which season it is without being asked about one.
      const period = await getCurrentPeriod();
      expect(period.seasonId).toBe(getCurrentNFLSeason());
    });

    test('caches, so commands share one request rather than one each', async () => {
      await getCurrentPeriod();
      await getCurrentPeriod();
      await getCurrentPeriod();

      expect(mockGetLeagueInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('when credentials are not configured', () => {
    beforeEach(() => {
      const env = process.env as Record<string, string | undefined>;
      delete env.LEAGUE_ID;
      delete env.ESPN_S2;
      delete env.SWID;
    });

    test('falls back to the calendar without calling ESPN', async () => {
      const period = await getCurrentPeriod();

      expect(mockGetLeagueInfo).not.toHaveBeenCalled();
      expect(period.source).toBe('calendar');
      expect(period.scoringPeriodId).toBe(getCurrentNFLWeek());
      expect(period.seasonId).toBe(getCurrentNFLSeason());
    });
  });

  describe('when ESPN fails', () => {
    beforeEach(() => {
      Object.assign(process.env, CREDENTIALS);
      mockGetLeagueInfo.mockRejectedValue(new Error('503 Service Unavailable'));
    });

    test('falls back to the calendar rather than throwing', async () => {
      const period = await getCurrentPeriod();

      expect(period.source).toBe('calendar');
      expect(period.scoringPeriodId).toBe(getCurrentNFLWeek());
    });

    test('logs the failure', async () => {
      await getCurrentPeriod();
      expect(mockLogError).toHaveBeenCalled();
    });

    test('does not cache the fallback, so a later call retries ESPN', async () => {
      await getCurrentPeriod();
      mockGetLeagueInfo.mockResolvedValue({
        currentScoringPeriodId: 9,
        currentMatchupPeriodId: 9,
      });

      const period = await getCurrentPeriod();
      expect(period.source).toBe('espn');
      expect(period.scoringPeriodId).toBe(9);
    });
  });

  describe('when ESPN reports no current period', () => {
    // A league mid-creation, or a season ESPN has not opened yet.
    beforeEach(() => {
      Object.assign(process.env, CREDENTIALS);
    });

    test('falls back to the calendar', async () => {
      mockGetLeagueInfo.mockResolvedValue({
        currentScoringPeriodId: undefined,
        currentMatchupPeriodId: undefined,
      });

      const period = await getCurrentPeriod();
      expect(period.source).toBe('calendar');
    });
  });
});
