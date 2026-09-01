import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import pkg from 'espn-fantasy-football-api/node.js';
const { Client } = pkg;
import { espnMembers } from '../../constants/espnMembers.js';
import { getCurrentNFLSeason } from '../../helpers/utils.js';
import { resolvePeriod } from '../../helpers/espnPeriod.js';

import type { Boxscore } from 'espn-fantasy-football-api/node.js';

interface Score {
  name: string;
  score: number;
}

export const data = new SlashCommandBuilder()
  .setName('median')
  .setDescription('Get ranked scores for a specific week and year')
  .addIntegerOption((option) =>
    option
      .setName('week')
      .setDescription('The week number (default: 13)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName('year')
      .setDescription('The season (defaults to the current one)')
      .setRequired(false)
      .setMinValue(2018)
      .setMaxValue(getCurrentNFLSeason())
  );

async function getRankedScores(week: number, year: number): Promise<Score[]> {
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    throw new Error('Missing required ESPN environment variables');
  }

  const myClient = new Client({
    leagueId: Number.parseInt(LEAGUE_ID, 10),
  });
  myClient.setCookies({
    espnS2: ESPN_S2,
    SWID,
  });

  const matchups: Boxscore[] = await myClient.getBoxscoreForWeek({
    seasonId: year,
    matchupPeriodId: week,
    scoringPeriodId: week,
  });

  const scores: Score[] = [];

  matchups.forEach((matchup: Boxscore) => {
    const homeMember = espnMembers.find((member) => member.id === matchup.homeTeamId);
    if (homeMember) {
      scores.push({ name: homeMember.name, score: matchup.homeScore });
    }

    if (matchup.awayTeamId) {
      const awayMember = espnMembers.find((member) => member.id === matchup.awayTeamId);
      if (awayMember) {
        scores.push({ name: awayMember.name, score: matchup.awayScore ?? 0 });
      }
    }
  });

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function createEmbed(scores: Score[], week: number, year: number): EmbedBuilder {
  const cutLine: number = 7;
  const safeScores: Score[] = scores.slice(0, cutLine);
  const belowScores: Score[] = scores.slice(cutLine);

  const safeField: string = safeScores
    .map((entry, i) => `${i + 1}. ${entry.name} - ${entry.score}`)
    .join('\n');

  const belowField: string = belowScores
    .map((entry, i) => `${i + cutLine + 1}. ${entry.name} - ${entry.score}`)
    .join('\n');

  const medianScore: number =
    scores.length >= 2
      ? ((scores[cutLine - 1]?.score || 0) + (scores[cutLine]?.score || 0)) / 2
      : 0;

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Week ${week} ${year} Scores`)
    .setDescription(`Cut Line: Top ${cutLine}`)
    .addFields(
      { name: 'Safe', value: safeField || 'None', inline: true },
      { name: 'Below Cut', value: belowField || 'None', inline: true }
    )
    .setFooter({ text: `Median: ${medianScore.toFixed(1)}` })
    .setTimestamp();
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  // Both used to be frozen literals -- week 13 of 2025 -- so the command
  // answered about a season that had finished, and setMaxValue(2025) meant the
  // current one could not even be asked for. The defaults now come from ESPN,
  // which publishes the current week directly, falling back to the calendar
  // arithmetic that got the January rollover wrong twice.
  const { week, season: year } = await resolvePeriod(
    interaction.options.getInteger('week'),
    interaction.options.getInteger('year')
  );

  try {
    const scores: Score[] = await getRankedScores(week, year);
    const embed: EmbedBuilder = createEmbed(scores, week, year);
    await interaction.editReply({ embeds: [embed] });
  } catch (err: unknown) {
    console.error('[MEDIAN] Error:', err);
    await interaction.editReply({
      content: 'An error occurred. Please try again.',
    });
  }
}
