/**
 * `/ask` — open-ended questions about the WPFL, answered in a public thread.
 *
 * The interaction token is used exactly once, for the anchor reply. Everything
 * after that is ordinary channel messages, which sidesteps the 15-minute
 * interaction-token expiry entirely — a slow run cannot strand the reply — and
 * gives the ticker the thread's own rate-limit bucket rather than the parent
 * channel's (design §6.1).
 */

import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type SendableChannels,
  type TextChannel,
  type User,
} from 'discord.js';
import { ASK } from '../../ask/askConfig.js';
import { checkCaps, type CapDecision } from '../../ask/caps.js';
import { runAsk, type AskOutcome } from '../../ask/askRunner.js';
import { createTicker, createThrottledEditor, splitForDiscord, type Ticker } from '../../ask/ticker.js';
import { getSession, openSession, recordTurn, type AskSession } from '../../ask/askDb.js';
import { ensureFresh } from '../../wpfl/artifactSync.js';
import { getWpflMemberByDiscordId, wpflMembers, type WpflMember } from '../../constants/wpflMembers.js';
import { logError } from '../../errors/errorHandler.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask anything about the WPFL — the draft, ten years of history, or this season')
  .addStringOption((option) =>
    option
      .setName('question')
      .setDescription('What do you want to know?')
      .setRequired(true)
      .setMaxLength(1000)
  );

export type AskTarget =
  | { readonly kind: 'new-thread' }
  | { readonly kind: 'in-place'; readonly resume: string | null };

const THREAD_TYPES: readonly ChannelType[] = [
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

/**
 * Where this answer goes, per §6.1's table.
 *
 * Only GuildText and GuildAnnouncement may take the thread branch:
 * `Message.startThread()` throws `MessageThreadParent` anywhere else
 * (`node_modules/discord.js/src/structures/Message.js:1035`). Everything else
 * runs in place, which degrades rather than breaks.
 */
export function resolveTarget(channelType: ChannelType, session: AskSession | null): AskTarget {
  if (channelType === ChannelType.GuildText || channelType === ChannelType.GuildAnnouncement) {
    return { kind: 'new-thread' };
  }

  // A closed session's transcript has been pruned by the SDK, so resuming it
  // would fail. Start fresh in the same thread and say so.
  const resumable: boolean = session !== null && !session.closed && THREAD_TYPES.includes(channelType);
  return { kind: 'in-place', resume: resumable ? (session as AskSession).session_id : null };
}

/** Discord caps a thread name at 100 characters. */
export function threadName(question: string): string {
  const trimmed: string = question.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return 'Question';
  return trimmed.length <= 100 ? trimmed : `${trimmed.slice(0, 99)}…`;
}

/**
 * Resolve all 14 snowflakes against the guild on startup.
 *
 * A wrong snowflake means the bot answers, confidently and in public, about
 * someone else's roster — and the grounding rule cannot catch it, because every
 * number it cites will be correctly sourced from the wrong file (§7).
 *
 * @returns the canonical owner names that did not resolve.
 */
export async function checkIdentityMapping(guild: Guild): Promise<string[]> {
  const unresolved: string[] = [];

  for (const member of wpflMembers) {
    try {
      await guild.members.fetch(member.discordId);
    } catch {
      unresolved.push(member.owner);
    }
  }

  if (unresolved.length > 0) {
    console.warn(
      `[ASK] ${unresolved.length} of ${wpflMembers.length} league members did not resolve in this guild: ${unresolved.join(', ')}. ` +
        'Their Discord ids in constants/wpflMembers.ts are wrong or they have left the server. ' +
        '/ask will not resolve "my team" for them.'
    );
  }

  return unresolved;
}

/**
 * Cheap enough to run on every message in the guild, which is what it does.
 * The expensive part -- is this thread a known ask session? -- is only reached
 * once this returns true.
 */
export function isAskThreadMessage(message: {
  channelType: ChannelType;
  authorIsBot: boolean;
  content: string;
}): boolean {
  return (
    !message.authorIsBot &&
    THREAD_TYPES.includes(message.channelType) &&
    message.content.trim() !== ''
  );
}

/**
 * Continue an /ask thread from an ordinary message in it (§6.2). Anyone in the
 * thread may continue it; each person's turn counts against their own daily cap.
 */
export async function continueThread(message: Message): Promise<void> {
  if (
    !isAskThreadMessage({
      channelType: message.channel.type,
      authorIsBot: message.author.bot,
      content: message.content,
    })
  ) {
    return;
  }

  const session: AskSession | null = await getSession(message.channel.id);
  if (session === null) return;

  const decision: CapDecision = await checkCaps(message.author.id, session.turns);
  if (!decision.allowed) {
    await message.reply(decision.refusal ?? 'Not right now.');
    return;
  }

  await ensureFresh();

  if (session.closed) {
    await message.reply(
      "_This thread had gone quiet long enough that I've lost the earlier context. Starting fresh._"
    );
  }

  await answer({
    user: message.author,
    destination: message.channel as SendableChannels,
    question: message.content,
    resume: session.closed ? null : session.session_id,
    ...(decision.notice === undefined ? {} : { notice: decision.notice }),
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const question: string = interaction.options.getString('question', true);
  const channel = interaction.channel;

  if (channel === null || !channel.isSendable()) {
    await interaction.reply({ content: "I can't post here.", ephemeral: true });
    return;
  }

  const existing: AskSession | null = await getSession(channel.id);
  const decision: CapDecision = await checkCaps(interaction.user.id, existing?.turns ?? 0);
  if (!decision.allowed) {
    await interaction.reply({ content: decision.refusal ?? 'Not right now.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Non-fatal: a failed fetch leaves the previous shred in place, and the
  // answer's as-of dates report honestly what it had.
  await ensureFresh();

  const target: AskTarget = resolveTarget(channel.type, existing);
  const destination: SendableChannels = await openDestination(interaction, target, question, channel);

  await answer({
    user: interaction.user,
    destination,
    question,
    resume: target.kind === 'in-place' ? target.resume : null,
    ...(decision.notice === undefined ? {} : { notice: decision.notice }),
  });
}

async function openDestination(
  interaction: ChatInputCommandInteraction,
  target: AskTarget,
  question: string,
  channel: SendableChannels
): Promise<SendableChannels> {
  if (target.kind !== 'new-thread') {
    await interaction.editReply({ content: `**${question}**` });
    return channel;
  }

  const anchor: Message = await interaction.editReply({ content: `**${question}**` });
  try {
    return await anchor.startThread({
      name: threadName(question),
      autoArchiveDuration: ASK.THREAD_AUTO_ARCHIVE,
    });
  } catch (error: unknown) {
    // Missing "Create Public Threads" degrades to answering in the channel.
    logError('ask', 'Could not open a thread; answering in the channel instead', error);
    return channel as TextChannel;
  }
}

interface AnswerRequest {
  readonly user: User;
  readonly destination: SendableChannels;
  readonly question: string;
  readonly resume: string | null;
  readonly notice?: string;
}

async function answer(request: AnswerRequest): Promise<void> {
  const { user, destination, question, resume, notice } = request;
  const member: WpflMember | undefined = getWpflMemberByDiscordId(user.id);

  const ticker: Ticker = createTicker();
  const message: Message = await destination.send(ticker.render());
  const editor = createThrottledEditor(async (content: string): Promise<void> => {
    await message.edit(content);
  });

  const sink = wrap(ticker, () => editor.update(ticker.render()));

  const outcome: AskOutcome = await runAsk(
    {
      prompt: question,
      userId: user.id,
      threadId: destination.id,
      owner: member?.owner ?? null,
      espnId: member?.espnId ?? null,
      ...(resume === null ? {} : { sessionId: resume }),
    },
    sink
  );

  await editor.flush();
  await persist(destination.id, user.id, question, outcome, resume);
  await publish(message, destination, ticker, outcome, notice);
}

/** Re-render on every event, so the ticker reflects the run rather than polling it. */
function wrap(ticker: Ticker, onChange: () => void): Ticker {
  const notify = <T extends unknown[]>(fn: (...args: T) => void) => (...args: T): void => {
    fn.apply(ticker, args);
    onChange();
  };

  return {
    ...ticker,
    onToolCall: notify(ticker.onToolCall),
    onToolInput: notify(ticker.onToolInput),
    onReasoning: notify(ticker.onReasoning),
    onText: notify(ticker.onText),
    onToolSettled: notify(ticker.onToolSettled),
    onQueued: notify(ticker.onQueued),
  };
}

async function persist(
  threadId: string,
  userId: string,
  question: string,
  outcome: AskOutcome,
  resume: string | null
): Promise<void> {
  try {
    // The session row must exist before the ledger row: ask_usage carries a
    // foreign key onto ask_sessions.
    if (resume === null && outcome.sessionId !== null) {
      await openSession(threadId, outcome.sessionId, userId, question);
    } else if (resume !== null) {
      await recordTurn(threadId, outcome.costUsd);
    }
  } catch (error: unknown) {
    logError('ask', 'Could not persist the session', error);
  }
}

async function publish(
  message: Message,
  destination: SendableChannels,
  ticker: Ticker,
  outcome: AskOutcome,
  notice?: string
): Promise<void> {
  const suffix: string[] = [];
  if (outcome.timedOut) suffix.push('_I stopped at the time limit. Try a narrower question._');
  if (outcome.subtype === 'error_max_budget_usd') {
    suffix.push('_I stopped at the per-question budget._');
  }
  if (!ticker.hasProse() && outcome.error !== undefined) {
    suffix.push("_Something went wrong and I couldn't finish that one._");
  }
  if (notice !== undefined) suffix.push(notice);

  const full: string = [ticker.render(), ...suffix].join('\n\n').trim();
  const parts: string[] = splitForDiscord(full);

  try {
    await message.edit(parts[0]);
    for (const part of parts.slice(1)) await destination.send(part);
  } catch (error: unknown) {
    logError('ask', 'Could not post the answer', error);
  }
}
