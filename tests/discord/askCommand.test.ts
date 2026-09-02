import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChannelType } from 'discord.js';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  getSession: jest.fn(),
  openSession: jest.fn(),
  recordTurn: jest.fn(),
  closeSession: jest.fn(),
  recordUsage: jest.fn(),
  recordToolException: jest.fn(),
  countUserQuestionsSince: jest.fn(),
  countAllQuestionsSince: jest.fn(),
}));

// Neither the network nor a model: execute() is exercised up to the point a
// run would start, which is where every decision under test here lives.
jest.unstable_mockModule('../../wpfl/artifactSync.js', () => ({
  ensureFresh: jest.fn(async () => ({ kind: 'fresh' })),
}));
jest.unstable_mockModule('../../ask/askRunner.js', () => ({
  runAsk: jest.fn(),
  OPS_FAILURES: new Set([
    'authentication_failed',
    'oauth_org_not_allowed',
    'account_on_hold',
    'billing_error',
    'rate_limit',
    'overloaded',
  ]),
}));

const askDb = await import('../../ask/askDb.js');
const {
  resolveTarget,
  threadName,
  checkIdentityMapping,
  isAskThreadMessage,
  onThreadArchived,
  execute,
  suffixLines,
  earlyRefusal,
  NO_MENTIONS,
  data,
} = await import('../../discordCommands/ask/ask.js');
const { setAskPaused } = await import('../../ask/pause.js');
const { wpflMembers } = await import('../../constants/wpflMembers.js');
const { ASK } = await import('../../ask/askConfig.js');

const live = {
  thread_id: 't1',
  session_id: 's1',
  opener_user_id: 'u1',
  question: 'q',
  turns: 3,
  closed: false,
  bot_thread: true,
};
const closed = { ...live, closed: true };

describe('the /ask command', () => {
  describe('the command definition', () => {
    test('is registered as /ask with a required question', () => {
      const json = data.toJSON();

      expect(json.name).toBe('ask');
      expect(json.options?.[0].name).toBe('question');
      expect(json.options?.[0].required).toBe(true);
    });
  });

  // Design §6.1's routing table, one case per row.
  describe('where the answer goes', () => {
    test('a text channel gets a thread of its own', () => {
      expect(resolveTarget(ChannelType.GuildText, null)).toEqual({ kind: 'new-thread' });
      expect(resolveTarget(ChannelType.GuildAnnouncement, null)).toEqual({ kind: 'new-thread' });
    });

    test('a thread that is a live ask session continues it', () => {
      expect(resolveTarget(ChannelType.PublicThread, live)).toEqual({
        kind: 'in-place',
        resume: 's1',
      });
    });

    test('a thread that is not an ask session starts a fresh one in place', () => {
      expect(resolveTarget(ChannelType.PublicThread, null)).toEqual({
        kind: 'in-place',
        resume: null,
      });
    });

    // Posting in an archived thread un-archives it in Discord, but the SDK has
    // pruned the transcript by then. Resuming a closed session would fail.
    test('a revived thread whose session was closed starts fresh rather than resuming', () => {
      expect(resolveTarget(ChannelType.PublicThread, closed)).toEqual({
        kind: 'in-place',
        resume: null,
      });
    });

    test('a private or announcement thread behaves like a public one', () => {
      expect(resolveTarget(ChannelType.PrivateThread, live)).toEqual({
        kind: 'in-place',
        resume: 's1',
      });
      expect(resolveTarget(ChannelType.AnnouncementThread, null)).toEqual({
        kind: 'in-place',
        resume: null,
      });
    });

    // startThread throws MessageThreadParent outside GuildText and
    // GuildAnnouncement, so anything else must never take the thread branch.
    test('anything that cannot host a thread runs in place instead of throwing', () => {
      for (const type of [
        ChannelType.GuildVoice,
        ChannelType.GuildStageVoice,
        ChannelType.GuildForum,
        ChannelType.GuildMedia,
        ChannelType.DM,
      ]) {
        expect(resolveTarget(type, null).kind).toBe('in-place');
      }
    });
  });

  /**
   * The session lookup and both cap counts used to run before deferReply().
   * That is two serverless Postgres round trips, which can wake a suspended
   * database on the first question of the day, inside Discord's three-second
   * window -- and when it overran, the member saw "the application did not
   * respond" and nothing was logged. Now the acknowledgement goes first and a
   * refusal replaces the placeholder with an ephemeral follow-up (decision 7).
   */
  describe('the acknowledgement comes first', () => {
    const original: NodeJS.ProcessEnv = { ...process.env };
    let calls: string[];

    const interaction = (over: Record<string, unknown> = {}): never =>
      ({
        options: { getString: (): string => 'why did Jimmy get an A+?' },
        channel: { id: 'c1', type: ChannelType.GuildText, isSendable: (): boolean => true },
        user: { id: 'u1' },
        deferReply: jest.fn(async () => {
          calls.push('defer');
        }),
        deleteReply: jest.fn(async () => {
          calls.push('delete');
        }),
        followUp: jest.fn(async () => {
          calls.push('followUp');
        }),
        editReply: jest.fn(async () => {
          calls.push('editReply');
        }),
        reply: jest.fn(async () => {
          calls.push('reply');
        }),
        ...over,
      }) as never;

    beforeEach(() => {
      calls = [];
      jest.clearAllMocks();
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      setAskPaused(false);
      (askDb.getSession as jest.Mock).mockImplementation(async () => {
        calls.push('session');
        return null;
      });
      // At the daily limit, so every path below ends in a refusal.
      (askDb.countUserQuestionsSince as jest.Mock).mockImplementation(
        async () => ASK.DAILY_QUESTIONS_PER_USER
      );
      (askDb.countAllQuestionsSince as jest.Mock).mockImplementation(async () => 0);
    });

    afterEach(() => {
      process.env = { ...original };
      setAskPaused(false);
    });

    test('defers before it touches the database', async () => {
      await execute(interaction());

      expect(calls[0]).toBe('defer');
      expect(calls.indexOf('session')).toBeGreaterThan(0);
    });

    test('a refusal replaces the placeholder with an ephemeral follow-up', async () => {
      const i = interaction();

      await execute(i);

      expect((i as { deleteReply: jest.Mock }).deleteReply).toHaveBeenCalled();
      expect((i as { followUp: jest.Mock }).followUp).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/daily limit/) })
      );
      expect((i as { reply: jest.Mock }).reply).not.toHaveBeenCalled();
    });

    test('falls back to a public edit when the placeholder cannot be deleted', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const i = interaction({
        deleteReply: jest.fn(async () => {
          throw new Error('Unknown Message');
        }),
      });

      await execute(i);

      expect((i as { editReply: jest.Mock }).editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/daily limit/) })
      );
      expect((i as { followUp: jest.Mock }).followUp).not.toHaveBeenCalled();
      error.mockRestore();
    });

    test('refuses while paused, before any database round trip', async () => {
      setAskPaused(true);
      const i = interaction();

      await execute(i);

      expect(calls).not.toContain('session');
      expect((i as { followUp: jest.Mock }).followUp).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/paused/i) })
      );
    });

    test('says it is not configured when no credential is set, and starts no run', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const i = interaction();

      await execute(i);

      expect(calls).not.toContain('session');
      expect((i as { followUp: jest.Mock }).followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/not configured/i) })
      );
    });

    test('earlyRefusal is null when the bot is ready to answer', () => {
      expect(earlyRefusal()).toBeNull();
    });
  });

  /**
   * The design's §6.4 promised a "not configured" reply and the runner had the
   * text written -- and publish() showed "Something went wrong" instead, for
   * that and for the expired login that a one-year token guarantees. The six
   * SDK ops-failure codes each get a line a member can act on (decision 12).
   */
  describe('what the answer says when the run failed', () => {
    const outcome = (over: Record<string, unknown> = {}) =>
      ({
        text: '',
        sessionId: 's1',
        subtype: 'success',
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        timedOut: false,
        counted: true,
        opsFailure: null,
        ...over,
      }) as never;

    test('names an expired login and who has to fix it', () => {
      const lines: string[] = suffixLines(outcome({ opsFailure: 'authentication_failed' }), false);

      expect(lines.join(' ')).toMatch(/login/i);
      expect(lines.join(' ')).toMatch(/commish/i);
    });

    test('tells a member to try again on the two transient failures', () => {
      for (const code of ['rate_limit', 'overloaded']) {
        const lines: string[] = suffixLines(outcome({ opsFailure: code }), false);
        expect(lines.join(' ')).toMatch(/try again/i);
      }
    });

    test('every ops-failure code has its own line, and none is the generic one', () => {
      for (const code of [
        'authentication_failed',
        'oauth_org_not_allowed',
        'account_on_hold',
        'billing_error',
        'rate_limit',
        'overloaded',
      ]) {
        const lines: string[] = suffixLines(outcome({ opsFailure: code, error: 'x' }), false);
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toMatch(/something went wrong/i);
      }
    });

    test('keeps the generic line for a failure that is not one of the six', () => {
      const lines: string[] = suffixLines(outcome({ error: 'subprocess died' }), false);

      expect(lines.join(' ')).toMatch(/something went wrong/i);
    });

    test('says nothing about an error when the answer still arrived', () => {
      expect(suffixLines(outcome({ error: 'late failure' }), true)).toEqual([]);
    });

    test('reports the time limit, the budget, and a notice', () => {
      const lines: string[] = suffixLines(
        outcome({ timedOut: true, subtype: 'error_max_budget_usd' }),
        true,
        '_a notice_'
      );

      expect(lines.join(' ')).toMatch(/time limit/);
      expect(lines.join(' ')).toMatch(/budget/);
      expect(lines[lines.length - 1]).toBe('_a notice_');
    });
  });

  describe('mentions', () => {
    test('the constant every /ask send and edit carries parses no mentions', () => {
      expect(NO_MENTIONS).toEqual({ parse: [] });
    });
  });

  describe('thread naming', () => {
    test('uses the question', () => {
      expect(threadName('why did Jimmy get an A+?')).toBe('why did Jimmy get an A+?');
    });

    test("stays within Discord's 100-character limit", () => {
      const name: string = threadName('x'.repeat(300));

      expect(name.length).toBeLessThanOrEqual(100);
    });

    test('never produces an empty name', () => {
      expect(threadName('   ').length).toBeGreaterThan(0);
    });
  });

  // index.ts's messageCreate handler currently serves trivia DMs only. The
  // continuation branch has to be cheap to evaluate: it runs on every message
  // in the guild.
  describe('which messages continue a thread', () => {
    const message = (over: Record<string, unknown> = {}) => ({
      channelType: ChannelType.PublicThread,
      authorIsBot: false,
      content: 'what about Neill?',
      ...over,
    });

    test('a person talking in a thread continues it', () => {
      expect(isAskThreadMessage(message())).toBe(true);
    });

    test('anyone in the thread may continue it, not only whoever opened it', () => {
      expect(isAskThreadMessage(message({ authorId: 'someone-else' }))).toBe(true);
    });

    test('the bot never answers itself', () => {
      expect(isAskThreadMessage(message({ authorIsBot: true }))).toBe(false);
    });

    test('a message outside a thread is not a continuation', () => {
      expect(isAskThreadMessage(message({ channelType: ChannelType.GuildText }))).toBe(false);
      expect(isAskThreadMessage(message({ channelType: ChannelType.DM }))).toBe(false);
    });

    test('an empty message -- an image or a sticker -- is not a question', () => {
      expect(isAskThreadMessage(message({ content: '' }))).toBe(false);
      expect(isAskThreadMessage(message({ content: '   ' }))).toBe(false);
    });
  });

  describe('the startup identity check', () => {
    const guildWith = (ids: string[]): never =>
      ({
        members: {
          fetch: async (id: string): Promise<{ displayName: string }> => {
            if (!ids.includes(id)) throw new Error('Unknown Member');
            return { displayName: 'someone' };
          },
        },
      }) as never;

    test('passes when every snowflake resolves', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const unresolved: string[] = await checkIdentityMapping(
        guildWith(wpflMembers.map((m) => m.discordId))
      );

      expect(unresolved).toEqual([]);
      warn.mockRestore();
    });

    // A wrong snowflake means answering, confidently and in public, about
    // someone else's roster -- and grounding cannot catch it, because every
    // number would be correctly sourced from the wrong file.
    test('names every member it could not resolve, and says so loudly', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const missing = wpflMembers[0];

      const unresolved: string[] = await checkIdentityMapping(
        guildWith(wpflMembers.slice(1).map((m) => m.discordId))
      );

      expect(unresolved).toEqual([missing.owner]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test('checks all 14 members', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const seen: string[] = [];

      await checkIdentityMapping({
        members: {
          fetch: async (id: string): Promise<{ displayName: string }> => {
            seen.push(id);
            return { displayName: 'x' };
          },
        },
      } as never);

      expect(seen).toHaveLength(14);
      expect(new Set(seen).size).toBe(14);
      warn.mockRestore();
    });
  });
  /**
   * Design §6.2: "When a thread archives, ask_sessions.closed is set." Nothing
   * did. closeSession() existed, was exported, was mocked here -- and had no
   * caller anywhere in the repo.
   *
   * The consequence is not cosmetic. Threads auto-archive after a day and the
   * SDK prunes its transcripts after seven (cleanupPeriodDays). Without this,
   * a message in a revived thread still passed `resume: <pruned session id>`,
   * so the run failed instead of starting fresh, and the member never got the
   * one line saying the earlier context had aged out.
   */
  describe('closing a session when its thread archives', () => {
    const thread = (over: Record<string, unknown> = {}): never =>
      ({
        id: 't1',
        type: ChannelType.PublicThread,
        archived: true,
        ...over,
      }) as never;

    test('closes the session when a thread goes from live to archived', async () => {
      (askDb.closeSession as jest.Mock).mockClear();

      await onThreadArchived(thread({ archived: false }), thread({ archived: true }));

      expect(askDb.closeSession).toHaveBeenCalledWith('t1');
    });

    test('does nothing when the thread was already archived', async () => {
      (askDb.closeSession as jest.Mock).mockClear();

      await onThreadArchived(thread({ archived: true }), thread({ archived: true }));

      expect(askDb.closeSession).not.toHaveBeenCalled();
    });

    test('does nothing when a thread is un-archived', async () => {
      (askDb.closeSession as jest.Mock).mockClear();

      await onThreadArchived(thread({ archived: true }), thread({ archived: false }));

      expect(askDb.closeSession).not.toHaveBeenCalled();
    });

    test('does nothing for an edit that did not touch the archive flag', async () => {
      (askDb.closeSession as jest.Mock).mockClear();

      await onThreadArchived(
        thread({ archived: false, name: 'old' }),
        thread({ archived: false, name: 'new' })
      );

      expect(askDb.closeSession).not.toHaveBeenCalled();
    });

    test('a failed write is logged, not thrown at the gateway handler', async () => {
      (askDb.closeSession as jest.Mock).mockClear();
      (askDb.closeSession as jest.Mock).mockImplementationOnce(() => {
        throw new Error('postgres is down');
      });
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        onThreadArchived(thread({ archived: false }), thread({ archived: true }))
      ).resolves.toBeUndefined();

      error.mockRestore();
    });
  });
});
