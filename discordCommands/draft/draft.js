import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("draft")
  .setDescription("Print a countdown for the draft");

export async function execute(interaction) {
  const draftTime = "Who the fuck knows! Lets doodle about it.";
  await interaction.reply({ content: draftTime });
}
