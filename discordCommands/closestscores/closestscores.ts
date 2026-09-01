import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import pkg from 'espn-fantasy-football-api/node.js';
const { Client } = pkg;
import type { Boxscore } from 'espn-fantasy-football-api/node.js';
import { espnMembers } from '../../constants/espnMembers.js';
import { getCurrentNFLSeason } from '../../helpers/utils.js';
import { getCurrentPeriod, type NFLPeriod } from '../../helpers/espnPeriod.js';

export const data = new SlashCommandBuilder()
  .setName('closestscores')
  .setDescription('Get the closest scores for a specific week and year')
  .addIntegerOption((option) =>
    option
      .setName('week')
      .setDescription('The week number')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName('year')
      .setDescription('The year')
      .setRequired(false)
      .setMinValue(2018)
      .setMaxValue(getCurrentNFLSeason())
  );

async function getMatchups(matchupWeek: number, matchupYear: number): Promise<string> {
  let response = `Week ${matchupWeek} ${matchupYear} Closest Scores:\n`;

  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    return 'Missing required environment variables (LEAGUE_ID, ESPN_S2, or SWID)';
  }

  const myClient = new Client({
    leagueId: Number.parseInt(LEAGUE_ID, 10),
  });
  myClient.setCookies({
    espnS2: ESPN_S2,
    SWID: SWID,
  });

  try {
    const matchups: Boxscore[] = await myClient.getBoxscoreForWeek({
      seasonId: matchupYear,
      matchupPeriodId: matchupWeek,
      scoringPeriodId: matchupWeek,
    });

    matchups.forEach((matchup) => {
      const homeMember = espnMembers.find((member) => member.id === matchup.homeTeamId);
      const awayMember = espnMembers.find((member) => member.id === matchup.awayTeamId);
      const homeMemberName = homeMember?.name ?? 'Unknown';
      const awayMemberName = awayMember?.name ?? 'Unknown';

      if (
        matchup.awayTeamId &&
        matchup.awayScore !== undefined &&
        matchup.homeScore !== undefined
      ) {
        const diffScore = matchup.awayScore - matchup.homeScore;

        if ((-16 < diffScore && diffScore <= 0) || (0 <= diffScore && diffScore < 16)) {
          response += `${homeMemberName}: ${matchup.homeScore} --- ${awayMemberName}: ${matchup.awayScore}\n`;
        }
      }
    });

    return response;
  } catch (err: unknown) {
    console.error(err);
    return 'An error occurred while fetching scores. Please try again later.';
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  // ESPN publishes the current week directly; the calendar arithmetic is the fallback.
  const period: NFLPeriod = await getCurrentPeriod();
  const matchupWeek: number = interaction.options.getInteger('week') ?? period.scoringPeriodId;
  const matchupYear: number = interaction.options.getInteger('year') ?? period.seasonId;

  const response = await getMatchups(matchupWeek, matchupYear);

  await interaction.editReply({
    content: response,
  });
}
