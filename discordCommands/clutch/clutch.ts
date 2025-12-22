import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import fetch from 'node-fetch';
import type { FantasyMatchupResponse } from '../../types/api.js';
import { calculateStats } from '../../helpers/draftTrendsUtils.js';

const API_TIMEOUT_MS = 10000;

interface PlayoffOwnerStats {
  owner: string;
  playoffGames: number;
  playoffWins: number;
  playoffPoints: number[];
  regularPoints: number[];
  eliteGames: number;
  chokeGames: number;
}

interface PlayoffResult extends PlayoffOwnerStats {
  avgPlayoffPoints: number;
  avgRegularPoints: number;
  playoffDiff: number;
  winPct: string;
  bestGame: number;
  worstGame: number;
  consistency: number;
}

interface CloseGameOwnerStats {
  owner: string;
  closeGames: number;
  closeWins: number;
  nailBiters: number;
  nailBiterWins: number;
  margins: number[];
  highScoringWins: number;
  lowScoringLosses: number;
}

interface CloseGameResult extends CloseGameOwnerStats {
  winPct: string;
  nailBiterWinPct: string;
  avgMargin: string;
}

interface HighStakesOwnerStats {
  owner: string;
  highStakesGames: number;
  highStakesWins: number;
  highStakesPoints: number[];
  boom: number;
  bust: number;
}

interface HighStakesResult extends HighStakesOwnerStats {
  avgPoints: number;
  winPct: string;
  boomRate: string;
  bustRate: string;
  bestGame: number;
  consistency: number;
}

interface WeeklyScoreData {
  totalPoints: number;
  gameCount: number;
  games: FantasyMatchupResponse[];
  avgPoints?: number;
}

export const data = new SlashCommandBuilder()
  .setName('clutch')
  .setDescription('Analyze clutch performance - who shows up when it matters most?')
  .addStringOption((option) =>
    option
      .setName('type')
      .setDescription('Type of clutch analysis')
      .setRequired(true)
      .addChoices(
        { name: 'Playoffs - Who dominates December/January', value: 'playoffs' },
        { name: 'Close Games - Performance in games decided by <10 points', value: 'close' },
        { name: 'High Stakes - Best/worst performances in high-scoring weeks', value: 'highstakes' }
      )
  )
  .addIntegerOption((option) =>
    option
      .setName('seasonmin')
      .setDescription('Minimum season year (default: 2015)')
      .setRequired(false)
      .setMinValue(2015)
      .setMaxValue(2025)
  )
  .addIntegerOption((option) =>
    option
      .setName('seasonmax')
      .setDescription('Maximum season year (default: 2025)')
      .setRequired(false)
      .setMinValue(2015)
      .setMaxValue(2025)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const analysisType = interaction.options.getString('type');
    const inputSeasonMin = interaction.options.getInteger('seasonmin');
    const inputSeasonMax = interaction.options.getInteger('seasonmax');

    let seasonMin = inputSeasonMin;
    let seasonMax = inputSeasonMax;

    if (!seasonMin && !seasonMax) {
      seasonMin = 2015;
      seasonMax = 2025;
    } else if (seasonMin && !seasonMax) {
      seasonMax = 2025;
    } else if (!seasonMin && seasonMax) {
      seasonMin = 2015;
    }

    if (seasonMin && seasonMax && seasonMin > seasonMax) {
      [seasonMin, seasonMax] = [seasonMax, seasonMin];
    }

    console.log(`[CLUTCH] Analyzing ${analysisType} for seasons ${seasonMin}-${seasonMax}`);

    let embed: EmbedBuilder;

    switch (analysisType) {
      case 'playoffs':
        embed = await analyzePlayoffPerformance(seasonMin ?? 2015, seasonMax ?? 2025);
        break;
      case 'close':
        embed = await analyzeCloseGamePerformance(seasonMin ?? 2015, seasonMax ?? 2025);
        break;
      case 'highstakes':
        embed = await analyzeHighStakesPerformance(seasonMin ?? 2015, seasonMax ?? 2025);
        break;
      default:
        throw new Error('Invalid analysis type');
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('[CLUTCH] Error:', error);
    await interaction.editReply(
      'An error occurred while analyzing clutch performance. Please try again.'
    );
  }
}

async function analyzePlayoffPerformance(
  seasonMin: number,
  seasonMax: number
): Promise<EmbedBuilder> {
  try {
    console.log(`[CLUTCH] Fetching playoff data for ${seasonMin}-${seasonMax}`);

    const playoffUrl = `https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMin=${seasonMin}&seasonMax=${seasonMax}&weekMin=14&weekMax=17`;
    const regularUrl = `https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMin=${seasonMin}&seasonMax=${seasonMax}&weekMin=1&weekMax=13`;

    const [playoffResponse, regularResponse] = await Promise.all([
      fetch(playoffUrl),
      fetch(regularUrl),
    ]);

    if (!playoffResponse.ok || !regularResponse.ok) {
      throw new Error('Failed to fetch data');
    }

    const playoffData = (await playoffResponse.json()) as FantasyMatchupResponse[];
    const regularData = (await regularResponse.json()) as FantasyMatchupResponse[];

    const ownerStats: Record<string, PlayoffOwnerStats> = {};

    playoffData.forEach((game) => {
      [
        { owner: game.teamA, points: game.teamAPoints, won: game.teamAPoints > game.teamBPoints },
        { owner: game.teamB, points: game.teamBPoints, won: game.teamBPoints > game.teamAPoints },
      ].forEach(({ owner, points, won }) => {
        if (!ownerStats[owner]) {
          ownerStats[owner] = {
            owner,
            playoffGames: 0,
            playoffWins: 0,
            playoffPoints: [],
            regularPoints: [],
            eliteGames: 0,
            chokeGames: 0,
          };
        }
        ownerStats[owner].playoffGames++;
        ownerStats[owner].playoffPoints.push(points);
        if (won) ownerStats[owner].playoffWins++;
        if (points > 150) ownerStats[owner].eliteGames++;
        if (points < 80) ownerStats[owner].chokeGames++;
      });
    });

    regularData.forEach((game) => {
      if (ownerStats[game.teamA]) {
        ownerStats[game.teamA].regularPoints.push(game.teamAPoints);
      }
      if (ownerStats[game.teamB]) {
        ownerStats[game.teamB].regularPoints.push(game.teamBPoints);
      }
    });

    const results: PlayoffResult[] = Object.values(ownerStats)
      .filter((owner) => owner.playoffGames >= 2)
      .map((owner) => {
        const avgPlayoff =
          owner.playoffPoints.reduce((a, b) => a + b, 0) / owner.playoffPoints.length;
        const avgRegular =
          owner.regularPoints.length > 0
            ? owner.regularPoints.reduce((a, b) => a + b, 0) / owner.regularPoints.length
            : 0;

        return {
          ...owner,
          avgPlayoffPoints: avgPlayoff,
          avgRegularPoints: avgRegular,
          playoffDiff: avgPlayoff - avgRegular,
          winPct: ((owner.playoffWins / owner.playoffGames) * 100).toFixed(1),
          bestGame: Math.max(...owner.playoffPoints),
          worstGame: Math.min(...owner.playoffPoints),
          consistency: calculateStats(owner.playoffPoints).stdDev,
        };
      })
      .sort((a, b) => b.avgPlayoffPoints - a.avgPlayoffPoints);

    const seasonRange = seasonMin === seasonMax ? `(${seasonMin})` : `(${seasonMin}-${seasonMax})`;
    const embed = new EmbedBuilder()
      .setTitle(`Playoff Performance Analysis ${seasonRange}`)
      .setDescription(`*"Championships are won in December"*`)
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({ text: 'Based on fantasy playoff weeks (14-17)' });

    if (results.length === 0) {
      embed.addFields({
        name: 'No Data',
        value: 'No playoff data found for the specified seasons.',
        inline: false,
      });
      return embed;
    }

    const clutchPlayers = results.slice(0, 5).map((player, idx) => {
      const emoji = idx === 0 ? '👑' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🏆';
      const trend = player.playoffDiff > 5 ? '📈' : player.playoffDiff < -5 ? '📉' : '➡️';

      return (
        `${emoji} **${player.owner}**\n` +
        `Avg: ${player.avgPlayoffPoints.toFixed(1)} pts ${trend} (${player.playoffDiff > 0 ? '+' : ''}${player.playoffDiff.toFixed(1)})\n` +
        `Record: ${player.playoffWins}-${player.playoffGames - player.playoffWins} (${player.winPct}%)`
      );
    });

    embed.addFields({
      name: 'Playoff Performers',
      value: clutchPlayers.join('\n\n') || 'No data available',
      inline: false,
    });

    const chokers = results
      .filter((p) => p.playoffDiff < -5 && p.playoffGames >= 3)
      .sort((a, b) => a.playoffDiff - b.playoffDiff)
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.playoffDiff.toFixed(1)} pts drop`);

    if (chokers.length > 0) {
      embed.addFields({
        name: 'Playoff Chokers',
        value: chokers.join('\n'),
        inline: true,
      });
    }

    const bestGames = [...results]
      .sort((a, b) => b.bestGame - a.bestGame)
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.bestGame.toFixed(1)} pts`);

    if (bestGames.length > 0) {
      embed.addFields({
        name: 'Best Playoff Games',
        value: bestGames.join('\n'),
        inline: true,
      });
    }

    const sortedByElite = [...results].sort((a, b) => b.eliteGames - a.eliteGames);
    const sortedByChokes = [...results].sort((a, b) => b.chokeGames - a.chokeGames);
    const mostElite = sortedByElite[0];
    const mostChokes = sortedByChokes[0];

    if (mostElite && mostChokes) {
      const funStats = [
        `**Most 150+ Games**: ${mostElite.owner} (${mostElite.eliteGames})`,
        `**Most Sub-80 Games**: ${mostChokes.owner} (${mostChokes.chokeGames})`,
      ];

      embed.addFields({
        name: 'Notable Stats',
        value: funStats.join('\n'),
        inline: false,
      });
    }

    return embed;
  } catch (error: unknown) {
    console.error('[CLUTCH] Playoff analysis error:', error);
    return new EmbedBuilder()
      .setTitle('Playoff Performance Analysis')
      .setDescription('Error fetching playoff data. Please try again.')
      .setColor(0xff0000);
  }
}

async function analyzeCloseGamePerformance(
  seasonMin: number,
  seasonMax: number
): Promise<EmbedBuilder> {
  try {
    console.log(`[CLUTCH] Fetching close game data for ${seasonMin}-${seasonMax}`);

    const url = `https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMin=${seasonMin}&seasonMax=${seasonMax}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error('Failed to fetch data');
    }

    const allGames = (await response.json()) as FantasyMatchupResponse[];
    const closeGames = allGames.filter((game) => game.margin <= 10);

    const ownerStats: Record<string, CloseGameOwnerStats> = {};

    closeGames.forEach((game) => {
      [
        {
          owner: game.teamA,
          points: game.teamAPoints,
          won: game.teamAPoints > game.teamBPoints,
          margin: game.margin,
        },
        {
          owner: game.teamB,
          points: game.teamBPoints,
          won: game.teamBPoints > game.teamAPoints,
          margin: game.margin,
        },
      ].forEach(({ owner, points, won, margin }) => {
        if (!ownerStats[owner]) {
          ownerStats[owner] = {
            owner,
            closeGames: 0,
            closeWins: 0,
            nailBiters: 0,
            nailBiterWins: 0,
            margins: [],
            highScoringWins: 0,
            lowScoringLosses: 0,
          };
        }
        ownerStats[owner].closeGames++;
        ownerStats[owner].margins.push(margin);
        if (won) {
          ownerStats[owner].closeWins++;
          if (points > 130) ownerStats[owner].highScoringWins++;
        } else {
          if (points < 90) ownerStats[owner].lowScoringLosses++;
        }
        if (margin <= 3) {
          ownerStats[owner].nailBiters++;
          if (won) ownerStats[owner].nailBiterWins++;
        }
      });
    });

    const results: CloseGameResult[] = Object.values(ownerStats)
      .filter((owner) => owner.closeGames >= 3)
      .map((owner) => ({
        ...owner,
        winPct: ((owner.closeWins / owner.closeGames) * 100).toFixed(1),
        nailBiterWinPct:
          owner.nailBiters > 0
            ? ((owner.nailBiterWins / owner.nailBiters) * 100).toFixed(1)
            : '0.0',
        avgMargin: (owner.margins.reduce((a, b) => a + b, 0) / owner.margins.length).toFixed(1),
      }))
      .sort((a, b) => Number.parseFloat(b.winPct) - Number.parseFloat(a.winPct));

    const seasonRange = seasonMin === seasonMax ? `(${seasonMin})` : `(${seasonMin}-${seasonMax})`;
    const embed = new EmbedBuilder()
      .setTitle(`Close Game Performance ${seasonRange}`)
      .setDescription(`*Games decided by 10 points or less - where every decision matters*`)
      .setColor(0xf0b232)
      .setTimestamp()
      .setFooter({ text: 'The finest margins separate glory from heartbreak' });

    if (results.length === 0) {
      embed.addFields({
        name: 'No Data',
        value: 'No close game data found for the specified seasons.',
        inline: false,
      });
      return embed;
    }

    const specialists = results.slice(0, 5).map((player, idx) => {
      const emoji = ['🎯', '💪', '⚡', '🌟', '✨'][idx];
      return `${emoji} **${player.owner}**: ${player.closeWins}-${player.closeGames - player.closeWins} (${player.winPct}%)`;
    });

    embed.addFields({
      name: 'Close Game Kings',
      value: specialists.join('\n'),
      inline: true,
    });

    const heartbreaks = [...results]
      .sort((a, b) => Number.parseFloat(a.winPct) - Number.parseFloat(b.winPct))
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.closeGames - player.closeWins} losses`);

    embed.addFields({
      name: 'Heartbreak Leaders',
      value: heartbreaks.join('\n'),
      inline: true,
    });

    const nailBiters = results
      .filter((p) => p.nailBiters >= 3)
      .sort((a, b) => Number.parseFloat(b.nailBiterWinPct) - Number.parseFloat(a.nailBiterWinPct))
      .slice(0, 3)
      .map(
        (player) =>
          `**${player.owner}**: ${player.nailBiterWins}/${player.nailBiters} (${player.nailBiterWinPct}%)`
      );

    if (nailBiters.length > 0) {
      embed.addFields({
        name: 'Nail Biter Specialists',
        value: nailBiters.join('\n') + '\n*Games decided by <=3 points*',
        inline: false,
      });
    }

    const highScorers = results
      .filter((p) => p.highScoringWins > 0)
      .sort((a, b) => b.highScoringWins - a.highScoringWins)
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.highScoringWins} wins`);

    if (highScorers.length > 0) {
      embed.addFields({
        name: 'High-Scoring Close Wins',
        value: highScorers.join('\n') + '\n*130+ point nail biters*',
        inline: true,
      });
    }

    const lowScorers = results
      .filter((p) => p.lowScoringLosses > 0)
      .sort((a, b) => b.lowScoringLosses - a.lowScoringLosses)
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.lowScoringLosses} losses`);

    if (lowScorers.length > 0) {
      embed.addFields({
        name: 'Low-Scoring Heartbreaks',
        value: lowScorers.join('\n') + '\n*Sub-90 point close losses*',
        inline: true,
      });
    }

    return embed;
  } catch (error: unknown) {
    console.error('[CLUTCH] Close game analysis error:', error);
    return new EmbedBuilder()
      .setTitle('Close Game Performance')
      .setDescription('Error fetching close game data. Please try again.')
      .setColor(0xff0000);
  }
}

async function analyzeHighStakesPerformance(
  seasonMin: number,
  seasonMax: number
): Promise<EmbedBuilder> {
  try {
    console.log(`[CLUTCH] Fetching high stakes data for ${seasonMin}-${seasonMax}`);

    const url = `https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMin=${seasonMin}&seasonMax=${seasonMax}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error('Failed to fetch data');
    }

    const allGames = (await response.json()) as FantasyMatchupResponse[];

    const weeklyScores: Record<string, WeeklyScoreData> = {};
    allGames.forEach((game) => {
      const weekKey = `${game.season}-${game.week}`;
      if (!weeklyScores[weekKey]) {
        weeklyScores[weekKey] = {
          totalPoints: 0,
          gameCount: 0,
          games: [],
        };
      }
      weeklyScores[weekKey].totalPoints += game.teamAPoints + game.teamBPoints;
      weeklyScores[weekKey].gameCount++;
      weeklyScores[weekKey].games.push(game);
    });

    Object.keys(weeklyScores).forEach((weekKey) => {
      weeklyScores[weekKey].avgPoints =
        weeklyScores[weekKey].totalPoints / (weeklyScores[weekKey].gameCount * 2);
    });

    const sortedWeeks = Object.entries(weeklyScores).sort(
      ([, a], [, b]) => (b.avgPoints ?? 0) - (a.avgPoints ?? 0)
    );
    const thresholdIndex = Math.floor(sortedWeeks.length * 0.25);
    const highStakesThreshold = sortedWeeks[thresholdIndex]?.[1]?.avgPoints ?? 100;

    const ownerStats: Record<string, HighStakesOwnerStats> = {};

    sortedWeeks.forEach(([, weekData]) => {
      if ((weekData.avgPoints ?? 0) >= highStakesThreshold) {
        weekData.games.forEach((game) => {
          [
            {
              owner: game.teamA,
              points: game.teamAPoints,
              won: game.teamAPoints > game.teamBPoints,
            },
            {
              owner: game.teamB,
              points: game.teamBPoints,
              won: game.teamBPoints > game.teamAPoints,
            },
          ].forEach(({ owner, points, won }) => {
            if (!ownerStats[owner]) {
              ownerStats[owner] = {
                owner,
                highStakesGames: 0,
                highStakesWins: 0,
                highStakesPoints: [],
                boom: 0,
                bust: 0,
              };
            }
            ownerStats[owner].highStakesGames++;
            ownerStats[owner].highStakesPoints.push(points);
            if (won) ownerStats[owner].highStakesWins++;
            if (points > 140) ownerStats[owner].boom++;
            if (points < 90) ownerStats[owner].bust++;
          });
        });
      }
    });

    const results: HighStakesResult[] = Object.values(ownerStats)
      .filter((owner) => owner.highStakesGames >= 3)
      .map((owner) => {
        const avgPoints =
          owner.highStakesPoints.reduce((a, b) => a + b, 0) / owner.highStakesPoints.length;
        return {
          ...owner,
          avgPoints,
          winPct: ((owner.highStakesWins / owner.highStakesGames) * 100).toFixed(1),
          boomRate: ((owner.boom / owner.highStakesGames) * 100).toFixed(1),
          bustRate: ((owner.bust / owner.highStakesGames) * 100).toFixed(1),
          bestGame: Math.max(...owner.highStakesPoints),
          consistency: calculateStats(owner.highStakesPoints).stdDev,
        };
      })
      .sort((a, b) => b.avgPoints - a.avgPoints);

    const seasonRange = seasonMin === seasonMax ? `(${seasonMin})` : `(${seasonMin}-${seasonMax})`;
    const embed = new EmbedBuilder()
      .setTitle(`High Stakes Performance ${seasonRange}`)
      .setDescription(`*Performance in the top 25% highest-scoring weeks*`)
      .setColor(0xe74c3c)
      .setTimestamp()
      .setFooter({ text: 'When everyone is scoring big, who rises above?' });

    if (results.length === 0) {
      embed.addFields({
        name: 'No Data',
        value: 'No high stakes data found for the specified seasons.',
        inline: false,
      });
      return embed;
    }

    const heroes = results.slice(0, 5).map((player, idx) => {
      const emoji = ['🔥', '⚡', '💪', '🌟', '✨'][idx];
      return (
        `${emoji} **${player.owner}**\n` +
        `Avg: ${player.avgPoints.toFixed(1)} pts | ${player.highStakesWins}-${player.highStakesGames - player.highStakesWins} (${player.winPct}%)`
      );
    });

    embed.addFields({
      name: 'High Stakes Heroes',
      value: heroes.join('\n\n'),
      inline: false,
    });

    const boomKings = [...results]
      .sort((a, b) => Number.parseFloat(b.boomRate) - Number.parseFloat(a.boomRate))
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.boomRate}% boom rate`);

    const bustKings = [...results]
      .sort((a, b) => Number.parseFloat(b.bustRate) - Number.parseFloat(a.bustRate))
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.bustRate}% bust rate`);

    if (boomKings.length > 0) {
      embed.addFields({
        name: 'Boom Kings',
        value: boomKings.join('\n') + '\n*140+ pts in high stakes*',
        inline: true,
      });
    }

    if (bustKings.length > 0) {
      embed.addFields({
        name: 'Bust Alert',
        value: bustKings.join('\n') + '\n*<90 pts in high stakes*',
        inline: true,
      });
    }

    const consistent = [...results]
      .sort((a, b) => a.consistency - b.consistency)
      .slice(0, 3)
      .map((player) => `**${player.owner}**: ${player.consistency.toFixed(1)} std dev`);

    if (consistent.length > 0) {
      embed.addFields({
        name: 'Steady in the Storm',
        value: consistent.join('\n') + '\n*Most consistent in high-scoring weeks*',
        inline: false,
      });
    }

    return embed;
  } catch (error: unknown) {
    console.error('[CLUTCH] High stakes analysis error:', error);
    return new EmbedBuilder()
      .setTitle('High Stakes Performance')
      .setDescription('Error fetching high stakes data. Please try again.')
      .setColor(0xff0000);
  }
}
