import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  countUserQuestionsSince: jest.fn(),
  countAllQuestionsSince: jest.fn(),
}));

const { checkCaps } = await import('../../ask/caps.js');
const askDb = await import('../../ask/askDb.js');
const { ASK } = await import('../../ask/askConfig.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUserCount = askDb.countUserQuestionsSince as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAllCount = askDb.countAllQuestionsSince as any;

type Decision = Awaited<ReturnType<typeof checkCaps>>;

// Mid-September is EDT (UTC-4), so the New York calendar day containing
// 2026-09-15T18:00Z runs from 04:00Z that day to 04:00Z the next.
const DURING_THE_DAY = new Date('2026-09-15T18:00:00Z');
const DAY_START = new Date('2026-09-15T04:00:00Z');
const MONTH_START = new Date('2026-09-01T04:00:00Z');

describe('caps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserCount.mockResolvedValue(0);
    mockAllCount.mockResolvedValue(0);
  });

  describe('the day and month it counts', () => {
    test('counts from the start of the New York calendar day, not from 24h ago', async () => {
      await checkCaps('u1', 0, DURING_THE_DAY);

      expect(mockUserCount).toHaveBeenCalledWith('u1', DAY_START);
    });

    test('counts the month from the first of the month in New York', async () => {
      await checkCaps('u1', 0, DURING_THE_DAY);

      expect(mockAllCount).toHaveBeenCalledWith(MONTH_START);
    });

    test('a question just before midnight and one just after fall in different days', async () => {
      await checkCaps('u1', 0, new Date('2026-09-16T03:59:00Z'));
      const beforeMidnight: Date = mockUserCount.mock.calls[0][1] as Date;

      jest.clearAllMocks();
      mockUserCount.mockResolvedValue(0);
      mockAllCount.mockResolvedValue(0);

      await checkCaps('u1', 0, new Date('2026-09-16T04:01:00Z'));
      const afterMidnight: Date = mockUserCount.mock.calls[0][1] as Date;

      expect(beforeMidnight.toISOString()).toBe('2026-09-15T04:00:00.000Z');
      expect(afterMidnight.toISOString()).toBe('2026-09-16T04:00:00.000Z');
    });

    test('handles a winter date, when New York is UTC-5', async () => {
      await checkCaps('u1', 0, new Date('2026-01-15T18:00:00Z'));

      expect(mockUserCount).toHaveBeenCalledWith('u1', new Date('2026-01-15T05:00:00Z'));
    });
  });

  describe('daily cap', () => {
    test('allows the question one short of the limit', async () => {
      mockUserCount.mockResolvedValue(ASK.DAILY_QUESTIONS_PER_USER - 1);

      const decision: Decision = await checkCaps('u1', 0, DURING_THE_DAY);

      expect(decision.allowed).toBe(true);
    });

    test('refuses at the limit, naming the limit and when it resets', async () => {
      mockUserCount.mockResolvedValue(ASK.DAILY_QUESTIONS_PER_USER);

      const decision: Decision = await checkCaps('u1', 0, DURING_THE_DAY);

      expect(decision.allowed).toBe(false);
      expect(decision.refusal).toContain(String(ASK.DAILY_QUESTIONS_PER_USER));
      expect(decision.refusal).toMatch(/midnight|reset/i);
    });

    test('refuses past the limit', async () => {
      mockUserCount.mockResolvedValue(ASK.DAILY_QUESTIONS_PER_USER + 5);

      expect((await checkCaps('u1', 0, DURING_THE_DAY)).allowed).toBe(false);
    });
  });

  describe('monthly cap', () => {
    test('allows the query one short of the league-wide limit', async () => {
      mockAllCount.mockResolvedValue(ASK.MONTHLY_QUERIES_TOTAL - 1);

      expect((await checkCaps('u1', 0, DURING_THE_DAY)).allowed).toBe(true);
    });

    test('refuses at the league-wide limit and says the feature is paused for the month', async () => {
      mockAllCount.mockResolvedValue(ASK.MONTHLY_QUERIES_TOTAL);

      const decision: Decision = await checkCaps('u1', 0, DURING_THE_DAY);

      expect(decision.allowed).toBe(false);
      expect(decision.refusal).toMatch(/month/i);
    });
  });

  describe('turn caps', () => {
    test('says nothing at 14 turns', async () => {
      const decision: Decision = await checkCaps('u1', 14, DURING_THE_DAY);

      expect(decision.allowed).toBe(true);
      expect(decision.notice).toBeUndefined();
    });

    test('nudges at the soft cap of 15 but still answers', async () => {
      const decision: Decision = await checkCaps('u1', 15, DURING_THE_DAY);

      expect(decision.allowed).toBe(true);
      expect(decision.notice).toMatch(/\/ask/);
    });

    test('keeps nudging at 16 and 19', async () => {
      expect((await checkCaps('u1', 16, DURING_THE_DAY)).notice).toBeDefined();
      expect((await checkCaps('u1', 19, DURING_THE_DAY)).notice).toBeDefined();
      expect((await checkCaps('u1', 19, DURING_THE_DAY)).allowed).toBe(true);
    });

    test('declines at the hard cap of 20 and says why', async () => {
      const decision: Decision = await checkCaps('u1', 20, DURING_THE_DAY);

      expect(decision.allowed).toBe(false);
      expect(decision.refusal).toMatch(/\/ask/);
    });

    test('still declines at 21', async () => {
      expect((await checkCaps('u1', 21, DURING_THE_DAY)).allowed).toBe(false);
    });

    test('does not spend a quota lookup once the thread is finished', async () => {
      await checkCaps('u1', 21, DURING_THE_DAY);

      expect(mockUserCount).not.toHaveBeenCalled();
      expect(mockAllCount).not.toHaveBeenCalled();
    });
  });

  describe('which limit is reported when more than one is hit', () => {
    test('reports the thread being finished before the personal quota', async () => {
      mockUserCount.mockResolvedValue(ASK.DAILY_QUESTIONS_PER_USER);

      const decision: Decision = await checkCaps('u1', 20, DURING_THE_DAY);

      expect(decision.refusal).toMatch(/\/ask/);
      expect(decision.refusal).not.toContain(String(ASK.DAILY_QUESTIONS_PER_USER));
    });

    test('reports the personal quota before the league-wide one', async () => {
      mockUserCount.mockResolvedValue(ASK.DAILY_QUESTIONS_PER_USER);
      mockAllCount.mockResolvedValue(ASK.MONTHLY_QUERIES_TOTAL);

      const decision: Decision = await checkCaps('u1', 0, DURING_THE_DAY);

      expect(decision.refusal).toContain(String(ASK.DAILY_QUESTIONS_PER_USER));
    });
  });
});
