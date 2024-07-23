import { SlashCommandBuilder } from "discord.js";
import { sql } from "@vercel/postgres";

export const data = new SlashCommandBuilder()
  .setName("betcreate")
  .setDescription("create a bet with another member")
  .addUserOption((option) =>
    option
      .setName("betuser")
      .setDescription("user who you are making the bet with")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("description")
      .setDescription("description of wager")
      .setRequired(true)
  )
  .addNumberOption((option) =>
    option
      .setName("amount")
      .setDescription("amount being wagered")
      .setRequired(true)
  );

export async function execute(interaction) {
  const bettor = interaction.user.id;
  const betee = interaction.options.getUser("betuser").id;
  const description = interaction.options.getString("description");
  const amountWagered = interaction.options.getNumber("amount");

  if (!bettor || !betee || !description || !amountWagered) {
    await interaction.reply({
      content: "Incorrect information input!",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  try {
    await sql`INSERT INTO Bets (BettorOne, BettorTwo, Description, Amount) VALUES (${bettor}, ${betee}, ${description}, ${amountWagered})`;
    await interaction.editReply({ content: "Bet Added Successfully" });
  } catch (e) {
    console.error("betcreate command error: ", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
      ephemeral: true,
    });
  }
}
