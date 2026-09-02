import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChannelType } from 'discord.js';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  getSession: jest.fn(),
  openSession: jest.fn(),
  recordTurn: jest.fn(),
  closeSession: jest.fn(),
  recordUsage: jest.fn(),
  recordToolException: jest.fn(),
  questionCounts: jest.fn(),
  recordFeedback: jest.fn(),
  feedbackCounts: jest.fn(),
}));

// Neither the network nor a model: execute() is exercised up to the point a
// run would start, which is where every decision under test here lives, and
// once past it with a scripted run.
jest.unstable_mockModule('../../wpfl/artifactSync.js', () => ({
  ensureFresh: jest.fn(async () => ({ kind: 'fresh' })),
}));
jest.unstable_mockModule('../../ask/askRunner.js', () => ({
  runAsk: jest.fn(),
}));

const askDb = await import('../../ask/askDb.js');
const askRunner = await import('../../ask/askRunner.js');
const {
  opensThread,
  resumeFrom,
  threadName,
  checkIdentityMapping,
  isAskThreadMessage,
  continuesConversation,
  onThreadArchived,
  suffixLines,
  CONTEXT_LOST,
} = await import('../../ask/thread.js');
const { execute, data } = await import('../../discordCommands/ask/ask.js');
const { earlyRefusal } = await import('../../ask/preflight.js');
const { NO_MENTIONS } = await import('../../interactions/renderedMessage.js');
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
      expect(opensThread(ChannelType.GuildText)).toBe(true);
      expect(opensThread(ChannelType.GuildAnnouncement)).toBe(true);
    });

    test('a thread of any kind answers in place', () => {
      for (const type of [
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ]) {
        expect(opensThread(type)).toBe(false);
      }
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
        expect(opensThread(type)).toBe(false);
      }
    });
  });

  describe('which session an answer resumes', () => {
    test('a live session continues', () => {
      expect(resumeFrom(live)).toBe('s1');
    });

    test('no session starts fresh', () => {
      expect(resumeFrom(null)).toBeNull();
    });

    // Posting in an archived thread un-archives it in Discord, but the SDK has
    // pruned the transcript by then. Resuming a closed session would fail.
    test('a closed session starts fresh rather than resuming', () => {
      expect(resumeFrom(closed)).toBeNull();
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
      (askDb.questionCounts as jest.Mock).mockImplementation(async () => ({
        asked: ASK.DAILY_QUESTIONS_PER_USER,
        leagueTotal: 0,
      }));
    });

    afterEach(() => {
      process.env = { ...original };
      setAskPaused(false);
    });

    test('defers before it touches the database', async () => {
      await execute(
        interaction({
          channel: { id: 't1', type: ChannelType.PublicThread, isSendable: (): boolean => true },
        })
      );

      expect(calls[0]).toBe('defer');
      expect(calls.indexOf('session')).toBeGreaterThan(0);
    });

    test('does not look up a session for a channel that gets a thread of its own', async () => {
      const i = interaction();

      await execute(i);

      expect(calls).not.toContain('session');
      expect((i as { followUp: jest.Mock }).followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/daily limit/) })
      );
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

    /**
     * The runner switched to the SDK result's final text in Stage 14, and the
     * test on the runner passed -- while publish() went on rendering the
     * ticker's own streamed prose, preamble included. Found by the
     * simplification review, which noticed `outcome.text` had no consumer.
     */
    describe('what gets published', () => {
      const scripted = (text: string): void => {
        (askRunner.runAsk as jest.Mock).mockImplementation(((
          _request: unknown,
          sink: { onText(chunk: string): void }
        ) => {
          sink.onText("I'll start with INDEX.md. ");
          return Promise.resolve({
            text,
            sessionId: 's1',
            subtype: 'success',
            model: 'claude-opus-5',
            costUsd: 0.1,
            numTurns: 2,
            durationMs: 5,
            timedOut: false,
            counted: true,
            opsFailure: null,
          });
        }) as never);
      };

      const posting = (): {
        interaction: never;
        message: { id: string; edit: jest.Mock };
      } => {
        const message = { id: 'm1', edit: jest.fn(async () => undefined) };
        const thread = { id: 'thread-1', send: jest.fn(async () => message) };
        const anchor = { startThread: jest.fn(async () => thread) };
        return { interaction: interaction({ editReply: jest.fn(async () => anchor) }), message };
      };

      beforeEach(() => {
        (askDb.questionCounts as jest.Mock).mockImplementation(async () => ({
          asked: 0,
          leagueTotal: 0,
        }));
      });

      test('publishes the answer the runner settled on, not the streamed preamble', async () => {
        scripted('Jimmy paid $54.');
        const { interaction: i, message } = posting();

        await execute(i);

        const edits: string[] = message.edit.mock.calls.map(
          (call) => (call[0] as { content: string }).content
        );
        expect(edits[edits.length - 1]).toContain('Jimmy paid $54.');
        expect(edits[edits.length - 1]).not.toContain("I'll start with INDEX.md");
        expect(edits[edits.length - 1]).toContain('Reply or @ me');
      });

      test('offers no follow-up hint when the first run never produced a session', async () => {
        (askRunner.runAsk as jest.Mock).mockImplementation((() =>
          Promise.resolve({
            text: '',
            sessionId: null,
            subtype: 'error_during_execution',
            model: null,
            costUsd: 0,
            numTurns: 0,
            durationMs: 5,
            timedOut: false,
            counted: false,
            opsFailure: null,
            error: 'spawn failed',
          })) as never);
        const { interaction: i, message } = posting();

        await execute(i);

        const last = message.edit.mock.calls[message.edit.mock.calls.length - 1][0] as {
          content: string;
        };
        expect(last.content).not.toContain('Reply or @ me');
        expect(askDb.openSession).not.toHaveBeenCalled();
      });

      /**
       * A resume whose transcript the SDK has pruned fails before init. Left
       * open, the session made every later message fail the same way until
       * the thread archived; closed, the next message starts fresh and says so.
       */
      test('a resume that never reached the SDK closes the session instead of counting a turn', async () => {
        (askRunner.runAsk as jest.Mock).mockImplementation((() =>
          Promise.resolve({
            text: '',
            sessionId: 's1',
            subtype: 'error_during_execution',
            model: null,
            costUsd: 0,
            numTurns: 0,
            durationMs: 5,
            timedOut: false,
            counted: false,
            opsFailure: null,
            error: 'No conversation found with session ID: s1',
          })) as never);
        (askDb.getSession as jest.Mock).mockImplementation(async () => live);
        const message = { id: 'm1', edit: jest.fn(async () => undefined) };
        const i = interaction({
          channel: {
            id: 't1',
            type: ChannelType.PublicThread,
            isSendable: (): boolean => true,
            send: jest.fn(async () => message),
          },
          editReply: jest.fn(async () => ({})),
        });

        await execute(i);

        expect(askDb.closeSession).toHaveBeenCalledWith('t1');
        expect(askDb.recordTurn).not.toHaveBeenCalled();
      });

      /**
       * The closed-session rule used to live in two places: a message in the
       * thread said the context was lost, the slash command in the same thread
       * started fresh without a word. One owner now, in answer().
       */
      test('a revived thread whose session was closed starts fresh and says so, from the slash command too', async () => {
        scripted('fresh answer');
        (askDb.getSession as jest.Mock).mockImplementation(async () => closed);
        const message = { id: 'm1', edit: jest.fn(async () => undefined) };
        const send = jest.fn(async () => message);
        const i = interaction({
          channel: {
            id: 't1',
            type: ChannelType.PublicThread,
            isSendable: (): boolean => true,
            send,
          },
          editReply: jest.fn(async () => ({})),
        });

        await execute(i);

        expect((send.mock.calls[0] as unknown[])[0]).toEqual(
          expect.objectContaining({ content: CONTEXT_LOST })
        );
        const request = (askRunner.runAsk as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
        expect(request).toHaveProperty('sessionId', null);
      });
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
      const lines: string[] = suffixLines(outcome({ opsFailure: 'authentication_failed' }));

      expect(lines.join(' ')).toMatch(/login/i);
      expect(lines.join(' ')).toMatch(/commish/i);
    });

    test('tells a member to try again on the two transient failures', () => {
      for (const code of ['rate_limit', 'overloaded']) {
        const lines: string[] = suffixLines(outcome({ opsFailure: code }));
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
        const lines: string[] = suffixLines(outcome({ opsFailure: code, error: 'x' }));
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toMatch(/something went wrong/i);
      }
    });

    test('keeps the generic line for a failure that is not one of the six', () => {
      const lines: string[] = suffixLines(outcome({ error: 'subprocess died' }));

      expect(lines.join(' ')).toMatch(/something went wrong/i);
    });

    test('says nothing about an error when the answer still arrived', () => {
      expect(suffixLines(outcome({ error: 'late failure', text: 'the answer' }))).toEqual([]);
    });

    test('reports the time limit, the budget, and a notice', () => {
      const lines: string[] = suffixLines(
        outcome({ timedOut: true, subtype: 'error_max_budget_usd', text: 'partial' }),
        ['_a notice_']
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
      system: false,
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

    // Discord fills `content` for some system messages: a thread rename
    // arrives as the new name, authored by whoever renamed it.
    test('a system message -- a rename, a pin, a join -- is not a question', () => {
      expect(isAskThreadMessage(message({ system: true, content: 'renamed thread' }))).toBe(false);
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

  /**
   * Once a thread is known to be an ask session, which messages in it are
   * for the bot (design §6.2; log Stage 14, decision 13). Every non-bot
   * message used to be. Fourteen people in a thread after a good answer talk
   * to each other, and every "lol" spawned a subprocess, burned the sender's
   * cap and ate one of the thread's twenty turns.
   */
  describe('which messages are for the bot', () => {
    const inBotThread = { ...live, bot_thread: true };
    const inForeignThread = { ...live, bot_thread: false };
    const signal = (over: Record<string, unknown> = {}) => ({
      authorId: 'someone-else',
      mentionsBot: false,
      repliedToBot: false,
      repliedToPerson: false,
      ...over,
    });

    test('the opener just types, in a thread the bot opened for them', () => {
      expect(continuesConversation(signal({ authorId: 'u1' }), inBotThread)).toBe(true);
    });

    test('anyone else has to mention the bot or reply to it', () => {
      expect(continuesConversation(signal(), inBotThread)).toBe(false);
      expect(continuesConversation(signal({ mentionsBot: true }), inBotThread)).toBe(true);
      expect(continuesConversation(signal({ repliedToBot: true }), inBotThread)).toBe(true);
    });

    test('a reply to a person is for that person, whoever wrote it', () => {
      expect(
        continuesConversation(signal({ authorId: 'u1', repliedToPerson: true }), inBotThread)
      ).toBe(false);
      expect(continuesConversation(signal({ repliedToPerson: true }), inBotThread)).toBe(false);
    });

    test('in a thread the bot did not open, even the opener has to address it', () => {
      expect(continuesConversation(signal({ authorId: 'u1' }), inForeignThread)).toBe(false);
      expect(
        continuesConversation(signal({ authorId: 'u1', mentionsBot: true }), inForeignThread)
      ).toBe(true);
      expect(continuesConversation(signal({ repliedToBot: true }), inForeignThread)).toBe(true);
    });

    test('a mention beats a reply to a person -- the member said both', () => {
      // Replying to a teammate while @-ing the bot is asking the bot about it.
      expect(
        continuesConversation(signal({ mentionsBot: true, repliedToPerson: true }), inBotThread)
      ).toBe(true);
    });
  });

  describe('the startup identity check', () => {
    // One gateway request for every id; whatever does not resolve is absent
    // from the collection that comes back, rather than a thrown REST call each.
    const resolving = (ids: readonly string[]): Map<string, { displayName: string }> =>
      new Map(ids.map((id: string) => [id, { displayName: 'someone' }]));
    const guildWith = (ids: string[]): never =>
      ({
        members: {
          fetch: async ({ user }: { user: string[] }): Promise<Map<string, unknown>> =>
            resolving(user.filter((id: string): boolean => ids.includes(id))),
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

    test('asks for all 14 members in one request', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const requests: string[][] = [];

      await checkIdentityMapping({
        members: {
          fetch: async ({ user }: { user: string[] }): Promise<Map<string, unknown>> => {
            requests.push(user);
            return resolving(user);
          },
        },
      } as never);

      expect(requests).toHaveLength(1);
      expect(new Set(requests[0]).size).toBe(14);
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
