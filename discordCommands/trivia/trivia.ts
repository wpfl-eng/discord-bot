import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Submit an answer to the current trivia question')
  .addStringOption((option) =>
    option
      .setName('answer')
      .setDescription('Your answer to the trivia question')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  // Access triviaService from client (attached in index.ts)
  const triviaService = interaction.client.triviaService;

  if (!triviaService) {
    await interaction.editReply('Trivia service not initialized!');
    return;
  }

  const answer = interaction.options.getString('answer', true);
  await triviaService.handleSlashAnswer(interaction, answer);
}
