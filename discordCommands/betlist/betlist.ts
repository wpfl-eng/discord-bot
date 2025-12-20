import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { sql, QueryResultRow } from '@vercel/postgres';
import type { Bet } from '../../types/database.js';

// Define the slash command
export const data = new SlashCommandBuilder()
  .setName('betlist')
  .setDescription('Lists all current bets made');

// Main command execution function
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const result = await sql<Bet>`SELECT * FROM Bets;`;

    const headers: string[] = result.fields.map((field) => field.name);
    const betData: (string | number)[][] = await getBetData(result.rows, headers, interaction);

    const formattedMessage: string = formatBets(headers, betData);
    await interaction.editReply({
      content: formattedMessage || 'No bets found.',
    });
  } catch (error: unknown) {
    console.error('Error creating bet list: ', error);
    await interaction.editReply({
      content: 'Error getting the bet list. Report to owner',
    });
  }
}

// Helper function to get bet data
async function getBetData(
  rows: QueryResultRow[],
  headers: string[],
  interaction: ChatInputCommandInteraction
): Promise<(string | number)[][]> {
  return Promise.all(
    rows.map(async (row: QueryResultRow) => {
      return Promise.all(
        headers.map(async (header: string): Promise<string | number> => {
          if (header === 'bettorone' || header === 'bettortwo') {
            try {
              const userId = row[header] as string;
              if (!interaction.guild) {
                return 'Unknown';
              }
              const user = await interaction.guild.members.fetch(userId);
              return user.nickname || user.user.username || 'Unknown';
            } catch (error: unknown) {
              console.error(`Error fetching user ${row[header]}: `, error);
              return 'Unknown';
            }
          } else {
            return row[header] as string | number;
          }
        })
      );
    })
  );
}

// Helper function to format bets into a readable list
function formatBets(headers: string[], betData: (string | number)[][]): string {
  let formattedMessage = '';

  betData.forEach((row: (string | number)[]) => {
    row.forEach((cell: string | number, i: number) => {
      formattedMessage += `**${headers[i]}**: ${cell}\n`;
    });
    formattedMessage += '\n';
  });

  return formattedMessage;
}
