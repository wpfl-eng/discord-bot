import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { sql } from '@vercel/postgres';

export const data = new SlashCommandBuilder()
  .setName('betcreate')
  .setDescription('create a bet with another member')
  .addUserOption((option) =>
    option
      .setName('betuser')
      .setDescription('user who you are making the bet with')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option.setName('description').setDescription('description of wager').setRequired(true)
  )
  .addNumberOption((option) =>
    option.setName('amount').setDescription('amount being wagered').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const bettor: string = interaction.user.id;
  const betUser = interaction.options.getUser('betuser');
  const description: string | null = interaction.options.getString('description');
  const amountWagered: number | null = interaction.options.getNumber('amount');

  if (!betUser || !description || !amountWagered) {
    await interaction.reply({
      content: 'Incorrect information input!',
      ephemeral: true,
    });
    return;
  }

  const betee: string = betUser.id;

  await interaction.deferReply();
  try {
    await sql`INSERT INTO Bets (BettorOne, BettorTwo, Description, Amount) VALUES (${bettor}, ${betee}, ${description}, ${amountWagered})`;
    await interaction.editReply({ content: 'Bet Added Successfully' });
  } catch (error: unknown) {
    console.error('betcreate command error: ', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
