/**
 * `/ask` — open-ended questions about the WPFL, answered in a public thread.
 *
 * The interaction token is used exactly once, for the anchor reply. Everything
 * after that is ordinary channel messages, which sidesteps the 15-minute
 * interaction-token expiry entirely — a slow run cannot strand the reply — and
 * gives the ticker the thread's own rate-limit bucket rather than the parent
 * channel's (design §6.1).
 *
 * Only the slash transport lives here: the acknowledgement, the refusal, the
 * thread. The answer itself, and the messages that continue it, are
 * ask/thread.ts, shared with the gateway handlers index.ts wires; what stands
 * between a question and a run is ask/preflight.ts.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type SendableChannels,
} from 'discord.js';
import { ASK } from '../../ask/askConfig.js';
import { NO_MENTIONS } from '../../interactions/renderedMessage.js';
import { preflight, type Preflight } from '../../ask/preflight.js';
import { getSession, type AskSession } from '../../ask/askDb.js';
import { answer, opensThread, threadName } from '../../ask/thread.js';
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

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const question: string = interaction.options.getString('question', true);
  const channel = interaction.channel;

  if (channel === null || !channel.isSendable()) {
    await interaction.reply({ content: "I can't post here.", ephemeral: true });
    return;
  }

  // Discord gives three seconds for the first response, and the preflight is
  // a serverless Postgres round trip that can wake a suspended database on
  // the first question of the day. So the acknowledgement goes first, and a
  // refusal replaces the placeholder with an ephemeral follow-up (§6.1).
  await interaction.deferReply();

  // A text channel gets a thread of its own, so whatever session the channel
  // itself holds is beside the point and is not looked up. In a thread, the
  // session decides whether this continues a conversation.
  const newThread: boolean = opensThread(channel.type);
  let flight: Preflight;
  try {
    flight = await preflight(
      interaction.user.id,
      newThread
        ? async (): Promise<AskSession | null> => null
        : (): Promise<AskSession | null> => getSession(channel.id)
    );
  } catch (error: unknown) {
    // The preflight is the first thing that touches Postgres. Left to the
    // generic handler, a failure here -- migration 014 not applied, a cold
    // database timing out -- stranded a public "thinking" placeholder.
    logError('ask', 'The preflight failed', error);
    await refuse(
      interaction,
      '_Something went wrong before I could start. The commish has the details._'
    );
    return;
  }
  if (!flight.ok) {
    await refuse(interaction, flight.refusal);
    return;
  }

  const opened: Opened = await openDestination(interaction, newThread, question, channel);
  try {
    await answer({
      user: interaction.user,
      destination: opened.destination,
      question,
      session: flight.session,
      openedThread: opened.botThread,
      notice: flight.notice,
    });
  } catch (error: unknown) {
    // The anchor already shows the question; what failed is posting where the
    // answer goes -- most likely a missing Send Messages in Threads.
    logError('ask', 'Could not post in the destination', error);
    await interaction.followUp({
      content:
        "_I couldn't post the answer. Check that I can send messages in this channel and its threads._",
      ephemeral: true,
    });
  }
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
  newThread: boolean,
  question: string,
  channel: SendableChannels
): Promise<Opened> {
  const anchor: Message = await interaction.editReply({
    content: `**${question}**`,
    allowedMentions: NO_MENTIONS,
  });
  if (!newThread) return { destination: channel, botThread: false };

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
