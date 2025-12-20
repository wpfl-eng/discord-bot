import { SlashCommandBuilder } from 'discord.js';
import * as triviaDb from '../../trivia/triviaDb.js';

export const data = new SlashCommandBuilder()
  .setName('trivia')
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

export async function execute(interaction) {
  // Check if user is authorized to run trivia command
  const triviaAdminIds = process.env.TRIVIA_ADMIN_USER_IDS?.split(',') || [];
  if (triviaAdminIds.length > 0 && !triviaAdminIds.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You don't have permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const category = interaction.options.getString('category');
  const triviaService = interaction.client.triviaService;

  if (!triviaService) {
    await interaction.editReply({
      content: 'Trivia service not initialized!',
    });
    return;
  }

  try {
    // Get the trivia channel
    const triviaChannelId = process.env.TRIVIA_CHANNEL_ID;
    const triviaChannel = triviaChannelId
      ? await interaction.client.channels.fetch(triviaChannelId)
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
  } catch (error) {
    console.error('trivia command error:', error);
    await interaction.editReply({
      content: `Error posting trivia: ${error.message}`,
    });
  }
}
