import { describe, test, expect, beforeEach, jest } from '@jest/globals';

/**
 * askDb is mocked everywhere else. This suite reads the SQL it emits, because
 * two Stage 14 decisions live entirely in that SQL: the caps count only rows
 * the member is charged for, and feedback is one vote per person per answer.
 */
type Query = { text: string; values: unknown[] };
const log: Query[] = [];
let responses: { rows: unknown[] }[] = [];

jest.unstable_mockModule('@vercel/postgres', () => ({
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    log.push({ text: strings.join('$').replace(/\s+/g, ' ').trim(), values });
    return responses.shift() ?? { rows: [] };
  },
}));

const askDb = await import('../../ask/askDb.js');

describe('askDb', () => {
  beforeEach(() => {
    log.length = 0;
    responses = [];
  });

  describe('the schema check at boot', () => {
    test('names the tables migration 014 would have created and are not there', async () => {
      responses = [
        {
          rows: [
            { name: 'ask_sessions', present: 'ask_sessions' },
            { name: 'ask_usage', present: null },
            { name: 'ask_tool_calls', present: 'ask_tool_calls' },
            { name: 'ask_feedback', present: null },
          ],
        },
      ];

      expect(await askDb.missingAskTables()).toEqual(['ask_usage', 'ask_feedback']);
      expect(log[0].text).toMatch(/to_regclass/);
      for (const table of ['ask_sessions', 'ask_usage', 'ask_tool_calls', 'ask_feedback']) {
        expect(log[0].text).toContain(`'${table}'`);
      }
    });
  });

  describe('the caps count what a member is charged for', () => {
    test('both counts come from one query, and both ignore uncounted rows', async () => {
      responses = [{ rows: [{ asked: '3', league_total: '312' }] }];
      const day = new Date('2026-09-15T04:00:00Z');
      const month = new Date('2026-09-01T04:00:00Z');

      const counts = await askDb.questionCounts('u1', day, month);

      expect(counts).toEqual({ asked: 3, leagueTotal: 312 });
      expect(log).toHaveLength(1);
      expect(log[0].text).toMatch(/FILTER \(WHERE user_id = \$/);
      expect(log[0].text).toMatch(/FROM ask_usage WHERE .*\bcounted\b/);
      expect(log[0].values).toEqual(['u1', day.toISOString(), month.toISOString()]);
    });

    test("the admin's monthly count ignores uncounted rows too", async () => {
      responses = [{ rows: [{ count: '1200' }] }];

      await askDb.countAllQuestionsSince(new Date());

      expect(log[0].text).toMatch(/FROM ask_usage WHERE .*\bcounted\b/);
    });
  });

  describe('the ledger row', () => {
    test('records whether it counts, what it died of, and where the answer landed', async () => {
      await askDb.recordUsage({
        userId: 'u1',
        threadId: 't1',
        prompt: 'q',
        model: null,
        numTurns: 0,
        costUsd: 0,
        subtype: 'error_during_execution',
        durationMs: 12,
        counted: false,
        error: 'authentication_failed',
        messageId: 'm1',
      });

      expect(log[0].text).toMatch(
        /INSERT INTO ask_usage \(.*\bcounted\b.*\berror\b.*\bmessage_id\b/
      );
      expect(log[0].values).toEqual(expect.arrayContaining([false, 'authentication_failed', 'm1']));
    });
  });

  describe('sessions', () => {
    test('a session records whether the bot opened its thread', async () => {
      await askDb.openSession('t1', 's1', 'u1', 'q', true);

      expect(log[0].text).toMatch(/INSERT INTO ask_sessions \(.*\bbot_thread\b/);
      expect(log[0].values).toContain(true);
    });

    test('reading a session returns bot_thread with the rest', async () => {
      responses = [
        {
          rows: [
            {
              thread_id: 't1',
              session_id: 's1',
              opener_user_id: 'u1',
              question: 'q',
              turns: 1,
              closed: false,
              bot_thread: true,
            },
          ],
        },
      ];

      const session = await askDb.getSession('t1');

      expect(log[0].text).toMatch(/SELECT .*\bbot_thread\b.* FROM ask_sessions/);
      expect(session?.bot_thread).toBe(true);
    });
  });

  /** What /ask-admin usage reads. All read-only, all filtered the way the caps are. */
  describe('the admin views', () => {
    test('counts by member since a moment, most first, counted rows only', async () => {
      responses = [
        {
          rows: [
            { user_id: 'u1', count: '4' },
            { user_id: 'u2', count: '1' },
          ],
        },
      ];

      const counts = await askDb.countByUserSince(new Date());

      expect(counts).toEqual([
        { userId: 'u1', count: 4 },
        { userId: 'u2', count: 1 },
      ]);
      expect(log[0].text).toMatch(/GROUP BY user_id/);
      expect(log[0].text).toMatch(/\bcounted\b/);
      expect(log[0].text).toMatch(/ORDER BY .*DESC/);
    });

    test('lists the most recent runs with what an admin triages on', async () => {
      responses = [
        {
          rows: [
            {
              user_id: 'u1',
              thread_id: 't1',
              prompt: 'why did Jimmy get an A+?',
              subtype: 'success',
              cost_usd: '0.1473',
              duration_ms: 42000,
              counted: true,
              error: null,
              created_at: new Date('2026-09-02T12:00:00Z'),
            },
          ],
        },
      ];

      const runs = await askDb.recentRuns(5);

      expect(runs[0]).toMatchObject({
        userId: 'u1',
        threadId: 't1',
        prompt: 'why did Jimmy get an A+?',
        subtype: 'success',
        costUsd: 0.1473,
        durationMs: 42000,
        counted: true,
        error: null,
      });
      expect(log[0].text).toMatch(/FROM ask_usage ORDER BY created_at DESC LIMIT/);
      expect(log[0].values).toContain(5);
    });

    test('lists the most recent thumbs-downs with their threads', async () => {
      responses = [
        { rows: [{ message_id: 'm1', thread_id: 't1', user_id: 'u2', updated_at: new Date() }] },
      ];

      const downs = await askDb.recentThumbsDown(5);

      expect(downs[0]).toMatchObject({ messageId: 'm1', threadId: 't1', userId: 'u2' });
      expect(log[0].text).toMatch(/FROM ask_feedback WHERE rating = -1/);
    });
  });

  describe('feedback', () => {
    test('is an upsert on the message and the person, so a changed mind overwrites', async () => {
      await askDb.recordFeedback('m1', 't1', 'u1', -1);

      expect(log[0].text).toMatch(/INSERT INTO ask_feedback/);
      expect(log[0].text).toMatch(/ON CONFLICT \(message_id, user_id\) DO UPDATE/);
      expect(log[0].values).toEqual(expect.arrayContaining(['m1', 't1', 'u1', -1]));
    });

    test('counts thumbs up and down for one message', async () => {
      responses = [{ rows: [{ up: '3', down: '1' }] }];

      const counts = await askDb.feedbackCounts('m1');

      expect(counts).toEqual({ up: 3, down: 1 });
      expect(log[0].values).toContain('m1');
    });
  });
});
