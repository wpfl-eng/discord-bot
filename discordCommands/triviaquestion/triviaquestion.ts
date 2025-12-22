import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import * as categoryLoader from '../../trivia/categoryLoader.js';

export const data = new SlashCommandBuilder()
  .setName('triviaquestion')
  .setDescription('Manually trigger a trivia question')
  .addStringOption((option) =>
    option
      .setName('category')
      .setDescription('Which trivia category (leave empty for random)')
      .setRequired(false)
      .setAutocomplete(true)
  );

/**
 * Handle autocomplete for category selection
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const categories = await categoryLoader.getAllCategoryNames();

    const filtered = categories
      .filter((c) => c.toLowerCase().includes(focusedValue))
      .slice(0, 25)
      .map((c) => ({ name: c.toUpperCase(), value: c }));

    await interaction.respond(filtered);
  } catch (error) {
    console.error('[TRIVIAQUESTION] Autocomplete error:', error);
    // Return empty list on error to avoid "Application did not respond"
    await interaction.respond([]);
  }
}

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

  const triviaService = interaction.client.triviaService;

  if (!triviaService) {
    await interaction.editReply({
      content: 'Trivia service not initialized!',
    });
    return;
  }

  const category = interaction.options.getString('category');

  try {
    if (category) {
      // Specific category requested - validate it exists
      const validCategories = await categoryLoader.getAllCategoryNames();
      if (!validCategories.includes(category.toLowerCase())) {
        await interaction.editReply({
          content: `Invalid category "${category}". Available: ${validCategories.join(', ')}`,
        });
        return;
      }

      // sendQuestion now handles close-and-replace internally
      await triviaService.sendQuestion(category.toLowerCase());
      await interaction.editReply({
        content: `${category.toUpperCase()} trivia question posted!`,
      });
    } else {
      // Random category
      await triviaService.sendRandomQuestion();
      await interaction.editReply({
        content: 'Random trivia question posted!',
      });
    }
  } catch (error: unknown) {
    console.error('[TRIVIAQUESTION] Error:', error);
    await interaction.editReply({
      content: 'An error occurred. Please try again.',
    });
  }
}
