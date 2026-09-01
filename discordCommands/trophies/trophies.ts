import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { formatNumber, getCurrentNFLSeason } from '../../helpers/utils.js';
import { espnMembers } from '../../constants/espnMembers.js';
import { Client } from '../../espnClient.cjs';
import type { BoxscoreMatchup } from 'espn-fantasy-football-api/node.js';

interface TeamScore {
  score: number;
  team: string;
}

interface TrophyScores {
  lowScore: number;
  lowScoreTeam: string;
  highScore: number;
  highScoreTeam: string;
  closeScore: number;
  closeScoreWinner: string;
  closeScoreLoser: string;
  biggestBlowout: number;
  biggestBlowoutWinner: string;
  biggestBlowoutLoser: string;
  highestScoringLoser: TeamScore;
  lowestScoringWinner: TeamScore;
  totalScore: number;
  matchupCount: number;
}

export const data = new SlashCommandBuilder()
  .setName('trophies')
  .setDescription('Returns trophies by week and year')
  .addIntegerOption((option) =>
    option
      .setName('week')
      .setDescription('Input week of matchup')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName('year')
      .setDescription('Input year of matchup')
      .setRequired(true)
      .setMinValue(2018)
      .setMaxValue(getCurrentNFLSeason())
  );

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

    const boxscores: BoxscoreMatchup[] = await espnClient.getBoxscoreForWeek({
      seasonId: matchupYear,
      matchupPeriodId: matchupWeek,
      scoringPeriodId: matchupWeek,
    });

    const scores = analyzeScores(boxscores);
    const response = formatResponse(matchupWeek, matchupYear, scores);

    await interaction.editReply({ content: response });
  } catch (error: unknown) {
    console.error('[TROPHIES] Error:', error);
    await interaction.editReply({
      content: 'An error occurred. Please try again.',
    });
  }
};

const analyzeScores = (boxscores: BoxscoreMatchup[]): TrophyScores => {
  const initialScores: TrophyScores = {
    lowScore: Infinity,
    lowScoreTeam: '',
    highScore: -Infinity,
    highScoreTeam: '',
    closeScore: Infinity,
    closeScoreWinner: '',
    closeScoreLoser: '',
    biggestBlowout: -Infinity,
    biggestBlowoutWinner: '',
    biggestBlowoutLoser: '',
    highestScoringLoser: { score: -Infinity, team: '' },
    lowestScoringWinner: { score: Infinity, team: '' },
    totalScore: 0,
    matchupCount: 0,
  };

  return boxscores.reduce((scores, { homeTeamId, awayTeamId, homeScore, awayScore }) => {
    const homeMemberName = getMemberName(homeTeamId);
    const awayMemberName = getMemberName(awayTeamId);
    const safeHomeScore = homeScore ?? 0;
    const safeAwayScore = awayScore ?? 0;

    updateHighLowScores(scores, safeHomeScore, homeMemberName);
    updateHighLowScores(scores, safeAwayScore, awayMemberName);
    updateCloseAndBlowoutScores(
      scores,
      safeHomeScore,
      safeAwayScore,
      homeMemberName,
      awayMemberName
    );
    updateHighestScoringLoserAndLowestScoringWinner(
      scores,
      safeHomeScore,
      safeAwayScore,
      homeMemberName,
      awayMemberName
    );
    scores.totalScore += safeHomeScore + safeAwayScore;
    scores.matchupCount += 1;

    return scores;
  }, initialScores);
};

const getMemberName = (teamId: number | undefined): string =>
  espnMembers.find((member) => member.id === teamId)?.name ?? 'Unknown';

const updateHighLowScores = (scores: TrophyScores, score: number, teamName: string): void => {
  if (score > scores.highScore) {
    scores.highScore = score;
    scores.highScoreTeam = teamName;
  }
  if (score < scores.lowScore) {
    scores.lowScore = score;
    scores.lowScoreTeam = teamName;
  }
};

const updateCloseAndBlowoutScores = (
  scores: TrophyScores,
  homeScore: number,
  awayScore: number,
  homeMemberName: string,
  awayMemberName: string
): void => {
  const scoreDifference = Math.abs(homeScore - awayScore);
  const [winner, loser] =
    homeScore > awayScore ? [homeMemberName, awayMemberName] : [awayMemberName, homeMemberName];

  if (scoreDifference !== 0 && scoreDifference < scores.closeScore) {
    scores.closeScore = scoreDifference;
    scores.closeScoreWinner = winner;
    scores.closeScoreLoser = loser;
  }

  if (scoreDifference > scores.biggestBlowout) {
    scores.biggestBlowout = scoreDifference;
    scores.biggestBlowoutWinner = winner;
    scores.biggestBlowoutLoser = loser;
  }
};

const updateHighestScoringLoserAndLowestScoringWinner = (
  scores: TrophyScores,
  homeScore: number,
  awayScore: number,
  homeMemberName: string,
  awayMemberName: string
): void => {
  if (homeScore > awayScore) {
    if (homeScore < scores.lowestScoringWinner.score) {
      scores.lowestScoringWinner = { score: homeScore, team: homeMemberName };
    }
    if (awayScore > scores.highestScoringLoser.score) {
      scores.highestScoringLoser = { score: awayScore, team: awayMemberName };
    }
  } else {
    if (awayScore < scores.lowestScoringWinner.score) {
      scores.lowestScoringWinner = { score: awayScore, team: awayMemberName };
    }
    if (homeScore > scores.highestScoringLoser.score) {
      scores.highestScoringLoser = { score: homeScore, team: homeMemberName };
    }
  }
};

const formatResponse = (week: number, year: number, scores: TrophyScores): string => {
  const weeklyAverageScore = scores.totalScore / (scores.matchupCount * 2);
  return `
Week ${week} ${year} Trophies:
- Lowest Score with ${formatNumber(scores.lowScore)} points: ${scores.lowScoreTeam}
- Highest Score with ${formatNumber(scores.highScore)} points: ${scores.highScoreTeam}
- ${scores.closeScoreWinner} barely beat ${
    scores.closeScoreLoser
  } by a margin of ${formatNumber(scores.closeScore)} points
- ${scores.biggestBlowoutLoser} blown out by ${
    scores.biggestBlowoutWinner
  } by a margin of ${formatNumber(scores.biggestBlowout)} points
- Highest Scoring Loser: ${scores.highestScoringLoser.team} with ${formatNumber(
    scores.highestScoringLoser.score
  )} points
- Lowest Scoring Winner: ${scores.lowestScoringWinner.team} with ${formatNumber(
    scores.lowestScoringWinner.score
  )} points
- Weekly Average Score: ${formatNumber(weeklyAverageScore)} points
`.trim();
};
