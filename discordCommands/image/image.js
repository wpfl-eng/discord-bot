import { SlashCommandBuilder } from "discord.js";
import OpenAI from "openai";

export const data = new SlashCommandBuilder()
  .setName("image")
  .setDescription("generate a DALL-E 3 image with a prompt")
  .addStringOption((option) =>
    option
      .setName("query")
      .setDescription("image query to send to DALL-E")
      .setRequired(true)
  );

export async function execute(interaction) {
  const query = interaction.options.getString("query");
  if (!query) {
    await interaction.reply({ content: "No query provided!", ephemeral: true });
    return;
  }
  await interaction.deferReply();
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPEN_API_KEY, // This is also the default, can be omitted
    });
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: query,
      n: 1,
      size: "1024x1024",
    });

    const image_url = response.data[0].url;
    await interaction.editReply(
      image_url || "Talk to AJ something went wrong returning a url"
    );
  } catch (e) {
    console.error("/image error: ", e);
    await interaction.editReply(
      "Talk to AJ something went wrong on generation step"
    );
  }
}
