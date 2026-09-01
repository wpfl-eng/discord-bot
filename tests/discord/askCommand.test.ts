import { describe, test, expect, jest } from '@jest/globals';
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

const { resolveTarget, threadName, checkIdentityMapping, isAskThreadMessage, data } =
  await import('../../discordCommands/ask/ask.js');
const { wpflMembers } = await import('../../constants/wpflMembers.js');

const live = {
  thread_id: 't1',
  session_id: 's1',
  opener_user_id: 'u1',
  question: 'q',
  turns: 3,
  closed: false,
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
});
