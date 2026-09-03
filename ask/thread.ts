/**
 * An /ask conversation in a channel or thread: whether a message continues
 * one, the answer pipeline, and the session's lifetime (design §6.1-§6.3).
 *
 * The slash command in discordCommands/ask/ask.ts and the gateway handlers
 * index.ts wires -- messageCreate, ThreadUpdate, the startup identity check --
 * all land here. Shared logic lives outside /discordCommands, and a command
 * module that index.ts also imports as a library was neither one thing nor
 * the other.
 *
 * What stands between a question and a run -- the pause switch, the
 * credential, the caps, the freshness of the shred -- is preflight.ts.
 */

import {
  ChannelType,
  Constants,
  type Guild,
  type Message,
  type SendableChannels,
  type User,
} from 'discord.js';
import { NO_MENTIONS } from '../interactions/renderedMessage.js';
import { preflight, type Preflight } from './preflight.js';
import { runAsk, type AskOutcome, type OpsFailure } from './askRunner.js';
import { enqueueInThread, type Admitted } from './threadQueue.js';
import {
  createTicker,
  createThrottledEditor,
  splitForDiscord,
  wrapPipeTables,
  type Ticker,
} from './ticker.js';
import { getSession, openSession, recordTurn, closeSession, type AskSession } from './askDb.js';
import { wpflMembers, type WpflMember } from '../constants/wpflMembers.js';
import { truncate } from '../helpers/utils.js';
import { logError } from '../errors/errorHandler.js';
import { feedbackRow } from './askFeedback.js';

const THREAD_TYPES: readonly ChannelType[] = Constants.ThreadChannelTypes;

/**
 * Whether a question asked here gets a thread of its own, per §6.1's table.
 *
 * Only GuildText and GuildAnnouncement do: `Message.startThread()` throws
 * `MessageThreadParent` anywhere else
 * (`node_modules/discord.js/src/structures/Message.js:1035`). Everything else
 * answers in place, which degrades rather than breaks.
 */
export function opensThread(channelType: ChannelType): boolean {
  return channelType === ChannelType.GuildText || channelType === ChannelType.GuildAnnouncement;
}

/**
 * The session to resume, or null to start fresh. A closed session's
 * transcript has been pruned by the SDK, so resuming it would fail (§6.2).
 */
export function resumeFrom(session: AskSession | null): string | null {
  return session !== null && !session.closed ? session.session_id : null;
}

/** Discord caps a thread name at 100 characters. */
export function threadName(question: string): string {
  const trimmed: string = question.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? 'Question' : truncate(trimmed, 100);
}

/**
 * Resolve all 14 snowflakes against the guild on startup.
 *
 * A wrong snowflake means the bot answers, confidently and in public, about
 * someone else's roster — and the grounding rule cannot catch it, because every
 * number it cites will be correctly sourced from the wrong file (§7).
 *
 * One gateway request for all 14 ids rather than 14 REST round trips; an id
 * that does not resolve is simply absent from what comes back.
 *
 * @returns the canonical owner names that did not resolve.
 */
export async function checkIdentityMapping(guild: Guild): Promise<string[]> {
  const found = await guild.members.fetch({
    user: wpflMembers.map((member: WpflMember): string => member.discordId),
  });
  const unresolved: string[] = wpflMembers
    .filter((member: WpflMember): boolean => !found.has(member.discordId))
    .map((member: WpflMember): string => member.owner);

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
  /** A rename, a pin, a join: Discord fills `content` for some of these. */
  system: boolean;
  content: string;
}): boolean {
  return (
    !message.authorIsBot &&
    !message.system &&
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
 * Continue an /ask thread from an ordinary message in it (§6.2). Any owner
 * may, by addressing the bot; the opener of a thread the bot created just
 * types. Anyone else who addresses it is told, in a reply, that it answers
 * owners. Each owner's turn counts against their own daily cap.
 */
export async function continueThread(message: Message): Promise<void> {
  if (
    !isAskThreadMessage({
      channelType: message.channel.type,
      authorIsBot: message.author.bot,
      system: message.system === true,
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
        // An explicit @mention only. By default `has()` is also true for
        // @everyone and @here, and for any role the bot happens to hold, so
        // "@here look at this" spawned a run on the speaker's cap.
        mentionsBot:
          (bot !== null &&
            message.mentions.has(bot, {
              ignoreEveryone: true,
              ignoreRoles: true,
              ignoreRepliedUser: true,
            })) ||
          (botRoleId !== null && message.mentions.roles.has(botRoleId)),
        repliedToBot: repliedTo !== null && bot !== null && repliedTo.id === bot.id,
        repliedToPerson: repliedTo !== null && !repliedTo.bot,
      },
      session
    )
  ) {
    return;
  }

  // The session is already in hand, so the preflight is handed it as is.
  const flight: Preflight = await preflight(
    message.author.id,
    async (): Promise<AskSession | null> => session
  );
  if (!flight.ok) {
    await message.reply(flight.refusal);
    return;
  }

  await answer({
    user: message.author,
    member: flight.member,
    destination: message.channel as SendableChannels,
    question: message.content,
    session,
    openedThread: false,
    notice: flight.notice,
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

export interface AnswerRequest {
  readonly user: User;
  /** The owner asking, as the preflight resolved them. */
  readonly member: WpflMember;
  readonly destination: SendableChannels;
  readonly question: string;
  /**
   * The destination's session, when it has one. Null for a thread just
   * opened, whose session is written once the run has an id for it.
   */
  readonly session: AskSession | null;
  /** True only when /ask created the thread it is about to answer in. */
  readonly openedThread: boolean;
  /** A member-facing nudge from the preflight, appended to the answer. */
  readonly notice?: string;
}

/** Shown once, under the first answer of a thread the bot opened. Nobody has to learn a rule. */
export const FOLLOW_UP_HINT = '_Reply or @ me to follow up._';

/** The one line of explanation §6.4 promises when a thread's session has aged out. */
export const CONTEXT_LOST =
  "_This thread had gone quiet long enough that I've lost the earlier context. Starting fresh._";

/**
 * Post the ticker, run the question, publish the answer, record the session.
 *
 * Both entry points come through here, so what a closed session means has one
 * owner: the slash command used to start fresh in silence while a message in
 * the same thread said so.
 */
export async function answer(request: AnswerRequest): Promise<void> {
  const { user, member, destination, question, session, openedThread, notice } = request;
  const resume: string | null = resumeFrom(session);

  if (session !== null && session.closed) {
    await destination.send({ content: CONTEXT_LOST, allowedMentions: NO_MENTIONS });
  }

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
        member,
        messageId: message.id,
        sessionId: resume,
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
  // The prompt states a length cap that nothing enforces. This is how anyone
  // finds out whether it is obeyed: one line in the pm2 log per answer, no
  // schema. A ledger column was the alternative, and in a repo with no
  // migration runner a forgotten migration would have failed every ledger
  // insert -- and the caps count ledger rows.
  console.log(`[ASK] answer ${destination.id}: ${outcome.text.length} chars`);

  await editor.settle();
  const trailer: string[] = [];
  if (notice !== undefined) trailer.push(notice);
  // Only when there is a session to follow up in. A run that died before the
  // SDK issued one writes no row, and a thread with no row ignores every
  // message -- the hint would be an invitation nobody could take.
  if (openedThread && outcome.sessionId !== null) trailer.push(FOLLOW_UP_HINT);
  // The session row and the final post depend on nothing of each other's.
  await Promise.all([
    // A resumed thread keeps whatever it was; only a thread the bot opened
    // itself is the bot's.
    persist(
      destination.id,
      user.id,
      question,
      outcome,
      resume,
      session?.bot_thread ?? openedThread
    ),
    publish(message, destination, ticker, outcome, trailer),
  ]);
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
    } else if (resume !== null && !outcome.counted && outcome.opsFailure === null) {
      // A resume that never reached the SDK's init: the transcript is gone --
      // a thread kept alive past SESSION_RETENTION_DAYS, a changed HOME.
      // Left open, every later message retried the same dead id until the
      // thread archived. Closed, the next one starts fresh and says so.
      await closeSession(threadId);
    } else if (resume !== null) {
      await recordTurn(threadId, outcome.costUsd);
    }
  } catch (error: unknown) {
    logError('ask', 'Could not persist the session', error);
  }
}

/**
 * One line per SDK ops-failure code, written for the member who is reading
 * it. Most need the commissioner; a rate limit, an overload and a server
 * error pass on their own. No person is named in source: it goes stale, and
 * "the commish" does not. Keyed by the runner's type, so a code added there
 * without a line here does not compile.
 */
const OPS_LINES: Readonly<Record<OpsFailure, string>> = {
  authentication_failed:
    '_My Claude login has expired or was rejected. The commish needs to renew it._',
  oauth_org_not_allowed:
    "_My Claude login isn't allowed to run this. The commish needs to look at it._",
  account_on_hold: '_The Claude account I run on is on hold. The commish needs to look at it._',
  billing_error:
    '_The Claude account I run on has a billing problem. The commish needs to look at it._',
  rate_limit: '_Claude is rate-limiting me right now. Try again in a few minutes._',
  overloaded: '_Claude is overloaded right now. Try again in a minute._',
  invalid_request: '_Claude rejected the request I built. The commish needs to look at it._',
  model_not_found:
    "_The Claude model I'm set up to use isn't available. The commish needs to look at it._",
  server_error: '_Claude had a server error. Try again in a minute._',
};

/**
 * The lines appended under an answer, or in place of one: what went wrong,
 * then the trailer the caller built -- a cap notice, the follow-up hint.
 * Exported for its test.
 */
export function suffixLines(outcome: AskOutcome, trailer: readonly string[] = []): string[] {
  const lines: string[] = [];
  if (outcome.timedOut) lines.push('_I stopped at the time limit. Try a narrower question._');
  if (outcome.subtype === 'error_max_budget_usd') {
    lines.push('_I stopped at the per-question budget._');
  }

  if (outcome.opsFailure !== null) {
    lines.push(OPS_LINES[outcome.opsFailure]);
  } else if (outcome.text.trim() === '' && outcome.error !== undefined) {
    lines.push("_Something went wrong and I couldn't finish that one._");
  }

  lines.push(...trailer);
  return lines;
}

async function publish(
  message: Message,
  destination: SendableChannels,
  ticker: Ticker,
  outcome: AskOutcome,
  trailer: readonly string[]
): Promise<void> {
  // The runner's text, not the ticker's: the stream the ticker showed includes
  // whatever the model said before its first tool call, and the SDK's result
  // does not. Uncapped on purpose: the final answer is continued into follow-up
  // messages by splitForDiscord rather than truncated (§6.3).
  const full: string = [
    ticker.renderFinal(wrapPipeTables(outcome.text)),
    ...suffixLines(outcome, trailer),
  ]
    .join('\n\n')
    .trim();
  const parts: string[] = splitForDiscord(full);

  // The buttons ride on the last part, under the end of the answer.
  const buttons = { components: [feedbackRow({ up: 0, down: 0 })] };
  const last: number = parts.length - 1;

  try {
    for (const [index, content] of parts.entries()) {
      const payload = { content, allowedMentions: NO_MENTIONS, ...(index === last ? buttons : {}) };
      if (index === 0) await message.edit(payload);
      else await destination.send(payload);
    }
  } catch (error: unknown) {
    logError('ask', 'Could not post the answer', error);
  }
}
