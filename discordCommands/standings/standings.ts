import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Client } from '../../espnClient.cjs';
import type { EspnTeam } from 'espn-fantasy-football-api/node.js';
import { espnMembers } from '../../constants/espnMembers.js';
import { getCurrentNFLSeason } from '../../helpers/utils.js';

export const data = new SlashCommandBuilder()
  .setName('standings')
  .setDescription('Returns standings by week and year')
  .addIntegerOption((option) =>
    option
      .setName('week')
      .setDescription('Input week of standings')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName('year')
      .setDescription('Input year of standings')
      .setRequired(true)
      .setMinValue(2018)
      .setMaxValue(getCurrentNFLSeason())
  );

export const getStandings = async (
  espnClient: Client,
  matchupYear: number,
  matchupWeek: number
): Promise<string> => {
  const teams: EspnTeam[] = await espnClient.getTeamsAtWeek({
    seasonId: matchupYear,
    scoringPeriodId: matchupWeek,
  });

  const sortedTeams = teams.sort(
    (a: EspnTeam, b: EspnTeam) =>
      (a.finalStandingsPosition ?? a.playoffSeed) - (b.finalStandingsPosition ?? b.playoffSeed)
  );

  return sortedTeams
    .map((team: EspnTeam, index: number) => {
      const member = espnMembers.find((m) => m.id === team.id);
      const memberName = member?.name ?? 'Unknown';
      const position = index + 1;
      const record = `(${team.wins}-${team.losses}-${team.ties})`;

      switch (position) {
        case 1:
          return `#${position} 👑${memberName} ${record}👑`;
        case sortedTeams.length:
          return `#${position} 💩${memberName} ${record}💩`;
        default:
          return `#${position} ${memberName} ${record}`;
      }
    })
    .join('\n');
};

export const execute = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const matchupWeek = interaction.options.getInteger('week');
  const matchupYear = interaction.options.getInteger('year');

  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    await interaction.reply({
      content: 'Missing required environment variables',
      ephemeral: true,
    });
    return;
  }

  if (!matchupWeek || !matchupYear) {
    await interaction.reply({
      content: 'Week and year are required',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const espnClient = new Client({ leagueId: Number.parseInt(LEAGUE_ID, 10) });
    espnClient.setCookies({ espnS2: ESPN_S2, SWID });

    const response = await getStandings(espnClient, matchupYear, matchupWeek);

    await interaction.editReply({ content: response });
  } catch (error: unknown) {
    console.error('[STANDINGS] Error:', error);
    await interaction.editReply({
      content: 'An error occurred. Please try again.',
    });
  }
};
