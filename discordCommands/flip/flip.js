import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("flip")
  .setDescription("Flip a coin");

export async function execute(interaction) {
  const flip = Math.floor(Math.random() * 2) === 0 ? "heads" : "tails";
  await interaction.reply({ content: flip });
}
