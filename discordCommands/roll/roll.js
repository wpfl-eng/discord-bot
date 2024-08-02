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

  const rolls = Array.from(
    { length: numberDice },
    () => Math.floor(Math.random() * diceSides) + 1
  );
  const total = rolls.reduce((sum, roll) => sum + roll, 0);

  const embed = new MessageEmbed()
    .setColor("#0099ff")
    .setTitle("🎲 Dice Roll 🎲")
    .addFields(
      { name: "Number of Dice", value: numberDice.toString(), inline: true },
      { name: "Sides per Die", value: diceSides.toString(), inline: true },
      { name: "Rolls", value: rolls.join(", "), inline: true },
      { name: "Total", value: total.toString(), inline: true }
    )
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    ephemeral: isHidden,
  });
}
