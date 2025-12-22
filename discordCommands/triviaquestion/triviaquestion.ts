import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import * as triviaDb from '../../trivia/triviaDb.js';
import type { TriviaCategory } from '../../trivia/triviaDb.js';

export const data = new SlashCommandBuilder()
  .setName('triviaquestion')
  .setDescription('Manually trigger a trivia question')
  .addStringOption((option) =>
    option
      .setName('category')
      .setDescription('Which trivia to trigger')
      .setRequired(true)
      .addChoices(
        { name: 'NFL', value: 'nfl' }
        // { name: "WPFL", value: "wpfl" }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Check if user is authorized to run trivia command
  const triviaAdminIds: string[] = (process.env.TRIVIA_ADMIN_USER_IDS || '')
    .split(',')
    .filter(Boolean);

  if (triviaAdminIds.length === 0) {
    await interaction.reply({
      content: 'Trivia admin not configured. Set TRIVIA_ADMIN_USER_IDS environment variable.',
      ephemeral: true,
    });
    return;
  }

  if (!triviaAdminIds.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You don't have permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const category = interaction.options.getString('category') as TriviaCategory;
  const triviaService = interaction.client.triviaService;

  if (!triviaService) {
    await interaction.editReply({
      content: 'Trivia service not initialized!',
    });
    return;
  }

  try {
    // Get the trivia channel
    const triviaChannelId: string | undefined = process.env.TRIVIA_CHANNEL_ID;
    const triviaChannel: TextChannel | null = triviaChannelId
      ? ((await interaction.client.channels.fetch(triviaChannelId)) as TextChannel | null)
      : null;

    // Check if there's an active question for this category
    const activeQuestion = await triviaDb.getActiveQuestion(category);

    if (activeQuestion && !activeQuestion.is_closed) {
      // Use closeWindow to properly show results with answer
      await triviaService.closeWindow(category);
      if (triviaChannel) {
        await triviaChannel.send({
          content: `New question incoming...`,
        });
      }
    }

    // Send new question
    await triviaService.sendQuestion(category);

    await interaction.editReply({
      content: `${category.toUpperCase()} trivia question posted!`,
    });
  } catch (error: unknown) {
    console.error('[TRIVIAQUESTION] Error:', error);
    await interaction.editReply({
      content: 'An error occurred. Please try again.',
    });
  }
}
