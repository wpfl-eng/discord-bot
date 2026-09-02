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
  type User,
} from 'discord.js';
import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import { ASK } from '../../ask/askConfig.js';
import { checkCaps, type CapDecision } from '../../ask/caps.js';
import { credentialConfigured } from '../../ask/askAuth.js';
import { isAskPaused } from '../../ask/pause.js';
import { NO_MENTIONS } from '../../ask/mentions.js';
import { runAsk, type AskOutcome } from '../../ask/askRunner.js';
import { enqueueInThread, type Admitted } from '../../ask/threadQueue.js';
import {
  createTicker,
  createThrottledEditor,
  splitForDiscord,
  type Ticker,
} from '../../ask/ticker.js';
import {
  getSession,
  openSession,
  recordTurn,
  closeSession,
  type AskSession,
} from '../../ask/askDb.js';
import { ensureFresh } from '../../wpfl/artifactSync.js';
import {
  getWpflMemberByDiscordId,
  wpflMembers,
  type WpflMember,
} from '../../constants/wpflMembers.js';
import { logError } from '../../errors/errorHandler.js';
import { feedbackRow } from './askFeedback.js';

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

export { NO_MENTIONS };

/**
 * The reasons a question is refused before anything is looked up. Paused is
 * the incident switch; unconfigured is what the design's §6.4 promised and
 * publish() never showed, while a subprocess spawned to fail burned the
 * member's cap.
 */
export function earlyRefusal(): string | null {
  if (isAskPaused()) return '_/ask is paused by the commish for the moment. Try again later._';
  if (!credentialConfigured()) {
    return "_I'm not configured to answer questions yet — nobody has given me a Claude credential._";
  }
  return null;
}

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
  //
  // A guard clause rather than a derived boolean: narrowing `session` inside
  // the condition is what lets `session.session_id` be read without a cast, and
  // the cast is what would let a future `AskSession | X` put undefined into
  // `resume` without a word from the typechecker.
  if (session !== null && !session.closed && THREAD_TYPES.includes(channelType)) {
    return { kind: 'in-place', resume: session.session_id };
  }
  return { kind: 'in-place', resume: null };
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

/** What a message in a known ask thread says about who it is for. */
export interface Addressing {
  readonly authorId: string;
  /** The bot's user or its managed role was mentioned. */
  readonly mentionsBot: boolean;
  /** A Discord reply to one of the bot's messages. */
  readonly repliedToBot: boolean;
  /** A Discord reply to a person's message. */
  readonly repliedToPerson: boolean;
}

/**
 * Whether a message in a known ask thread is for the bot (§6.2).
 *
 * A mention or a reply to the bot always is. A reply to a person never is,
 * unless it also mentions the bot -- the member said both. Otherwise, in a
 * thread the bot opened, the member who asked the question just types; anyone
 * else, and everyone in a thread the bot did not open, has to address it.
 * Fourteen people talking to each other after a good answer is the normal
 * case, and each of those messages used to be a query.
 */
export function continuesConversation(message: Addressing, session: AskSession): boolean {
  if (message.mentionsBot || message.repliedToBot) return true;
  if (message.repliedToPerson) return false;
  return session.bot_thread && message.authorId === session.opener_user_id;
}

/**
 * Continue an /ask thread from an ordinary message in it (§6.2). Anyone may,
 * by addressing the bot; the opener of a thread the bot created just types.
 * Each person's turn counts against their own daily cap.
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

  const bot: User | null = message.client.user;
  const botRoleId: string | null = message.guild?.members.me?.roles.botRole?.id ?? null;
  const repliedTo: User | null = message.mentions.repliedUser;
  if (
    !continuesConversation(
      {
        authorId: message.author.id,
        mentionsBot:
          (bot !== null && message.mentions.has(bot)) ||
          (botRoleId !== null && message.mentions.roles.has(botRoleId)),
        repliedToBot: repliedTo !== null && bot !== null && repliedTo.id === bot.id,
        repliedToPerson: repliedTo !== null && !repliedTo.bot,
      },
      session
    )
  ) {
    return;
  }

  const early: string | null = earlyRefusal();
  if (early !== null) {
    await message.reply(early);
    return;
  }

  const decision: CapDecision = await checkCaps(message.author.id, session.turns);
  if (!decision.allowed) {
    await message.reply(decision.refusal);
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
    botThread: session.bot_thread,
    firstAnswer: false,
    ...(decision.notice === undefined ? {} : { notice: decision.notice }),
  });
}

/**
 * Mark a session closed when its thread archives (design §6.2).
 *
 * Threads carry ThreadAutoArchiveDuration.OneDay and the SDK prunes its
 * transcripts after SESSION_RETENTION_DAYS. Without this, a message in a
 * revived thread still passed `resume: <session id>` for a transcript the SDK
 * had already deleted -- so the run failed rather than starting fresh, and the
 * member never saw the line saying the earlier context had aged out.
 *
 * Wired to Events.ThreadUpdate. Only the live-to-archived edge matters; the
 * gateway sends ThreadUpdate for renames and every other edit too.
 */
export async function onThreadArchived(
  before: { archived: boolean | null },
  after: { id: string; archived: boolean | null }
): Promise<void> {
  if (before.archived === true || after.archived !== true) return;

  try {
    await closeSession(after.id);
  } catch (error: unknown) {
    // A gateway handler that throws takes nothing useful with it.
    logError('ask', 'Could not close the session for an archived thread', error);
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const question: string = interaction.options.getString('question', true);
  const channel = interaction.channel;

  if (channel === null || !channel.isSendable()) {
    await interaction.reply({ content: "I can't post here.", ephemeral: true });
    return;
  }

  // Discord gives three seconds for the first response, and the checks below
  // are two serverless Postgres round trips that can wake a suspended database
  // on the first question of the day. So the acknowledgement goes first, and a
  // refusal replaces the placeholder with an ephemeral follow-up (§6.1).
  await interaction.deferReply();

  const early: string | null = earlyRefusal();
  if (early !== null) {
    await refuse(interaction, early);
    return;
  }

  const existing: AskSession | null = await getSession(channel.id);
  const decision: CapDecision = await checkCaps(interaction.user.id, existing?.turns ?? 0);
  if (!decision.allowed) {
    await refuse(interaction, decision.refusal);
    return;
  }

  // Non-fatal: a failed fetch leaves the previous shred in place, and the
  // answer's as-of dates report honestly what it had.
  await ensureFresh();

  const target: AskTarget = resolveTarget(channel.type, existing);
  const opened: Opened = await openDestination(interaction, target, question, channel);

  await answer({
    user: interaction.user,
    destination: opened.destination,
    question,
    resume: target.kind === 'in-place' ? target.resume : null,
    // A resumed thread keeps whatever it was; only a fresh thread the bot
    // opened itself is the bot's.
    botThread: existing?.bot_thread ?? opened.botThread,
    firstAnswer: opened.botThread,
    ...(decision.notice === undefined ? {} : { notice: decision.notice }),
  });
}

/**
 * A refusal after a public defer: delete the placeholder and follow up
 * ephemerally, which Discord permits. If the delete fails, a public refusal
 * is the lesser cost -- a placeholder stuck on "thinking" reads as a broken
 * bot.
 */
async function refuse(interaction: ChatInputCommandInteraction, text: string): Promise<void> {
  try {
    await interaction.deleteReply();
  } catch (error: unknown) {
    logError('ask', 'Could not delete the deferred reply; refusing in public instead', error);
    await interaction.editReply({ content: text, allowedMentions: NO_MENTIONS });
    return;
  }
  await interaction.followUp({ content: text, ephemeral: true });
}

interface Opened {
  readonly destination: SendableChannels;
  /** True only when /ask created the thread it is about to answer in. */
  readonly botThread: boolean;
}

async function openDestination(
  interaction: ChatInputCommandInteraction,
  target: AskTarget,
  question: string,
  channel: SendableChannels
): Promise<Opened> {
  if (target.kind !== 'new-thread') {
    await interaction.editReply({ content: `**${question}**`, allowedMentions: NO_MENTIONS });
    return { destination: channel, botThread: false };
  }

  const anchor: Message = await interaction.editReply({
    content: `**${question}**`,
    allowedMentions: NO_MENTIONS,
  });
  try {
    const thread = await anchor.startThread({
      name: threadName(question),
      autoArchiveDuration: ASK.THREAD_AUTO_ARCHIVE,
    });
    return { destination: thread, botThread: true };
  } catch (error: unknown) {
    // Missing "Create Public Threads" degrades to answering in the channel.
    logError('ask', 'Could not open a thread; answering in the channel instead', error);
    return { destination: channel, botThread: false };
  }
}

interface AnswerRequest {
  readonly user: User;
  readonly destination: SendableChannels;
  readonly question: string;
  readonly resume: string | null;
  /** Whether /ask opened this thread itself; recorded on a fresh session. */
  readonly botThread: boolean;
  /** The first answer in a thread the bot just opened, which carries the follow-up hint once. */
  readonly firstAnswer: boolean;
  readonly notice?: string;
}

/** Shown once, under the first answer of a thread the bot opened. Nobody has to learn a rule. */
export const FOLLOW_UP_HINT = '_Reply or @ me to follow up._';

async function answer(request: AnswerRequest): Promise<void> {
  const { user, destination, question, resume, botThread, firstAnswer, notice } = request;
  const member: WpflMember | undefined = getWpflMemberByDiscordId(user.id);

  const ticker: Ticker = createTicker();
  const message: Message = await destination.send({
    content: ticker.render(),
    allowedMentions: NO_MENTIONS,
  });
  const editor = createThrottledEditor(async (content: string): Promise<void> => {
    await message.edit({ content, allowedMentions: NO_MENTIONS });
  });
  // Wired after the editor exists, because the editor edits the message this
  // ticker's first render produced. The thunk is not called unless an edit is
  // actually going out.
  ticker.onChange((): void => editor.update((): string => ticker.render()));

  // One run at a time in this thread, ahead of the global slot (§6.2). The
  // ticker is already posted, so a wait is visible rather than dead air.
  const admitted: Admitted<AskOutcome> | null = enqueueInThread(destination.id, () =>
    runAsk(
      {
        prompt: question,
        userId: user.id,
        threadId: destination.id,
        owner: member?.owner ?? null,
        espnId: member?.espnId ?? null,
        messageId: message.id,
        ...(resume === null ? {} : { sessionId: resume }),
      },
      ticker
    )
  );
  if (admitted === null) {
    // Past the waiting cap. No run, so no ledger row and no cap slot spent.
    await message.edit({
      content:
        "_One at a time — I'm still on the last one in this thread. Ask again when it lands._",
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  if (admitted.position > 0) ticker.onWaiting(admitted.position);

  const outcome: AskOutcome = await admitted.result;

  await editor.flush();
  await persist(destination.id, user.id, question, outcome, resume, botThread);
  const trailer: string[] = [];
  if (notice !== undefined) trailer.push(notice);
  if (firstAnswer) trailer.push(FOLLOW_UP_HINT);
  await publish(
    message,
    destination,
    ticker,
    outcome,
    trailer.length === 0 ? undefined : trailer.join('\n')
  );
}

async function persist(
  threadId: string,
  userId: string,
  question: string,
  outcome: AskOutcome,
  resume: string | null,
  botThread: boolean
): Promise<void> {
  try {
    // Runs after runAsk() has already written the ledger row. That ordering is
    // fine and is why ask_usage carries no foreign key onto this table: the
    // ledger has to record a run that died before it ever had a session id.
    if (resume === null && outcome.sessionId !== null) {
      await openSession(threadId, outcome.sessionId, userId, question, botThread);
    } else if (resume !== null) {
      await recordTurn(threadId, outcome.costUsd);
    }
  } catch (error: unknown) {
    logError('ask', 'Could not persist the session', error);
  }
}

/**
 * One line per SDK ops-failure code, written for the member who is reading
 * it. The first four need the commissioner; the last two pass on their own.
 * No person is named in source: it goes stale, and "the commish" does not.
 */
const OPS_LINES: ReadonlyMap<SDKAssistantMessageError, string> = new Map<
  SDKAssistantMessageError,
  string
>([
  [
    'authentication_failed',
    '_My Claude login has expired or was rejected. The commish needs to renew it._',
  ],
  [
    'oauth_org_not_allowed',
    "_My Claude login isn't allowed to run this. The commish needs to look at it._",
  ],
  ['account_on_hold', '_The Claude account I run on is on hold. The commish needs to look at it._'],
  [
    'billing_error',
    '_The Claude account I run on has a billing problem. The commish needs to look at it._',
  ],
  ['rate_limit', '_Claude is rate-limiting me right now. Try again in a few minutes._'],
  ['overloaded', '_Claude is overloaded right now. Try again in a minute._'],
]);

/** The lines appended under an answer, or in place of one. Exported for its test. */
export function suffixLines(outcome: AskOutcome, hasProse: boolean, notice?: string): string[] {
  const lines: string[] = [];
  if (outcome.timedOut) lines.push('_I stopped at the time limit. Try a narrower question._');
  if (outcome.subtype === 'error_max_budget_usd') {
    lines.push('_I stopped at the per-question budget._');
  }

  const ops: string | undefined =
    outcome.opsFailure === null ? undefined : OPS_LINES.get(outcome.opsFailure);
  if (ops !== undefined) {
    lines.push(ops);
  } else if (!hasProse && outcome.error !== undefined) {
    lines.push("_Something went wrong and I couldn't finish that one._");
  }

  if (notice !== undefined) lines.push(notice);
  return lines;
}

async function publish(
  message: Message,
  destination: SendableChannels,
  ticker: Ticker,
  outcome: AskOutcome,
  notice?: string
): Promise<void> {
  const suffix: string[] = suffixLines(outcome, ticker.hasProse(), notice);

  // Uncapped on purpose: the final answer is continued into follow-up messages
  // by splitForDiscord rather than truncated (§6.3). The live edits are capped
  // by the throttled editor, which is what writes a single message.
  const full: string = [ticker.render(), ...suffix].join('\n\n').trim();
  const parts: string[] = splitForDiscord(full);

  // The buttons ride on the last part, under the end of the answer.
  const buttons = { components: [feedbackRow({ up: 0, down: 0 })] };

  try {
    await message.edit({
      content: parts[0],
      allowedMentions: NO_MENTIONS,
      ...(parts.length === 1 ? buttons : {}),
    });
    for (const [index, part] of parts.slice(1).entries()) {
      await destination.send({
        content: part,
        allowedMentions: NO_MENTIONS,
        ...(index === parts.length - 2 ? buttons : {}),
      });
    }
  } catch (error: unknown) {
    logError('ask', 'Could not post the answer', error);
  }
}
