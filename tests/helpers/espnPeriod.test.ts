import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// The fork is mocked rather than reached: this suite is about the fallback and caching logic, and
// a test that needs live ESPN credentials is a test nobody can run.
interface LeagueInfoResponse {
  currentScoringPeriodId?: number;
  currentMatchupPeriodId?: number;
}
const mockGetLeagueInfo = jest.fn<() => Promise<LeagueInfoResponse>>();
const mockSetCookies = jest.fn();

jest.unstable_mockModule('../../espnClient.cjs', () => ({
  Client: class {
    setCookies = mockSetCookies;
    getLeagueInfo = mockGetLeagueInfo;
  },
}));

const mockLogError = jest.fn();
jest.unstable_mockModule('../../errors/index.js', () => ({ logError: mockLogError }));

const { getCurrentPeriod, resolvePeriod, resetPeriodCache } =
  await import('../../helpers/espnPeriod.js');
const { getCurrentNFLWeek, getCurrentNFLSeason } = await import('../../helpers/utils.js');

const CREDENTIALS = { LEAGUE_ID: '457631', ESPN_S2: 'cookie', SWID: '{swid}' };

describe('getCurrentPeriod', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    Object.assign(process.env, CREDENTIALS);
    resetPeriodCache();
    mockGetLeagueInfo.mockReset();
    mockLogError.mockReset();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe('when ESPN answers', () => {
    beforeEach(() => {
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
    beforeEach(() => {});

    test('falls back to the calendar', async () => {
      mockGetLeagueInfo.mockResolvedValue({
        currentScoringPeriodId: undefined,
        currentMatchupPeriodId: undefined,
      });

      const period = await getCurrentPeriod();
      expect(period.source).toBe('calendar');
    });

    describe('when only the matchup period is missing', () => {
      test('still uses ESPN, rather than letting a field nobody reads veto one they do', async () => {
        mockGetLeagueInfo.mockResolvedValue({
          currentScoringPeriodId: 7,
          currentMatchupPeriodId: undefined,
        });

        const period = await getCurrentPeriod();
        expect(period.source).toBe('espn');
        expect(period.scoringPeriodId).toBe(7);
        expect(period.matchupPeriodId).toBe(7);
      });
    });
  });

  describe('when several commands ask at once on a cold cache', () => {
    test('they share one request rather than each issuing their own', async () => {
      mockGetLeagueInfo.mockResolvedValue({
        currentScoringPeriodId: 7,
        currentMatchupPeriodId: 7,
      });

      // The TTL only dedupes once a lookup has resolved, so concurrency needs the in-flight
      // promise to be shared.
      const [a, b, c] = await Promise.all([
        getCurrentPeriod(),
        getCurrentPeriod(),
        getCurrentPeriod(),
      ]);

      expect(mockGetLeagueInfo).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });
  });
});

describe('resolvePeriod', () => {
  beforeEach(() => {
    resetPeriodCache();
    mockGetLeagueInfo.mockReset();
    Object.assign(process.env, CREDENTIALS);
    mockGetLeagueInfo.mockResolvedValue({
      currentScoringPeriodId: 7,
      currentMatchupPeriodId: 7,
    });
  });

  describe('when the user supplied both', () => {
    test('does not ask ESPN at all', async () => {
      const resolved = await resolvePeriod(5, 2024);

      expect(resolved).toEqual({ week: 5, season: 2024 });
      // A round trip at the head of the command, for a value that would be discarded.
      expect(mockGetLeagueInfo).not.toHaveBeenCalled();
    });
  });

  describe('when the user supplied only the week', () => {
    test('fills the season from ESPN and keeps the week', async () => {
      const resolved = await resolvePeriod(5, null);

      expect(resolved.week).toBe(5);
      expect(resolved.season).toBe(getCurrentNFLSeason());
      expect(mockGetLeagueInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the user supplied neither', () => {
    test('fills both', async () => {
      const resolved = await resolvePeriod(null, null);

      expect(resolved).toEqual({ week: 7, season: getCurrentNFLSeason() });
    });
  });
});
