import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("roll")
  .setDescription("Roll a dice")
  .addIntegerOption((option) =>
    option
      .setName("sides")
      .setDescription("Number of sides on die")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option.setName("dice").setDescription("How many dice (default 1)")
  )
  .addBooleanOption((option) =>
    option.setName("hidden").setDescription("is roll hidden (default public)")
  );

export async function execute(interaction) {
  const diceSides = interaction.options.getInteger("sides");
  const numberDice = interaction.options.getInteger("dice") || 1;
  const isHidden = interaction.options.getBoolean("hidden") || false;

  if (diceSides < 1) {
    await interaction.reply({
      content: "Dice must have at least one side.",
      ephemeral: true,
    });
    return;
  }
  const roll = Math.floor(Math.random() * sides) + 1;
  await interaction.reply({
    content: `${numberDice}d${diceSides} => ${roll}`,
    ephemeral: isHidden,
  });
}
