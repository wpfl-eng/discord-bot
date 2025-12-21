// NFLmon Service Layer
// Business logic between Discord commands and database

import { EmbedBuilder } from 'discord.js';
import * as nflmonDb from './nflmonDb.js';
import nflmonPlayers from './nflmonPlayers.json' with { type: 'json' };
import {
  generateIVs,
  calculateAllStats,
  getXpProgress,
  getRandomXp,
  getRarityById,
  getRarityColor,
  getEvolutionStage,
  canEvolve,
  getTotalIVs,
  formatRarity,
  getEvolutionEmoji,
  isMaxLevel,
  type Rarity,
  type EvolutionStage,
  type IVs,
  type Stats,
  type RarityId,
  type XpProgress,
} from './nflmonConfig.js';
import type { Nflmon, NflmonStats, AcceptTradeResult, NflmonTrade } from './nflmonDb.js';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * NFL Player data from JSON
 */
export interface NflPlayer {
  readonly id: string;
  readonly name: string;
  readonly team: string;
  readonly position: string;
  readonly number: number;
  readonly imageUrl: string;
  readonly rarityPool: RarityId;
  readonly abilities: readonly string[];
  readonly tags: readonly string[];
  readonly alternateImages: Record<string, string>;
}

/**
 * Players JSON type
 */
type PlayersMap = Record<string, NflPlayer>;

/**
 * Roll result from rollForNflmon
 */
export interface RollResult {
  readonly nflmon: Nflmon;
  readonly player: NflPlayer;
  readonly rarity: Rarity | null;
}

/**
 * XP result entry for a single NFLmon
 */
export interface XpResultEntry {
  readonly nflmon: Nflmon;
  readonly player: NflPlayer | null;
  readonly xpGained: number;
  readonly levelsGained: number;
  readonly evolved: boolean;
  readonly newStage: EvolutionStage | null;
}

/**
 * XP result from addXpToTraining
 */
export interface XpResult {
  readonly results: XpResultEntry[];
  readonly xpAmount: number;
}

/**
 * Multi-roll result
 */
export interface MultiRollResult {
  readonly results: RollResult[];
  readonly success: boolean;
}

/**
 * Display data for NFLmon view
 */
export interface DisplayData {
  readonly id: number;
  readonly level: number;
  readonly currentXp: number;
  readonly nickname: string | null;
  readonly isFavorite: boolean;
  readonly trainingSlot: number | null;
  readonly variant: string;
  readonly acquiredAt: Date | string;
  readonly acquiredSource: string;
  readonly player: NflPlayer;
  readonly displayName: string;
  readonly rarity: Rarity | null;
  readonly rarityName: string;
  readonly rarityColor: number;
  readonly stats: Stats;
  readonly ivs: IVs;
  readonly ivTotal: number;
  readonly evolutionStage: EvolutionStage;
  readonly evolutionEmoji: string;
  readonly canEvolve: boolean;
  readonly nextStage: EvolutionStage | null;
  readonly evolutionReason: string | null;
  readonly xpProgress: XpProgress;
  readonly xpPercent: number;
  readonly isMaxLevel: boolean;
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  readonly username: string;
  readonly value: number;
}

/**
 * Dex filters
 */
export interface DexFilters {
  readonly search?: string;
  readonly rarity?: string;
}

/**
 * Trade process result
 */
export interface TradeProcessResult {
  readonly success: boolean;
  readonly responseEmbed: EmbedBuilder;
  readonly announceEmbed?: EmbedBuilder;
  readonly error?: string;
}

/**
 * Bench record from database (partial for typing)
 */
export interface BenchRecord {
  readonly id: number;
  readonly player_id: string;
  readonly level: number;
  readonly rarity: string;
  readonly current_xp: number;
  readonly iv_speed: number;
  readonly iv_power: number;
  readonly iv_agility: number;
  readonly iv_awareness: number;
  readonly iv_hp: number;
  readonly evolution_stage: string;
  readonly nickname: string | null;
  readonly is_favorite: boolean;
  readonly training_slot: number | null;
  readonly variant: string;
  readonly acquired_at: Date | string;
  readonly acquired_source: string;
}

/**
 * Pending trade from database
 */
export interface PendingTrade {
  readonly id: number;
  readonly from_user_id: string;
  readonly to_user_id: string;
  readonly expires_at: Date | string;
  readonly from_username: string;
  readonly to_username: string;
  readonly coins_offered: number;
}

/**
 * Trade error key type
 */
export type TradeErrorKey = keyof typeof TRADE_ERRORS;

// Cast the players JSON to the correct type
const players = nflmonPlayers as PlayersMap;

// =============================================================================
// PLAYER DATA FUNCTIONS
// =============================================================================

/**
 * Get a single player by ID from the players JSON
 * @param playerId - Player ID (e.g., "mahomes_patrick")
 * @returns Player object or null
 */
export function getPlayer(playerId: string): NflPlayer | null {
  return players[playerId] || null;
}

/**
 * Get all players from the players JSON
 * @returns Array of all player objects
 */
export function getAllPlayers(): NflPlayer[] {
  return Object.values(players);
}

/**
 * Select a random player from the pool
 * @returns Random player object or null if pool is empty
 */
export function getRandomPlayer(): NflPlayer | null {
  const allPlayers = getAllPlayers();
  if (allPlayers.length === 0) return null;
  return allPlayers[Math.floor(Math.random() * allPlayers.length)];
}

/**
 * Get players filtered by position
 * @param position - Position code (QB, RB, WR, etc.)
 * @returns Array of players at that position
 */
export function getPlayersByPosition(position: string): NflPlayer[] {
  return getAllPlayers().filter((p) => p.position.toUpperCase() === position.toUpperCase());
}

/**
 * Get players filtered by team
 * @param team - Team abbreviation (KC, BUF, etc.)
 * @returns Array of players on that team
 */
export function getPlayersByTeam(team: string): NflPlayer[] {
  return getAllPlayers().filter((p) => p.team.toUpperCase() === team.toUpperCase());
}

/**
 * Get players filtered by rarity pool
 * @param rarityPool - Rarity level (legendary, epic, rare, uncommon, common)
 * @returns Array of players with that rarity
 */
export function getPlayersByRarity(rarityPool: string): NflPlayer[] {
  return getAllPlayers().filter((p) => p.rarityPool.toLowerCase() === rarityPool.toLowerCase());
}

/**
 * Get N random common players for starter selection
 * @param count - Number of players to return
 * @returns Array of random common players
 */
export function getRandomCommonPlayers(count: number): NflPlayer[] {
  const commonPlayers = getPlayersByRarity('common');
  if (commonPlayers.length === 0) return [];

  // Shuffle and take first N
  const shuffled = [...commonPlayers].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// =============================================================================
// CORE SERVICE FUNCTIONS
// =============================================================================

/**
 * Roll for a new NFLmon and add to user's bench
 * @param userId - Discord user ID
 * @param username - Discord username
 * @param source - Acquisition source (wordle, trivia, shop, trade)
 * @returns Roll result or null on failure
 */
export async function rollForNflmon(
  userId: string,
  username: string,
  source: string
): Promise<RollResult | null> {
  try {
    const player = getRandomPlayer();
    if (!player) {
      console.warn('[NFLMON] No players available in pool');
      return null;
    }

    const ivs = generateIVs();
    const rarity = player.rarityPool; // Player's rarityPool IS their guaranteed rarity

    // Ensure user stats exist with username
    await nflmonDb.getOrCreateStats(userId, username);

    const nflmon = await nflmonDb.addNflmon({
      userId,
      playerId: player.id,
      rarity,
      ivs,
      acquiredSource: source,
    });

    if (!nflmon) {
      console.error('[NFLMON] Failed to add NFLmon to database');
      return null;
    }

    console.log(`[NFLMON] ${username} caught ${player.name} (${rarity})`);

    return {
      nflmon,
      player,
      rarity: getRarityById(rarity),
    };
  } catch (error) {
    console.error('[NFLMON] Error rolling NFLmon:', error);
    return null;
  }
}

/**
 * Add XP to all NFLmon in training from an activity
 * @param userId - Discord user ID
 * @param source - XP source (wordle_win, wordle_first, trivia_correct, blackjack_win)
 * @returns XP result with results and amount
 */
export async function addXpToTraining(userId: string, source: string): Promise<XpResult> {
  try {
    const xpAmount = getRandomXp(source);
    if (xpAmount <= 0) {
      return { results: [], xpAmount: 0 };
    }

    const results = await nflmonDb.addXpToAllTraining(userId, xpAmount);

    // Enrich results with player data
    const enrichedResults: XpResultEntry[] = results.map((result) => ({
      ...result,
      player: getPlayer(result.nflmon.player_id),
    }));

    // Log level-ups and evolutions
    for (const result of enrichedResults) {
      if (result.levelsGained > 0) {
        console.log(
          `[NFLMON] ${result.player?.name || 'Unknown'} leveled up to ${result.nflmon.level}`
        );
      }
      if (result.evolved && result.newStage) {
        console.log(
          `[NFLMON] ${result.player?.name || 'Unknown'} evolved to ${result.newStage.name}!`
        );
      }
    }

    return {
      results: enrichedResults,
      xpAmount,
    };
  } catch (error) {
    console.error('[NFLMON] Error adding XP to training:', error);
    return { results: [], xpAmount: 0 };
  }
}

/**
 * Roll multiple NFLmon for shop pack purchases
 * @param userId - Discord user ID
 * @param username - Discord username
 * @param count - Number of NFLmon to roll
 * @returns Multi-roll result
 */
export async function rollMultipleNflmon(
  userId: string,
  username: string,
  count: number
): Promise<MultiRollResult> {
  const results: RollResult[] = [];

  for (let i = 0; i < count; i++) {
    const result = await rollForNflmon(userId, username, 'shop');
    if (result) {
      results.push(result);
    }
  }

  return {
    results,
    success: results.length > 0,
  };
}

/**
 * Build embed showing all NFLmon from a pack opening
 * @param results - Array of rollForNflmon results
 * @param packName - Name of pack opened
 * @returns EmbedBuilder
 */
export function buildPackResultEmbed(results: RollResult[], packName: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`${packName} Opened!`)
    .setDescription(`You received **${results.length}** NFLmon!`);

  const lines = results.map((result, i) => {
    const { player, rarity } = result;
    const emoji = getEvolutionEmoji('rookie');
    return `${i + 1}. ${emoji} **${player.name}** (${player.position}) - ${rarity?.name || 'Unknown'}`;
  });

  embed.addFields({ name: 'Your New NFLmon', value: lines.join('\n') });
  embed.setFooter({ text: 'Use /nflmon bench to view your collection' });

  return embed;
}

// =============================================================================
// DISPLAY DATA FUNCTION
// =============================================================================

/**
 * Transform a raw DB record into a display-ready object
 * @param benchRecord - Raw record from nflmon_bench table
 * @returns Enriched display data or null if player not found
 */
export function getDisplayData(benchRecord: BenchRecord | null): DisplayData | null {
  if (!benchRecord) return null;

  const player = getPlayer(benchRecord.player_id);
  if (!player) {
    console.warn(`[NFLMON] Player not found: ${benchRecord.player_id}`);
    return null;
  }

  const ivs: IVs = {
    speed: benchRecord.iv_speed,
    power: benchRecord.iv_power,
    agility: benchRecord.iv_agility,
    awareness: benchRecord.iv_awareness,
    hp: benchRecord.iv_hp,
  };

  const level = benchRecord.level;
  const rarity = getRarityById(benchRecord.rarity);
  const evolutionStage = getEvolutionStage(level, benchRecord.rarity);
  const stats = calculateAllStats(player.position, ivs, level, benchRecord.rarity);
  const xpProgress = getXpProgress(benchRecord.current_xp, level);
  const evolution = canEvolve(benchRecord.evolution_stage, level, benchRecord.rarity);

  return {
    // DB fields
    id: benchRecord.id,
    level,
    currentXp: benchRecord.current_xp,
    nickname: benchRecord.nickname,
    isFavorite: benchRecord.is_favorite,
    trainingSlot: benchRecord.training_slot,
    variant: benchRecord.variant,
    acquiredAt: benchRecord.acquired_at,
    acquiredSource: benchRecord.acquired_source,

    // Player info
    player,
    displayName: benchRecord.nickname || player.name,

    // Rarity
    rarity,
    rarityName: formatRarity(benchRecord.rarity),
    rarityColor: getRarityColor(benchRecord.rarity),

    // Stats
    stats,
    ivs,
    ivTotal: getTotalIVs(ivs),

    // Evolution
    evolutionStage,
    evolutionEmoji: getEvolutionEmoji(evolutionStage.id),
    canEvolve: evolution.canEvolve,
    nextStage: evolution.nextStage,
    evolutionReason: evolution.reason,

    // XP
    xpProgress,
    xpPercent:
      xpProgress.needed > 0 ? Math.floor((xpProgress.current / xpProgress.needed) * 100) : 100,
    isMaxLevel: isMaxLevel(level),
  };
}

// =============================================================================
// EMBED BUILDERS
// =============================================================================

/**
 * Build the main NFLmon card embed for /nflmon view
 * @param displayData - Output from getDisplayData()
 * @returns EmbedBuilder
 */
export function buildNflmonCard(displayData: DisplayData): EmbedBuilder {
  const { player, stats, ivs, ivTotal, evolutionEmoji, rarityName, rarityColor } = displayData;

  const embed = new EmbedBuilder()
    .setColor(rarityColor)
    .setTitle(`${evolutionEmoji} ${displayData.displayName}`)
    .setThumbnail(player.imageUrl)
    .setDescription(
      `**${player.team}** | ${player.position} | #${player.number}\n` +
        `**Rarity:** ${rarityName} | **Level:** ${displayData.level}`
    );

  // Stats field
  embed.addFields({
    name: 'Stats',
    value:
      `SPD: **${stats.speed}** (IV: ${ivs.speed})\n` +
      `PWR: **${stats.power}** (IV: ${ivs.power})\n` +
      `AGI: **${stats.agility}** (IV: ${ivs.agility})\n` +
      `AWR: **${stats.awareness}** (IV: ${ivs.awareness})\n` +
      `HP: **${stats.hp}** (IV: ${ivs.hp})\n` +
      `**Total IVs:** ${ivTotal}/75`,
    inline: true,
  });

  // XP/Evolution field
  let progressText = displayData.isMaxLevel
    ? '**MAX LEVEL**'
    : `XP: ${displayData.xpProgress.current}/${displayData.xpProgress.needed} (${displayData.xpPercent}%)`;

  if (displayData.canEvolve && displayData.nextStage) {
    progressText += `\nReady to evolve to **${displayData.nextStage.name}**!`;
  }

  embed.addFields({
    name: 'Progress',
    value: progressText,
    inline: true,
  });

  // Training/Favorite status
  const statusParts: string[] = [];
  if (displayData.trainingSlot) {
    statusParts.push(`Training Slot ${displayData.trainingSlot}`);
  }
  if (displayData.isFavorite) {
    statusParts.push('Favorite');
  }
  if (statusParts.length > 0) {
    embed.addFields({
      name: 'Status',
      value: statusParts.join(' | '),
      inline: false,
    });
  }

  embed.setFooter({
    text: `ID: ${displayData.id} | Caught via ${displayData.acquiredSource}`,
  });

  return embed;
}

/**
 * Build the "You caught!" embed for drops
 * @param rollResult - Output from rollForNflmon()
 * @returns EmbedBuilder
 */
export function buildDropEmbed(rollResult: RollResult): EmbedBuilder {
  const { nflmon, player, rarity } = rollResult;

  const embed = new EmbedBuilder()
    .setColor(rarity?.color ?? 0x95a5a6)
    .setTitle('New NFLmon Caught!')
    .setThumbnail(player.imageUrl)
    .setDescription(
      `You caught **${player.name}**!\n\n` +
        `**Team:** ${player.team}\n` +
        `**Position:** ${player.position}\n` +
        `**Rarity:** ${rarity?.name ?? 'Unknown'}\n\n` +
        `Use \`/nflmon view ${nflmon.id}\` to see stats!`
    );

  return embed;
}

/**
 * Build the XP results embed for training notifications
 * @param xpResult - Output from addXpToTraining()
 * @returns EmbedBuilder or null if no training NFLmon
 */
export function buildXpResultsEmbed(xpResult: XpResult): EmbedBuilder | null {
  const { results, xpAmount } = xpResult;

  if (results.length === 0) return null;

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('Training XP Gained!')
    .setDescription(`Your NFLmon in training earned **+${xpAmount} XP**!`);

  const lines = results.map((result) => {
    const name = result.player?.name || 'Unknown';
    let line = `**${name}** - Lv.${result.nflmon.level}`;

    if (result.levelsGained > 0) {
      line += ` +${result.levelsGained} level(s)!`;
    }
    if (result.evolved && result.newStage) {
      line += ` Evolved to ${result.newStage.name}!`;
    }

    return line;
  });

  embed.addFields({ name: 'Training Results', value: lines.join('\n') });

  return embed;
}

/**
 * Build a compact bench list embed for /nflmon bench
 * @param benchRecords - Array of DB records
 * @param page - Current page number
 * @param totalPages - Total number of pages
 * @param totalCount - Total count of NFLmon
 * @returns EmbedBuilder
 */
export function buildBenchEmbed(
  benchRecords: BenchRecord[],
  page: number,
  totalPages: number,
  totalCount: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Your NFLmon Bench')
    .setDescription(`Total: **${totalCount}** NFLmon`);

  if (benchRecords.length === 0) {
    embed.addFields({
      name: 'Empty Bench',
      value: "You haven't caught any NFLmon yet!\nPlay Wordle or Trivia to catch some.",
    });
  } else {
    const lines = benchRecords.map((record) => {
      const player = getPlayer(record.player_id);
      const name = record.nickname || player?.name || 'Unknown';
      const stage = getEvolutionStage(record.level, record.rarity);
      const trainingIcon = record.training_slot ? ' [T]' : '';
      const favoriteIcon = record.is_favorite ? ' *' : '';

      return `\`${record.id}\` ${stage.emoji} **${name}** (${player?.position || '?'}) Lv.${record.level}${trainingIcon}${favoriteIcon}`;
    });

    embed.addFields({ name: 'NFLmon', value: lines.join('\n') });
  }

  embed.setFooter({ text: `Page ${page}/${totalPages} | [T]=Training, *=Favorite` });

  return embed;
}

/**
 * Build a leaderboard embed
 * @param entries - Leaderboard entries from getLeaderboard()
 * @param category - Category name for display
 * @returns EmbedBuilder
 */
export function buildLeaderboardEmbed(entries: LeaderboardEntry[], category: string): EmbedBuilder {
  const categoryTitles: Record<string, string> = {
    total_caught: 'Most NFLmon Caught',
    legendary_count: 'Most Legendaries',
    highest_level_reached: 'Highest Level',
    total_evolved: 'Most Evolutions',
  };

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`NFLmon Leaderboard: ${categoryTitles[category] || category}`);

  if (entries.length === 0) {
    embed.setDescription('No entries yet!');
  } else {
    const lines = entries.map((entry, index) => {
      const medal = index === 0 ? '1.' : index === 1 ? '2.' : index === 2 ? '3.' : `${index + 1}.`;
      return `${medal} **${entry.username || 'Unknown'}** - ${entry.value}`;
    });

    embed.setDescription(lines.join('\n'));
  }

  return embed;
}

/**
 * Build user stats embed for /nflmon stats
 * @param stats - Stats from getOrCreateStats()
 * @param trainingNflmon - NFLmon in training
 * @returns EmbedBuilder
 */
export function buildStatsEmbed(stats: NflmonStats, trainingNflmon: BenchRecord[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('Your NFLmon Stats')
    .setDescription(`**${stats.username || 'Trainer'}**`);

  embed.addFields(
    { name: 'Total Caught', value: `${stats.total_caught}`, inline: true },
    { name: 'Legendaries', value: `${stats.legendary_count}`, inline: true },
    { name: 'Evolutions', value: `${stats.total_evolved}`, inline: true },
    { name: 'Highest Level', value: `${stats.highest_level_reached}`, inline: true },
    {
      name: 'Training Slots',
      value: `${trainingNflmon.length}/${stats.max_training_slots}`,
      inline: true,
    }
  );

  if (trainingNflmon.length > 0) {
    const trainingLines = trainingNflmon.map((record) => {
      const player = getPlayer(record.player_id);
      return `Slot ${record.training_slot}: **${record.nickname || player?.name || 'Unknown'}** Lv.${record.level}`;
    });
    embed.addFields({ name: 'In Training', value: trainingLines.join('\n') });
  }

  return embed;
}

// =============================================================================
// TRADE EMBEDS
// =============================================================================

/**
 * Build embed for trade offer confirmation (shown to sender)
 */
export function buildTradeOfferEmbed(
  trade: PendingTrade,
  fromNflmon: Nflmon | null,
  toNflmon: Nflmon | null,
  fromPlayer: NflPlayer | null,
  toPlayer: NflPlayer | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('Trade Offer Sent!')
    .setDescription(`You offered a trade to <@${trade.to_user_id}>`);

  // What you're offering (with null safety)
  const fromName = fromPlayer?.name || 'Unknown Player';
  const fromPos = fromPlayer?.position || '??';
  const fromRarityDisplay = fromNflmon?.rarity ? formatRarity(fromNflmon.rarity) : 'Unknown';
  let offerText = `**${fromName}** (${fromPos}) - ${fromRarityDisplay}`;
  if (trade.coins_offered > 0) offerText += `\n+ 🪙 ${trade.coins_offered} coins`;
  embed.addFields({ name: "You're Offering", value: offerText, inline: true });

  // What you're requesting
  const requestText =
    toNflmon && toPlayer
      ? `**${toPlayer.name}** (${toPlayer.position}) - ${formatRarity(toNflmon.rarity)}`
      : '*Nothing (Gift)*';
  embed.addFields({ name: "You're Requesting", value: requestText, inline: true });

  embed.setFooter({ text: `Trade ID: ${trade.id} | Expires in 24 hours` });
  return embed;
}

/**
 * Build embed for trade notification (DM to recipient)
 */
export function buildTradeReceivedEmbed(
  trade: PendingTrade,
  fromNflmon: Nflmon | null,
  toNflmon: Nflmon | null,
  fromPlayer: NflPlayer | null,
  toPlayer: NflPlayer | null,
  senderUsername: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('New Trade Offer!')
    .setDescription(`**${senderUsername}** wants to trade with you!`);

  // What they're offering (with null safety)
  const fromName = fromPlayer?.name || 'Unknown Player';
  const fromPos = fromPlayer?.position || '??';
  const fromRarityDisplay = fromNflmon?.rarity ? formatRarity(fromNflmon.rarity) : 'Unknown';
  let offerText = `**${fromName}** (${fromPos}) - ${fromRarityDisplay}`;
  if (trade.coins_offered > 0) offerText += `\n+ 🪙 ${trade.coins_offered} coins`;
  embed.addFields({ name: "They're Offering", value: offerText, inline: true });

  // What they want
  const requestText =
    toNflmon && toPlayer
      ? `**${toPlayer.name}** (${toPlayer.position}) - ${formatRarity(toNflmon.rarity)}`
      : '*Nothing (Gift!)*';
  embed.addFields({ name: 'They Want', value: requestText, inline: true });

  embed.setFooter({
    text: `Trade ID: ${trade.id} | Expires: 24 hours | Click Accept/Reject below`,
  });
  return embed;
}

/**
 * Build embed for pending trades list
 */
export function buildPendingTradesEmbed(
  trades: NflmonTrade[],
  userId: string,
  page: number,
  totalPages: number
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle('Your Pending Trades');

  if (trades.length === 0) {
    embed.setDescription('You have no pending trades.');
  } else {
    embed.setDescription(`Total: ${trades.length} pending trade(s)`);

    for (const trade of trades) {
      const isIncoming = trade.to_user_id === userId;
      const direction = isIncoming ? '📥 INCOMING' : '📤 OUTGOING';
      const otherUser = isIncoming ? trade.from_user_id : trade.to_user_id;

      embed.addFields({
        name: `${direction} - Trade #${trade.id}`,
        value: `With: <@${otherUser}>\nExpires: <t:${Math.floor(new Date(trade.expires_at).getTime() / 1000)}:R>`,
        inline: true,
      });
    }
  }

  embed.setFooter({ text: `Page ${page}/${totalPages}` });
  return embed;
}

/**
 * Build embed for trade result (accepted/rejected)
 */
export function buildTradeResultEmbed(
  accepted: boolean,
  fromPlayer: NflPlayer | null,
  toPlayer: NflPlayer | null,
  coinsOffered: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(accepted ? 0x2ecc71 : 0x808080)
    .setTitle(accepted ? 'Trade Completed!' : 'Trade Declined');

  if (accepted) {
    const fromName = fromPlayer?.name || 'Unknown Player';
    let desc = `**${fromName}** was traded`;
    if (toPlayer) desc += ` for **${toPlayer?.name || 'Unknown Player'}**`;
    if (coinsOffered > 0) desc += ` + 🪙 ${coinsOffered}`;
    embed.setDescription(desc);
  } else {
    embed.setDescription('The trade offer was declined.');
  }

  return embed;
}

// =============================================================================
// DEX EMBEDS
// =============================================================================

/**
 * Get rarity emoji for DEX display
 */
function getRarityEmoji(rarityPool: string | undefined): string {
  const emojis: Record<string, string> = {
    legendary: '🌟',
    epic: '💜',
    rare: '💎',
    uncommon: '🟢',
    common: '⚪',
  };
  return emojis[rarityPool ?? ''] || '⚪';
}

/**
 * Build DEX embed for encyclopedia browsing
 */
export function buildDexEmbed(
  displayPlayers: NflPlayer[],
  page: number,
  totalPages: number,
  totalCount: number,
  filters: DexFilters
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle('NFLmon Dex');

  let desc = `Showing ${displayPlayers.length} of ${totalCount} players`;
  if (filters.search) desc += `\nSearch: "${filters.search}"`;
  if (filters.rarity) desc += `\nRarity: ${formatRarity(filters.rarity)}`;
  embed.setDescription(desc);

  if (displayPlayers.length === 0) {
    embed.addFields({ name: 'No Results', value: 'No NFLmon match your search criteria.' });
  } else {
    // Discord embeds have a max of 25 fields - limit to 24 to be safe
    const playersToShow = displayPlayers.slice(0, 24);
    for (const player of playersToShow) {
      const rarityEmoji = getRarityEmoji(player?.rarityPool);
      embed.addFields({
        name: `${rarityEmoji} ${player?.name || 'Unknown'}`,
        value: `${player?.team || '??'} | ${player?.position || '??'} | #${player?.number || '?'}`,
        inline: true,
      });
    }
  }

  embed.setFooter({
    text: `Page ${page}/${totalPages} | Use /nflmon bench to see your collection`,
  });
  return embed;
}

// =============================================================================
// TRADE ACTION HELPERS
// =============================================================================

/**
 * Trade error messages (centralized for reuse)
 */
export const TRADE_ERRORS = {
  NOT_FOUND: 'Trade not found.',
  NOT_RECIPIENT: 'You cannot accept/reject this trade.',
  NOT_PENDING: 'This trade is no longer pending.',
  NOT_SENDER: 'You can only cancel trades you sent.',
  EXPIRED: 'This trade has expired.',
  FROM_NFLMON_UNAVAILABLE: 'The offered NFLmon is no longer available.',
  FROM_NFLMON_TRAINING: 'The offered NFLmon is in training.',
  TO_NFLMON_UNAVAILABLE: 'The requested NFLmon is no longer available.',
  TO_NFLMON_TRAINING: 'Your NFLmon is in training. Untrain it first.',
  INSUFFICIENT_COINS: 'The sender no longer has enough coins.',
  SELF_TRADE: 'You cannot trade with yourself.',
  TRANSACTION_FAILED: 'Transaction failed. Please try again.',
} as const;

/**
 * Process trade accept action and return embeds
 */
export async function processTradeAccept(
  userId: string,
  tradeId: number
): Promise<TradeProcessResult> {
  const result = await nflmonDb.acceptTrade(userId, tradeId);

  if (!result.success) {
    const errorMsg = TRADE_ERRORS[result.error as TradeErrorKey] || 'Trade failed.';
    const responseEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('Trade Failed')
      .setDescription(errorMsg);
    return { success: false, responseEmbed, error: result.error };
  }

  // Type guard for successful result
  const successResult = result as AcceptTradeResult & { success: true };

  // Get player names
  const fromPlayer = getPlayer(successResult.fromNflmon.player_id);
  const toPlayer = successResult.toNflmon ? getPlayer(successResult.toNflmon.player_id) : null;

  // Build response embed
  const responseEmbed = buildTradeResultEmbed(
    true,
    fromPlayer,
    toPlayer,
    successResult.trade.coins_offered
  );

  // Build announcement embed
  const fromName = fromPlayer?.name || 'Unknown';
  const toName = toPlayer?.name;
  const announceEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Trade Completed!')
    .setDescription(
      `<@${successResult.trade.from_user_id}> traded **${fromName}** ` +
        `to <@${successResult.trade.to_user_id}>` +
        (toName ? ` for **${toName}**` : '') +
        (successResult.trade.coins_offered > 0 ? ` + ${successResult.trade.coins_offered} coins` : '')
    );

  return { success: true, responseEmbed, announceEmbed };
}

/**
 * Process trade reject action and return embed
 */
export async function processTradeReject(
  userId: string,
  tradeId: number
): Promise<TradeProcessResult> {
  await nflmonDb.rejectTrade(userId, tradeId);

  const responseEmbed = new EmbedBuilder()
    .setColor(0x808080)
    .setTitle('Trade Rejected')
    .setDescription('You declined the trade offer.');

  return { success: true, responseEmbed };
}

/**
 * Process trade cancel action and return embed
 */
export async function processTradeCancel(
  userId: string,
  tradeId: number
): Promise<TradeProcessResult> {
  const result = await nflmonDb.cancelTrade(userId, tradeId);

  // cancelTrade returns the trade if successful, null if failed (not sender or not pending)
  if (!result) {
    const errorMsg = TRADE_ERRORS.NOT_SENDER;
    const responseEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('Error')
      .setDescription(errorMsg);
    return { success: false, responseEmbed, error: 'NOT_SENDER' };
  }

  const responseEmbed = new EmbedBuilder()
    .setColor(0x808080)
    .setTitle('Trade Cancelled')
    .setDescription(`Trade #${tradeId} has been cancelled.`);

  return { success: true, responseEmbed };
}
