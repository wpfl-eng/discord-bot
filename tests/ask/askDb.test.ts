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

  describe('the caps count what a member is charged for', () => {
    test('the daily count ignores uncounted rows', async () => {
      responses = [{ rows: [{ count: '3' }] }];

      const count: number = await askDb.countUserQuestionsSince('u1', new Date());

      expect(count).toBe(3);
      expect(log[0].text).toMatch(/FROM ask_usage WHERE .*\bcounted\b/);
    });

    test('the monthly count ignores uncounted rows', async () => {
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
