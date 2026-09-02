import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { PermissionFlagsBits } from 'discord.js';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  countUserQuestionsSince: jest.fn(async () => 0),
  countAllQuestionsSince: jest.fn(async () => 312),
  countByUserSince: jest.fn(async () => [{ userId: '120231673722830849', count: 3 }]),
  recentRuns: jest.fn(async () => []),
  recentThumbsDown: jest.fn(async () => []),
  recordFeedback: jest.fn(),
  feedbackCounts: jest.fn(),
}));
jest.unstable_mockModule('../../wpfl/artifactSync.js', () => ({
  ensureFresh: jest.fn(async () => ({ kind: 'reshredded', files: 53, etag: 'abc' })),
}));

const { data, execute, renderStatus, renderUsage, renderSync } =
  await import('../../discordCommands/askadmin/askadmin.js');
const { isAskPaused, setAskPaused } = await import('../../ask/pause.js');
const { ASK } = await import('../../ask/askConfig.js');
const artifactSync = await import('../../wpfl/artifactSync.js');

/**
 * The one thing needed weekly in season is a resync after draft-2026's
 * Tuesday republish, which otherwise waits up to six hours or needs SSH to
 * the host. The rest is what makes the ledger and the feedback readable
 * without a database client (log Stage 14, decision 17).
 */
describe('/ask-admin', () => {
  describe('the command definition', () => {
    test('is hidden from everyone without Administrator, by Discord itself', () => {
      const json = data.toJSON();

      expect(json.name).toBe('ask-admin');
      expect(json.default_member_permissions).toBe(PermissionFlagsBits.Administrator.toString());
    });

    test('offers status, resync, usage, pause and resume, and nothing else', () => {
      const names: string[] = (data.toJSON().options ?? []).map((o) => o.name).sort();

      expect(names).toEqual(['pause', 'resume', 'resync', 'status', 'usage']);
    });
  });

  describe('the renderings', () => {
    test('status says what the bot is running on and whether it can answer at all', () => {
      const text: string = renderStatus({
        dataDir: '/home/bot/wpfl-data',
        asOf: {
          generated: '2026-08-28 21:20',
          factsAsOf: '2026-08-28',
          newsAsOf: '2026-08-28',
          etag: '75c67b38',
          cacheFetchedAt: '2026-09-02',
        },
        extents: {
          'player_scores.jsonl': { seasonMin: 2015, seasonMax: 2025, latestWeek: 18 },
        },
        inFlight: 1,
        activeThreads: 2,
        credential: false,
        paused: true,
      });

      expect(text).toContain('2026-08-28 21:20');
      expect(text).toContain('75c67b38');
      expect(text).toMatch(/player_scores.*2015.*2025.*week 18/);
      expect(text).toMatch(/in flight.*1/i);
      expect(text).toMatch(/paused.*yes/i);
      expect(text).toMatch(/credential.*no/i);
    });

    test('usage names members rather than snowflakes, and says where the month stands', () => {
      const text: string = renderUsage({
        monthTotal: 312,
        today: [{ userId: '120231673722830849', count: 3 }],
        runs: [
          {
            userId: '120231673722830849',
            threadId: 't1',
            prompt: 'why did Jimmy get an A+?',
            subtype: 'success',
            costUsd: 0.1473,
            durationMs: 42000,
            counted: true,
            error: null,
            createdAt: new Date('2026-09-02T12:00:00Z'),
          },
        ],
        thumbsDown: [
          {
            messageId: 'm1',
            threadId: 't9',
            userId: '286718589220945920',
            updatedAt: new Date('2026-09-02T12:30:00Z'),
          },
        ],
      });

      expect(text).toMatch(/312.*1500/);
      expect(text).toContain('AJ Boorde');
      expect(text).not.toContain('120231673722830849');
      expect(text).toContain('why did Jimmy get an A+?');
      expect(text).toMatch(/42\s?s/);
      expect(text).toContain('t9');
      expect(text).toContain('Nixon Ball');
    });

    test('sync outcomes read as one line each', () => {
      expect(renderSync({ kind: 'reshredded', files: 53, etag: 'abc' })).toMatch(/53 files/);
      expect(renderSync({ kind: 'unchanged' })).toMatch(/unchanged/i);
      expect(renderSync({ kind: 'failed', reason: 'HTTP 502' })).toMatch(/HTTP 502/);
      expect(renderSync({ kind: 'fresh' })).toMatch(/fresh/i);
    });
  });

  describe('execute', () => {
    const interaction = (subcommand: string, userId: string = ASK.ADMIN_USER_IDS[0]): never =>
      ({
        options: { getSubcommand: (): string => subcommand },
        user: { id: userId },
        reply: jest.fn(async () => undefined),
        deferReply: jest.fn(async () => undefined),
        editReply: jest.fn(async () => undefined),
      }) as never;

    beforeEach(() => {
      setAskPaused(false);
      jest.clearAllMocks();
    });

    /**
     * Administrator only hides the command, and any server admin can hand it
     * out from Server Settings. The pause switch is the commish's, so the
     * command checks the user id itself, before it does anything at all.
     */
    test('refuses anyone but the commish, ephemerally, before deferring or acting', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const i = interaction('pause', '999999999999999999');

      await execute(i);

      expect(isAskPaused()).toBe(false);
      expect((i as { reply: jest.Mock }).reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/commish/i) })
      );
      expect((i as { deferReply: jest.Mock }).deferReply).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('999999999999999999'));
      warn.mockRestore();
    });

    test('the commish is the one id in the allowlist', () => {
      expect(ASK.ADMIN_USER_IDS).toEqual(['120231673722830849']);
    });

    test('pause and resume flip the switch the /ask entry points read', async () => {
      await execute(interaction('pause'));
      expect(isAskPaused()).toBe(true);

      await execute(interaction('resume'));
      expect(isAskPaused()).toBe(false);
    });

    test('resync forces the sync and reports what it did', async () => {
      const i = interaction('resync');

      await execute(i);

      expect(artifactSync.ensureFresh).toHaveBeenCalledWith({ force: true });
      expect((i as { editReply: jest.Mock }).editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/53 files/) })
      );
    });

    test('answers ephemerally, after deferring', async () => {
      const i = interaction('status');

      await execute(i);

      expect((i as { deferReply: jest.Mock }).deferReply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true })
      );
      expect((i as { editReply: jest.Mock }).editReply).toHaveBeenCalled();
    });
  });
});
