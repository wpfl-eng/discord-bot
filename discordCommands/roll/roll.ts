import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Roll a dice')
  .addIntegerOption((option) =>
    option.setName('sides').setDescription('Number of sides on die').setRequired(true)
  )
  .addIntegerOption((option) => option.setName('dice').setDescription('How many dice (default 1)'))
  .addBooleanOption((option) =>
    option.setName('hidden').setDescription('is roll hidden (default public)')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const diceSides: number | null = interaction.options.getInteger('sides');
  const numberDice: number = interaction.options.getInteger('dice') || 1;
  const isHidden: boolean = interaction.options.getBoolean('hidden') || false;

  if (diceSides === null || diceSides < 1) {
    await interaction.reply({
      content: 'Dice must have at least one side.',
      ephemeral: true,
    });
    return;
  }

  const rolls: number[] = Array.from(
    { length: numberDice },
    () => Math.floor(Math.random() * diceSides) + 1
  );
  const total: number = rolls.reduce((sum, roll) => sum + roll, 0);

  const embed: EmbedBuilder = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎲 Dice Roll 🎲')
    .addFields([
      { name: 'Number of Dice', value: numberDice.toString(), inline: true },
      { name: 'Sides per Die', value: diceSides.toString(), inline: true },
      { name: 'Rolls', value: rolls.join(', '), inline: true },
      { name: 'Total', value: total.toString(), inline: true },
    ])
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    ephemeral: isHidden,
  });
}
