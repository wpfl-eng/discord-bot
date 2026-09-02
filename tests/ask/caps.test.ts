import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  questionCounts: jest.fn(),
}));

const { loadUsage, decideCaps } = await import('../../ask/caps.js');
const askDb = await import('../../ask/askDb.js');
const { ASK } = await import('../../ask/askConfig.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCounts = askDb.questionCounts as any;

type Decision = ReturnType<typeof decideCaps>;
type Usage = Parameters<typeof decideCaps>[0];

/**
 * CapDecision is a discriminated union -- a refusal always carries its reason,
 * an allowance never does -- so reading either field needs the tag checked
 * first. These keep that narrowing out of every assertion.
 */
const refusalOf = (decision: Decision): string | undefined =>
  decision.allowed ? undefined : decision.refusal;
const noticeOf = (decision: Decision): string | undefined =>
  decision.allowed ? decision.notice : undefined;

const usage = (over: Partial<Usage> = {}): Usage => ({ asked: 0, leagueTotal: 0, ...over });

// Mid-September is EDT (UTC-4), so the New York calendar day containing
// 2026-09-15T18:00Z runs from 04:00Z that day to 04:00Z the next.
const DURING_THE_DAY = new Date('2026-09-15T18:00:00Z');
const DAY_START = new Date('2026-09-15T04:00:00Z');
const MONTH_START = new Date('2026-09-01T04:00:00Z');

describe('caps', () => {
  /**
   * The two counts used to be two queries issued one after the other, and
   * both ran after the session lookup. They are one round trip now, and the
   * preflight issues it alongside the session lookup -- so the hard turn cap
   * no longer saves a query, and the day and month windows are what this
   * suite checks the query is given.
   */
  describe('the day and month it counts', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockCounts.mockResolvedValue(usage());
    });

    test('asks for both counts in one query, from midnight and from the first, in New York', async () => {
      await loadUsage('u1', DURING_THE_DAY);

      expect(mockCounts).toHaveBeenCalledTimes(1);
      expect(mockCounts).toHaveBeenCalledWith('u1', DAY_START, MONTH_START);
    });

    test('a question just before midnight and one just after fall in different days', async () => {
      await loadUsage('u1', new Date('2026-09-16T03:59:00Z'));
      const beforeMidnight: Date = mockCounts.mock.calls[0][1] as Date;

      await loadUsage('u1', new Date('2026-09-16T04:01:00Z'));
      const afterMidnight: Date = mockCounts.mock.calls[1][1] as Date;

      expect(beforeMidnight.toISOString()).toBe('2026-09-15T04:00:00.000Z');
      expect(afterMidnight.toISOString()).toBe('2026-09-16T04:00:00.000Z');
    });

    test('handles a winter date, when New York is UTC-5', async () => {
      await loadUsage('u1', new Date('2026-01-15T18:00:00Z'));

      expect(mockCounts).toHaveBeenCalledWith(
        'u1',
        new Date('2026-01-15T05:00:00Z'),
        new Date('2026-01-01T05:00:00Z')
      );
    });

    test('returns what the query counted', async () => {
      mockCounts.mockResolvedValue(usage({ asked: 3, leagueTotal: 312 }));

      expect(await loadUsage('u1', DURING_THE_DAY)).toEqual({ asked: 3, leagueTotal: 312 });
    });
  });

  describe('daily cap', () => {
    test('allows the question one short of the limit', () => {
      const decision: Decision = decideCaps(
        usage({ asked: ASK.DAILY_QUESTIONS_PER_USER - 1 }),
        0,
        DURING_THE_DAY
      );

      expect(decision.allowed).toBe(true);
    });

    test('refuses at the limit, naming the limit and when it resets', () => {
      const decision: Decision = decideCaps(
        usage({ asked: ASK.DAILY_QUESTIONS_PER_USER }),
        0,
        DURING_THE_DAY
      );

      expect(decision.allowed).toBe(false);
      expect(refusalOf(decision)).toContain(String(ASK.DAILY_QUESTIONS_PER_USER));
      expect(refusalOf(decision)).toMatch(/midnight|reset/i);
    });

    test('refuses past the limit', () => {
      expect(
        decideCaps(usage({ asked: ASK.DAILY_QUESTIONS_PER_USER + 5 }), 0, DURING_THE_DAY).allowed
      ).toBe(false);
    });
  });

  describe('monthly cap', () => {
    test('allows the query one short of the league-wide limit', () => {
      expect(
        decideCaps(usage({ leagueTotal: ASK.MONTHLY_QUERIES_TOTAL - 1 }), 0, DURING_THE_DAY).allowed
      ).toBe(true);
    });

    test('refuses at the league-wide limit, naming the month it is paused for', () => {
      const decision: Decision = decideCaps(
        usage({ leagueTotal: ASK.MONTHLY_QUERIES_TOTAL }),
        0,
        DURING_THE_DAY
      );

      expect(decision.allowed).toBe(false);
      expect(refusalOf(decision)).toContain(String(ASK.MONTHLY_QUERIES_TOTAL));
      expect(refusalOf(decision)).toContain('September');
    });
  });

  describe('turn caps', () => {
    test('says nothing at 14 turns', () => {
      const decision: Decision = decideCaps(usage(), 14, DURING_THE_DAY);

      expect(decision.allowed).toBe(true);
      expect(noticeOf(decision)).toBeUndefined();
    });

    test('nudges at the soft cap of 15 but still answers', () => {
      const decision: Decision = decideCaps(usage(), 15, DURING_THE_DAY);

      expect(decision.allowed).toBe(true);
      expect(noticeOf(decision)).toMatch(/\/ask/);
    });

    test('keeps nudging at 16 and 19', () => {
      expect(noticeOf(decideCaps(usage(), 16, DURING_THE_DAY))).toBeDefined();
      expect(noticeOf(decideCaps(usage(), 19, DURING_THE_DAY))).toBeDefined();
      expect(decideCaps(usage(), 19, DURING_THE_DAY).allowed).toBe(true);
    });

    test('declines at the hard cap of 20 and says why', () => {
      const decision: Decision = decideCaps(usage(), 20, DURING_THE_DAY);

      expect(decision.allowed).toBe(false);
      expect(refusalOf(decision)).toMatch(/\/ask/);
    });

    test('still declines at 21', () => {
      expect(decideCaps(usage(), 21, DURING_THE_DAY).allowed).toBe(false);
    });
  });

  describe('which limit is reported when more than one is hit', () => {
    // DAILY_QUESTIONS_PER_USER and HARD_TURN_CAP are both 20 today, so these
    // assert on the text that distinguishes the two refusals rather than on a
    // number that would match either by coincidence.
    test('reports the thread being finished before the personal quota', () => {
      const decision: Decision = decideCaps(
        usage({ asked: ASK.DAILY_QUESTIONS_PER_USER }),
        ASK.HARD_TURN_CAP,
        DURING_THE_DAY
      );

      expect(refusalOf(decision)).toMatch(/thread/i);
      expect(refusalOf(decision)).not.toMatch(/today|daily limit/i);
    });

    test('reports the personal quota before the league-wide one', () => {
      const decision: Decision = decideCaps(
        usage({ asked: ASK.DAILY_QUESTIONS_PER_USER, leagueTotal: ASK.MONTHLY_QUERIES_TOTAL }),
        0,
        DURING_THE_DAY
      );

      expect(refusalOf(decision)).toMatch(/today/i);
      expect(refusalOf(decision)).not.toContain('September');
    });
  });
});
