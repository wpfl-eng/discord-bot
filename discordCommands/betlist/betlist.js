import { SlashCommandBuilder } from "discord.js";
import { sql } from "@vercel/postgres";

// Define the slash command
export const data = new SlashCommandBuilder()
  .setName("betlist")
  .setDescription("Lists all current bets made");

// Main command execution function
export const execute = async (interaction) => {
  await interaction.deferReply();

  try {
    const result = await sql`SELECT * FROM Bets;`;

    const headers = result.fields.map((field) => field.name);
    const betData = await getBetData(result.rows, headers, interaction);

    const formattedMessage = formatBets(headers, betData);
    await interaction.editReply({
      content: formattedMessage,
    });
  } catch (error) {
    console.error("Error creating bet list: ", error);
    await interaction.editReply({
      content: "Error getting the bet list. Report to owner",
      ephemeral: true,
    });
  }
};

// Helper function to get bet data
const getBetData = async (rows, headers, interaction) => {
  return Promise.all(
    rows.map(async (row) => {
      return Promise.all(
        headers.map(async (header) => {
          if (header === "bettorone" || header === "bettortwo") {
            try {
              const user = await interaction.guild.members.fetch(row[header]);
              return user.nickname || "Unknown";
            } catch (error) {
              console.error(`Error fetching user ${row[header]}: `, error);
              return "Unknown";
            }
          } else {
            return row[header];
          }
        })
      );
    })
  );
};

// Helper function to format bets into a readable list
const formatBets = (headers, betData) => {
  let formattedMessage = "";

  betData.forEach((row) => {
    row.forEach((cell, i) => {
      formattedMessage += `**${headers[i]}**: ${cell}\n`;
    });
    formattedMessage += "\n";
  });

  return formattedMessage;
};
