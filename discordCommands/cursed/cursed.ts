import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import fetch from 'node-fetch';
import type { FantasyMatchupResponse } from '../../types/api.js';

interface WinLossRecord {
  wins: number;
  losses: number;
}

interface MarginBuckets {
  under3: WinLossRecord;
  under5: WinLossRecord;
  under10: WinLossRecord;
}

interface Streak {
  type: boolean | null;
  count: number;
}

interface OpponentRecord extends WinLossRecord {
  totalFor: number;
  totalAgainst: number;
}

interface SeasonRecord extends WinLossRecord {
  pointsFor: number;
  pointsAgainst: number;
}

interface GameWithDetails extends FantasyMatchupResponse {
  margin: number;
  won: boolean;
  userScore: number;
  oppScore: number;
  opponent?: string;
}

interface CurseData {
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  closeGames: GameWithDetails[];
  badBeats: GameWithDetails[];
  weekCurses: Record<string, WinLossRecord>;
  marginBuckets: MarginBuckets;
  playoffGames: GameWithDetails[];
  mustWinGames: GameWithDetails[];
  highScoringLosses: GameWithDetails[];
  lowScoringWins: GameWithDetails[];
  streaks: {
    currentStreak: Streak;
    longestWinStreak: number;
    longestLossStreak: number;
  };
  opponents: Record<string, OpponentRecord>;
  seasonRecords: Record<string, SeasonRecord>;
}

export const data = new SlashCommandBuilder()
  .setName('cursed')
  .setDescription('Reveal your fantasy football curses and statistical nightmares')
  .addStringOption((option) =>
    option.setName('user').setDescription('Manager name to analyze').setRequired(true)
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
    const userName = interaction.options.getString('user');
    const inputSeasonMin = interaction.options.getInteger('seasonmin');
    const inputSeasonMax = interaction.options.getInteger('seasonmax');

    if (!userName) {
      await interaction.editReply('Please provide a manager name.');
      return;
    }

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

    console.log(`[CURSED] Analyzing curses for ${userName} (${seasonMin}-${seasonMax})`);

    const matchupUrl = `https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMin=${seasonMin}&seasonMax=${seasonMax}`;
    const matchupResponse = await fetch(matchupUrl);

    if (!matchupResponse.ok) {
      throw new Error('Failed to fetch matchup data');
    }

    const allGames = (await matchupResponse.json()) as FantasyMatchupResponse[];

    const userGames = allGames.filter(
      (game) =>
        game.teamA.toLowerCase() === userName.toLowerCase() ||
        game.teamB.toLowerCase() === userName.toLowerCase()
    );

    if (userGames.length === 0) {
      await interaction.editReply(
        `No data found for "${userName}". Please check the spelling and try again.`
      );
      return;
    }

    const curseData = analyzeCurses(userGames, userName);
    const embed = createCursedEmbed(userName, curseData, seasonMin ?? 2015, seasonMax ?? 2025);

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('[CURSED] Error:', error);
    await interaction.editReply('An error occurred while analyzing curses. Please try again.');
  }
}

function analyzeCurses(games: FantasyMatchupResponse[], userName: string): CurseData {
  const curses: CurseData = {
    totalGames: 0,
    totalWins: 0,
    totalLosses: 0,
    closeGames: [],
    badBeats: [],
    weekCurses: {},
    marginBuckets: {
      under3: { wins: 0, losses: 0 },
      under5: { wins: 0, losses: 0 },
      under10: { wins: 0, losses: 0 },
    },
    playoffGames: [],
    mustWinGames: [],
    highScoringLosses: [],
    lowScoringWins: [],
    streaks: {
      currentStreak: { type: null, count: 0 },
      longestWinStreak: 0,
      longestLossStreak: 0,
    },
    opponents: {},
    seasonRecords: {},
  };

  const sortedGames = [...games].sort((a, b) => {
    const seasonA = Number(a.season);
    const seasonB = Number(b.season);
    if (seasonA !== seasonB) return seasonA - seasonB;
    return Number.parseInt(a.week, 10) - Number.parseInt(b.week, 10);
  });

  let currentStreak: Streak = { type: null, count: 0 };
  let winStreak = 0;
  let lossStreak = 0;

  sortedGames.forEach((game) => {
    const isTeamA = game.teamA.toLowerCase() === userName.toLowerCase();
    const userScore = isTeamA ? game.teamAPoints : game.teamBPoints;
    const oppScore = isTeamA ? game.teamBPoints : game.teamAPoints;
    const opponent = isTeamA ? game.teamB : game.teamA;
    const won = userScore > oppScore;
    const margin = Math.abs(userScore - oppScore);

    curses.totalGames++;
    if (won) {
      curses.totalWins++;
      winStreak++;
      lossStreak = 0;
      if (winStreak > curses.streaks.longestWinStreak) {
        curses.streaks.longestWinStreak = winStreak;
      }
    } else {
      curses.totalLosses++;
      lossStreak++;
      winStreak = 0;
      if (lossStreak > curses.streaks.longestLossStreak) {
        curses.streaks.longestLossStreak = lossStreak;
      }
    }

    if (currentStreak.type === null || currentStreak.type === won) {
      currentStreak.type = won;
      currentStreak.count++;
    } else {
      currentStreak = { type: won, count: 1 };
    }

    const gameDetails: GameWithDetails = { ...game, margin, won, userScore, oppScore };

    if (margin < 3) {
      if (won) {
        curses.marginBuckets.under3.wins++;
      } else {
        curses.marginBuckets.under3.losses++;
      }
      curses.closeGames.push(gameDetails);
    }
    if (margin < 5) {
      if (won) {
        curses.marginBuckets.under5.wins++;
      } else {
        curses.marginBuckets.under5.losses++;
      }
    }
    if (margin < 10) {
      if (won) {
        curses.marginBuckets.under10.wins++;
      } else {
        curses.marginBuckets.under10.losses++;
      }
    }

    if (!won && margin < 3 && userScore > 100) {
      curses.badBeats.push({ ...gameDetails, opponent });
    }

    const week = game.week;
    if (!curses.weekCurses[week]) {
      curses.weekCurses[week] = { wins: 0, losses: 0 };
    }
    if (won) {
      curses.weekCurses[week].wins++;
    } else {
      curses.weekCurses[week].losses++;
    }

    if (game.isPlayoffs || Number.parseInt(week, 10) >= 14) {
      curses.playoffGames.push(gameDetails);
    }

    if (!won && userScore > 130) {
      curses.highScoringLosses.push(gameDetails);
    }
    if (won && userScore < 80) {
      curses.lowScoringWins.push(gameDetails);
    }

    if (!curses.opponents[opponent]) {
      curses.opponents[opponent] = { wins: 0, losses: 0, totalFor: 0, totalAgainst: 0 };
    }
    curses.opponents[opponent][won ? 'wins' : 'losses']++;
    curses.opponents[opponent].totalFor += userScore;
    curses.opponents[opponent].totalAgainst += oppScore;

    const seasonKey = String(game.season);
    if (!curses.seasonRecords[seasonKey]) {
      curses.seasonRecords[seasonKey] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    }
    curses.seasonRecords[seasonKey][won ? 'wins' : 'losses']++;
    curses.seasonRecords[seasonKey].pointsFor += userScore;
    curses.seasonRecords[seasonKey].pointsAgainst += oppScore;
  });

  curses.streaks.currentStreak = currentStreak;

  return curses;
}

function createCursedEmbed(
  userName: string,
  curseData: CurseData,
  seasonMin: number,
  seasonMax: number
): EmbedBuilder {
  const seasonRange = seasonMin === seasonMax ? `(${seasonMin})` : `(${seasonMin}-${seasonMax})`;

  const embed = new EmbedBuilder()
    .setTitle(`THE CURSE OF ${userName.toUpperCase()} ${seasonRange}`)
    .setColor(0x8b0000)
    .setTimestamp()
    .setFooter({ text: 'May the fantasy gods have mercy on your soul' });

  const heartbreakStats: string[] = [];

  const under5Record = `${curseData.marginBuckets.under5.wins}-${curseData.marginBuckets.under5.losses}`;
  const under3Record = `${curseData.marginBuckets.under3.wins}-${curseData.marginBuckets.under3.losses}`;
  heartbreakStats.push(
    `Lost ${curseData.marginBuckets.under5.losses} games by <5 points (Record: ${under5Record})`
  );
  heartbreakStats.push(`${under3Record} record in games decided by <3 points`);

  if (curseData.badBeats.length > 0) {
    const worstBeat = curseData.badBeats.sort((a, b) => a.margin - b.margin)[0];
    heartbreakStats.push(
      `Worst bad beat: Lost by ${worstBeat.margin.toFixed(1)} with ${worstBeat.userScore.toFixed(1)} pts (Week ${worstBeat.week}, ${worstBeat.season})`
    );
  }

  embed.addFields({
    name: 'HEARTBREAK STATISTICS',
    value: heartbreakStats.join('\n') || 'Lucky you - no heartbreaks found!',
    inline: false,
  });

  const specificCurses: string[] = [];

  const weekCurseEntries = Object.entries(curseData.weekCurses)
    .map(([week, record]) => ({
      week: Number.parseInt(week, 10),
      wins: record.wins,
      losses: record.losses,
      winPct: record.wins / (record.wins + record.losses),
    }))
    .filter((w) => w.losses >= 2 && w.winPct < 0.4)
    .sort((a, b) => a.winPct - b.winPct);

  if (weekCurseEntries.length > 0) {
    const worstWeek = weekCurseEntries[0];
    specificCurses.push(
      `The "Week ${worstWeek.week} Wormhole": ${worstWeek.wins}-${worstWeek.losses} all-time`
    );
  }

  const nemeses = Object.entries(curseData.opponents)
    .map(([opp, record]) => ({
      opponent: opp,
      wins: record.wins,
      losses: record.losses,
      winPct: record.wins / (record.wins + record.losses),
    }))
    .filter((o) => o.losses >= 3 && o.winPct < 0.35)
    .sort((a, b) => a.winPct - b.winPct);

  if (nemeses.length > 0) {
    const topNemesis = nemeses[0];
    specificCurses.push(
      `The "${topNemesis.opponent} Hex": ${topNemesis.wins}-${topNemesis.losses} lifetime`
    );
  }

  if (curseData.highScoringLosses.length >= 3) {
    specificCurses.push(
      `The "Points Don't Matter" Curse: Lost ${curseData.highScoringLosses.length} games scoring 130+`
    );
  }

  const playoffRecord = curseData.playoffGames.reduce(
    (acc, game) => {
      if (game.won) {
        acc.wins++;
      } else {
        acc.losses++;
      }
      return acc;
    },
    { wins: 0, losses: 0 }
  );

  if (
    playoffRecord.losses >= 3 &&
    playoffRecord.wins / (playoffRecord.wins + playoffRecord.losses) < 0.4
  ) {
    specificCurses.push(
      `The "December Disaster": ${playoffRecord.wins}-${playoffRecord.losses} in playoffs/Week 14+`
    );
  }

  if (curseData.streaks.longestLossStreak >= 5) {
    specificCurses.push(
      `The "Spiral of Doom": ${curseData.streaks.longestLossStreak}-game losing streak`
    );
  }

  if (specificCurses.length > 0) {
    embed.addFields({
      name: 'SPECIFIC CURSES',
      value: specificCurses.slice(0, 5).join('\n'),
      inline: false,
    });
  }

  const painPatterns: string[] = [];

  const worstSeason = Object.entries(curseData.seasonRecords)
    .map(([season, record]) => ({
      season,
      winPct: record.wins / (record.wins + record.losses),
      pointsDiff: record.pointsFor - record.pointsAgainst,
    }))
    .sort((a, b) => a.winPct - b.winPct)[0];

  if (worstSeason && worstSeason.winPct < 0.4) {
    painPatterns.push(
      `${worstSeason.season} Season from Hell: ${(worstSeason.winPct * 100).toFixed(1)}% win rate`
    );
  }

  const totalPA = Object.values(curseData.seasonRecords).reduce(
    (sum, s) => sum + s.pointsAgainst,
    0
  );
  const avgPA = totalPA / curseData.totalGames;
  if (avgPA > 110) {
    painPatterns.push(`Opponent Magnet: ${avgPA.toFixed(1)} PPG against (everyone goes off)`);
  }

  const closeGameTotal =
    curseData.marginBuckets.under5.wins + curseData.marginBuckets.under5.losses;
  const closeGamePct = closeGameTotal > 0 ? curseData.marginBuckets.under5.losses / closeGameTotal : 0;
  if (closeGamePct > 0.6 && curseData.marginBuckets.under5.losses >= 5) {
    painPatterns.push(`Clutch Factor: ${(closeGamePct * 100).toFixed(0)}% loss rate in close games`);
  }

  if (painPatterns.length > 0) {
    embed.addFields({
      name: 'PATTERNS OF PAIN',
      value: painPatterns.join('\n'),
      inline: false,
    });
  }

  let ultimateCurse = '';
  let curseTagline = '';

  const under10Total =
    curseData.marginBuckets.under10.wins + curseData.marginBuckets.under10.losses;
  const under3Total = curseData.marginBuckets.under3.wins + curseData.marginBuckets.under3.losses;
  const blowoutGames = curseData.totalGames - under10Total;
  const blowoutWins = curseData.totalWins - curseData.marginBuckets.under10.wins;

  if (closeGamePct > 0.65 && curseData.marginBuckets.under5.losses >= 5) {
    ultimateCurse = `"${userName}'s Law of Narrow Defeats"`;
    const blowoutWinPct = blowoutGames > 0 ? ((blowoutWins / blowoutGames) * 100).toFixed(1) : '0';
    const nailBiterWinPct =
      under3Total > 0
        ? ((curseData.marginBuckets.under3.wins / under3Total) * 100).toFixed(1)
        : '0';
    curseTagline =
      `The closer the game, the more certain the loss\n` +
      `Win % in blowouts: ${blowoutWinPct}%\n` +
      `Win % in nail-biters: ${nailBiterWinPct}%`;
  } else if (curseData.highScoringLosses.length >= 4) {
    ultimateCurse = `"The ${userName} Paradox"`;
    const avgOppScore =
      curseData.highScoringLosses.reduce((sum, g) => sum + g.oppScore, 0) /
      curseData.highScoringLosses.length;
    curseTagline =
      `The more points you score, the more your opponent scores\n` +
      `Record when scoring 130+: 0-${curseData.highScoringLosses.length}\n` +
      `Average opponent score in those games: ${avgOppScore.toFixed(1)}`;
  } else if (
    playoffRecord.losses >= 4 &&
    playoffRecord.wins / (playoffRecord.wins + playoffRecord.losses) < 0.35
  ) {
    ultimateCurse = `"${userName}'s December Doom"`;
    const regSeasonGames =
      curseData.totalGames - playoffRecord.wins - playoffRecord.losses;
    const regSeasonWins = curseData.totalWins - playoffRecord.wins;
    const regSeasonWinPct =
      regSeasonGames > 0 ? ((regSeasonWins / regSeasonGames) * 100).toFixed(1) : '0';
    const playoffWinPct = (
      (playoffRecord.wins / (playoffRecord.wins + playoffRecord.losses)) *
      100
    ).toFixed(1);
    curseTagline =
      `Regular season warrior, playoff peasant\n` +
      `Regular season win %: ${regSeasonWinPct}%\n` +
      `Playoff win %: ${playoffWinPct}%`;
  } else if (nemeses.length > 0 && nemeses[0].winPct < 0.25) {
    ultimateCurse = `"The Curse of ${nemeses[0].opponent}"`;
    const vsOthersGames =
      curseData.totalGames - nemeses[0].wins - nemeses[0].losses;
    const vsOthersWins = curseData.totalWins - nemeses[0].wins;
    const vsOthersWinPct =
      vsOthersGames > 0 ? ((vsOthersWins / vsOthersGames) * 100).toFixed(1) : '0';
    curseTagline =
      `Some rivalries are just meant to hurt\n` +
      `Lifetime record vs ${nemeses[0].opponent}: ${nemeses[0].wins}-${nemeses[0].losses}\n` +
      `Win % vs everyone else: ${vsOthersWinPct}%`;
  } else {
    ultimateCurse = `"${userName}'s Burden"`;
    curseTagline =
      `Fantasy football wasn't meant to be this hard\n` +
      `Overall record: ${curseData.totalWins}-${curseData.totalLosses}\n` +
      `Most common loss margin: ${findMostCommonLossMargin(curseData)} points`;
  }

  embed.addFields({
    name: 'THE ULTIMATE CURSE',
    value: `**${ultimateCurse}**\n${curseTagline}`,
    inline: false,
  });

  return embed;
}

function findMostCommonLossMargin(curseData: CurseData): string {
  const margins: Record<number, number> = {};
  curseData.closeGames.forEach((game) => {
    if (!game.won) {
      const marginBucket = Math.floor(game.margin / 5) * 5;
      margins[marginBucket] = (margins[marginBucket] || 0) + 1;
    }
  });

  const entries = Object.entries(margins).sort(
    ([, a], [, b]) => (b as number) - (a as number)
  );
  const mostCommon = entries[0];

  return mostCommon
    ? `${mostCommon[0]}-${Number.parseInt(mostCommon[0], 10) + 5}`
    : '5-10';
}
