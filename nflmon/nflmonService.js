// NFLmon Service Layer
// Business logic between Discord commands and database

import { EmbedBuilder } from "discord.js";
import * as nflmonDb from "./nflmonDb.js";
import nflmonPlayers from "./nflmonPlayers.json" with { type: "json" };
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
} from "./nflmonConfig.js";

// =============================================================================
// PLAYER DATA FUNCTIONS
// =============================================================================

/**
 * Get a single player by ID from the players JSON
 * @param {string} playerId - Player ID (e.g., "mahomes_patrick")
 * @returns {object|null} Player object or null
 */
export function getPlayer(playerId) {
  return nflmonPlayers[playerId] || null;
}

/**
 * Get all players from the players JSON
 * @returns {object[]} Array of all player objects
 */
export function getAllPlayers() {
  return Object.values(nflmonPlayers);
}

/**
 * Select a random player from the pool
 * @returns {object|null} Random player object or null if pool is empty
 */
export function getRandomPlayer() {
  const players = getAllPlayers();
  if (players.length === 0) return null;
  return players[Math.floor(Math.random() * players.length)];
}

/**
 * Get players filtered by position
 * @param {string} position - Position code (QB, RB, WR, etc.)
 * @returns {object[]} Array of players at that position
 */
export function getPlayersByPosition(position) {
  return getAllPlayers().filter(
    (p) => p.position.toUpperCase() === position.toUpperCase()
  );
}

/**
 * Get players filtered by team
 * @param {string} team - Team abbreviation (KC, BUF, etc.)
 * @returns {object[]} Array of players on that team
 */
export function getPlayersByTeam(team) {
  return getAllPlayers().filter(
    (p) => p.team.toUpperCase() === team.toUpperCase()
  );
}

/**
 * Get players filtered by rarity pool
 * @param {string} rarityPool - Rarity level (legendary, epic, rare, uncommon, common)
 * @returns {object[]} Array of players with that rarity
 */
export function getPlayersByRarity(rarityPool) {
  return getAllPlayers().filter(
    (p) => p.rarityPool.toLowerCase() === rarityPool.toLowerCase()
  );
}

// =============================================================================
// CORE SERVICE FUNCTIONS
// =============================================================================

/**
 * Roll for a new NFLmon and add to user's bench
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @param {string} source - Acquisition source (wordle, trivia, shop, trade)
 * @returns {Promise<{nflmon: object, player: object, rarity: object}|null>}
 */
export async function rollForNflmon(userId, username, source) {
  try {
    const player = getRandomPlayer();
    if (!player) {
      console.warn("[NFLMON] No players available in pool");
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
      console.error("[NFLMON] Failed to add NFLmon to database");
      return null;
    }

    console.log(`[NFLMON] ${username} caught ${player.name} (${rarity})`);

    return {
      nflmon,
      player,
      rarity: getRarityById(rarity),
    };
  } catch (error) {
    console.error("[NFLMON] Error rolling NFLmon:", error);
    return null;
  }
}

/**
 * Add XP to all NFLmon in training from an activity
 * @param {string} userId - Discord user ID
 * @param {string} source - XP source (wordle_win, wordle_first, trivia_correct, blackjack_win)
 * @returns {Promise<{results: Array, xpAmount: number}>}
 */
export async function addXpToTraining(userId, source) {
  try {
    const xpAmount = getRandomXp(source);
    if (xpAmount <= 0) {
      return { results: [], xpAmount: 0 };
    }

    const results = await nflmonDb.addXpToAllTraining(userId, xpAmount);

    // Enrich results with player data
    const enrichedResults = results.map((result) => ({
      ...result,
      player: getPlayer(result.nflmon.player_id),
    }));

    // Log level-ups and evolutions
    for (const result of enrichedResults) {
      if (result.levelsGained > 0) {
        console.log(
          `[NFLMON] ${result.player?.name || "Unknown"} leveled up to ${result.nflmon.level}`
        );
      }
      if (result.evolved) {
        console.log(
          `[NFLMON] ${result.player?.name || "Unknown"} evolved to ${result.newStage.name}!`
        );
      }
    }

    return {
      results: enrichedResults,
      xpAmount,
    };
  } catch (error) {
    console.error("[NFLMON] Error adding XP to training:", error);
    return { results: [], xpAmount: 0 };
  }
}

/**
 * Roll multiple NFLmon for shop pack purchases
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @param {number} count - Number of NFLmon to roll
 * @returns {Promise<{results: Array, success: boolean}>}
 */
export async function rollMultipleNflmon(userId, username, count) {
  const results = [];

  for (let i = 0; i < count; i++) {
    const result = await rollForNflmon(userId, username, "shop");
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
 * @param {Array} results - Array of rollForNflmon results
 * @param {string} packName - Name of pack opened
 * @returns {EmbedBuilder}
 */
export function buildPackResultEmbed(results, packName) {
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`${packName} Opened!`)
    .setDescription(`You received **${results.length}** NFLmon!`);

  const lines = results.map((result, i) => {
    const { player, rarity } = result;
    const emoji = getEvolutionEmoji("rookie");
    return `${i + 1}. ${emoji} **${player.name}** (${player.position}) - ${rarity.name}`;
  });

  embed.addFields({ name: "Your New NFLmon", value: lines.join("\n") });
  embed.setFooter({ text: "Use /nflmon bench to view your collection" });

  return embed;
}

// =============================================================================
// DISPLAY DATA FUNCTION
// =============================================================================

/**
 * Transform a raw DB record into a display-ready object
 * @param {object} benchRecord - Raw record from nflmon_bench table
 * @returns {object|null} Enriched display data or null if player not found
 */
export function getDisplayData(benchRecord) {
  if (!benchRecord) return null;

  const player = getPlayer(benchRecord.player_id);
  if (!player) {
    console.warn(`[NFLMON] Player not found: ${benchRecord.player_id}`);
    return null;
  }

  const ivs = {
    speed: benchRecord.iv_speed,
    power: benchRecord.iv_power,
    agility: benchRecord.iv_agility,
    awareness: benchRecord.iv_awareness,
    hp: benchRecord.iv_hp,
  };

  const level = benchRecord.level;
  const rarity = getRarityById(benchRecord.rarity);
  const evolutionStage = getEvolutionStage(level, benchRecord.rarity);
  const stats = calculateAllStats(
    player.position,
    ivs,
    level,
    benchRecord.rarity
  );
  const xpProgress = getXpProgress(benchRecord.current_xp, level);
  const evolution = canEvolve(
    benchRecord.evolution_stage,
    level,
    benchRecord.rarity
  );

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
      xpProgress.needed > 0
        ? Math.floor((xpProgress.current / xpProgress.needed) * 100)
        : 100,
    isMaxLevel: isMaxLevel(level),
  };
}

// =============================================================================
// EMBED BUILDERS
// =============================================================================

/**
 * Build the main NFLmon card embed for /nflmon view
 * @param {object} displayData - Output from getDisplayData()
 * @returns {EmbedBuilder}
 */
export function buildNflmonCard(displayData) {
  const { player, stats, ivs, ivTotal, evolutionEmoji, rarityName, rarityColor } =
    displayData;

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
    name: "Stats",
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
    ? "**MAX LEVEL**"
    : `XP: ${displayData.xpProgress.current}/${displayData.xpProgress.needed} (${displayData.xpPercent}%)`;

  if (displayData.canEvolve) {
    progressText += `\nReady to evolve to **${displayData.nextStage.name}**!`;
  }

  embed.addFields({
    name: "Progress",
    value: progressText,
    inline: true,
  });

  // Training/Favorite status
  const statusParts = [];
  if (displayData.trainingSlot) {
    statusParts.push(`Training Slot ${displayData.trainingSlot}`);
  }
  if (displayData.isFavorite) {
    statusParts.push("Favorite");
  }
  if (statusParts.length > 0) {
    embed.addFields({
      name: "Status",
      value: statusParts.join(" | "),
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
 * @param {object} rollResult - Output from rollForNflmon()
 * @returns {EmbedBuilder}
 */
export function buildDropEmbed(rollResult) {
  const { nflmon, player, rarity } = rollResult;

  const embed = new EmbedBuilder()
    .setColor(rarity.color)
    .setTitle("New NFLmon Caught!")
    .setThumbnail(player.imageUrl)
    .setDescription(
      `You caught **${player.name}**!\n\n` +
        `**Team:** ${player.team}\n` +
        `**Position:** ${player.position}\n` +
        `**Rarity:** ${rarity.name}\n\n` +
        `Use \`/nflmon view ${nflmon.id}\` to see stats!`
    );

  return embed;
}

/**
 * Build the XP results embed for training notifications
 * @param {object} xpResult - Output from addXpToTraining()
 * @returns {EmbedBuilder|null} Embed or null if no training NFLmon
 */
export function buildXpResultsEmbed(xpResult) {
  const { results, xpAmount } = xpResult;

  if (results.length === 0) return null;

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("Training XP Gained!")
    .setDescription(`Your NFLmon in training earned **+${xpAmount} XP**!`);

  const lines = results.map((result) => {
    const name = result.player?.name || "Unknown";
    let line = `**${name}** - Lv.${result.nflmon.level}`;

    if (result.levelsGained > 0) {
      line += ` +${result.levelsGained} level(s)!`;
    }
    if (result.evolved) {
      line += ` Evolved to ${result.newStage.name}!`;
    }

    return line;
  });

  embed.addFields({ name: "Training Results", value: lines.join("\n") });

  return embed;
}

/**
 * Build a compact bench list embed for /nflmon bench
 * @param {object[]} benchRecords - Array of DB records
 * @param {number} page - Current page number
 * @param {number} totalPages - Total number of pages
 * @param {number} totalCount - Total count of NFLmon
 * @returns {EmbedBuilder}
 */
export function buildBenchEmbed(benchRecords, page, totalPages, totalCount) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Your NFLmon Bench")
    .setDescription(`Total: **${totalCount}** NFLmon`);

  if (benchRecords.length === 0) {
    embed.addFields({
      name: "Empty Bench",
      value: "You haven't caught any NFLmon yet!\nPlay Wordle or Trivia to catch some.",
    });
  } else {
    const lines = benchRecords.map((record) => {
      const player = getPlayer(record.player_id);
      const name = record.nickname || player?.name || "Unknown";
      const stage = getEvolutionStage(record.level, record.rarity);
      const trainingIcon = record.training_slot ? " [T]" : "";
      const favoriteIcon = record.is_favorite ? " *" : "";

      return `\`${record.id}\` ${stage.emoji} **${name}** (${player?.position || "?"}) Lv.${record.level}${trainingIcon}${favoriteIcon}`;
    });

    embed.addFields({ name: "NFLmon", value: lines.join("\n") });
  }

  embed.setFooter({ text: `Page ${page}/${totalPages} | [T]=Training, *=Favorite` });

  return embed;
}

/**
 * Build a leaderboard embed
 * @param {object[]} entries - Leaderboard entries from getLeaderboard()
 * @param {string} category - Category name for display
 * @returns {EmbedBuilder}
 */
export function buildLeaderboardEmbed(entries, category) {
  const categoryTitles = {
    total_caught: "Most NFLmon Caught",
    legendary_count: "Most Legendaries",
    highest_level_reached: "Highest Level",
    total_evolved: "Most Evolutions",
  };

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`NFLmon Leaderboard: ${categoryTitles[category] || category}`);

  if (entries.length === 0) {
    embed.setDescription("No entries yet!");
  } else {
    const lines = entries.map((entry, index) => {
      const medal = index === 0 ? "1." : index === 1 ? "2." : index === 2 ? "3." : `${index + 1}.`;
      return `${medal} **${entry.username || "Unknown"}** - ${entry.value}`;
    });

    embed.setDescription(lines.join("\n"));
  }

  return embed;
}

/**
 * Build user stats embed for /nflmon stats
 * @param {object} stats - Stats from getOrCreateStats()
 * @param {object[]} trainingNflmon - NFLmon in training
 * @returns {EmbedBuilder}
 */
export function buildStatsEmbed(stats, trainingNflmon) {
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("Your NFLmon Stats")
    .setDescription(`**${stats.username || "Trainer"}**`);

  embed.addFields(
    { name: "Total Caught", value: `${stats.total_caught}`, inline: true },
    { name: "Legendaries", value: `${stats.legendary_count}`, inline: true },
    { name: "Evolutions", value: `${stats.total_evolved}`, inline: true },
    { name: "Highest Level", value: `${stats.highest_level_reached}`, inline: true },
    {
      name: "Training Slots",
      value: `${trainingNflmon.length}/${stats.max_training_slots}`,
      inline: true,
    }
  );

  if (trainingNflmon.length > 0) {
    const trainingLines = trainingNflmon.map((record) => {
      const player = getPlayer(record.player_id);
      return `Slot ${record.training_slot}: **${record.nickname || player?.name || "Unknown"}** Lv.${record.level}`;
    });
    embed.addFields({ name: "In Training", value: trainingLines.join("\n") });
  }

  return embed;
}

// =============================================================================
// TRADE EMBEDS
// =============================================================================

/**
 * Build embed for trade offer confirmation (shown to sender)
 * @param {object} trade - Trade record from createTrade()
 * @param {object} fromNflmon - Sender's NFLmon being offered
 * @param {object} toNflmon - Recipient's NFLmon requested (or null)
 * @param {object} fromPlayer - Player data for fromNflmon
 * @param {object} toPlayer - Player data for toNflmon (or null)
 * @returns {EmbedBuilder}
 */
export function buildTradeOfferEmbed(trade, fromNflmon, toNflmon, fromPlayer, toPlayer) {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("Trade Offer Sent!")
    .setDescription(`You offered a trade to <@${trade.to_user_id}>`);

  // What you're offering (with null safety)
  const fromName = fromPlayer?.name || "Unknown Player";
  const fromPos = fromPlayer?.position || "??";
  let offerText = `**${fromName}** (${fromPos}) - ${formatRarity(fromNflmon?.rarity)}`;
  if (trade.coins_offered > 0) offerText += `\n+ 🪙 ${trade.coins_offered} coins`;
  embed.addFields({ name: "You're Offering", value: offerText, inline: true });

  // What you're requesting
  const requestText = toNflmon && toPlayer
    ? `**${toPlayer.name}** (${toPlayer.position}) - ${formatRarity(toNflmon.rarity)}`
    : "*Nothing (Gift)*";
  embed.addFields({ name: "You're Requesting", value: requestText, inline: true });

  embed.setFooter({ text: `Trade ID: ${trade.id} | Expires in 24 hours` });
  return embed;
}

/**
 * Build embed for trade notification (DM to recipient)
 * @param {object} trade - Trade record
 * @param {object} fromNflmon - Sender's NFLmon being offered
 * @param {object} toNflmon - Recipient's NFLmon requested (or null)
 * @param {object} fromPlayer - Player data for fromNflmon
 * @param {object} toPlayer - Player data for toNflmon (or null)
 * @param {string} senderUsername - Sender's Discord username
 * @returns {EmbedBuilder}
 */
export function buildTradeReceivedEmbed(trade, fromNflmon, toNflmon, fromPlayer, toPlayer, senderUsername) {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("New Trade Offer!")
    .setDescription(`**${senderUsername}** wants to trade with you!`);

  // What they're offering (with null safety)
  const fromName = fromPlayer?.name || "Unknown Player";
  const fromPos = fromPlayer?.position || "??";
  let offerText = `**${fromName}** (${fromPos}) - ${formatRarity(fromNflmon?.rarity)}`;
  if (trade.coins_offered > 0) offerText += `\n+ 🪙 ${trade.coins_offered} coins`;
  embed.addFields({ name: "They're Offering", value: offerText, inline: true });

  // What they want
  const requestText = toNflmon && toPlayer
    ? `**${toPlayer.name}** (${toPlayer.position}) - ${formatRarity(toNflmon.rarity)}`
    : "*Nothing (Gift!)*";
  embed.addFields({ name: "They Want", value: requestText, inline: true });

  embed.setFooter({ text: `Trade ID: ${trade.id} | Expires: 24 hours | Click Accept/Reject below` });
  return embed;
}

/**
 * Build embed for pending trades list
 * @param {object[]} trades - Array of pending trades
 * @param {string} userId - Current user's ID
 * @param {number} page - Current page
 * @param {number} totalPages - Total pages
 * @returns {EmbedBuilder}
 */
export function buildPendingTradesEmbed(trades, userId, page, totalPages) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Your Pending Trades");

  if (trades.length === 0) {
    embed.setDescription("You have no pending trades.");
  } else {
    embed.setDescription(`Total: ${trades.length} pending trade(s)`);

    for (const trade of trades) {
      const isIncoming = trade.to_user_id === userId;
      const direction = isIncoming ? "📥 INCOMING" : "📤 OUTGOING";
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
 * @param {boolean} accepted - Whether trade was accepted
 * @param {object} fromPlayer - Player data for offered NFLmon
 * @param {object} toPlayer - Player data for requested NFLmon (or null)
 * @param {number} coinsOffered - Coins offered in trade
 * @returns {EmbedBuilder}
 */
export function buildTradeResultEmbed(accepted, fromPlayer, toPlayer, coinsOffered) {
  const embed = new EmbedBuilder()
    .setColor(accepted ? 0x2ecc71 : 0x808080)
    .setTitle(accepted ? "Trade Completed!" : "Trade Declined");

  if (accepted) {
    const fromName = fromPlayer?.name || "Unknown Player";
    let desc = `**${fromName}** was traded`;
    if (toPlayer) desc += ` for **${toPlayer?.name || "Unknown Player"}**`;
    if (coinsOffered > 0) desc += ` + 🪙 ${coinsOffered}`;
    embed.setDescription(desc);
  } else {
    embed.setDescription("The trade offer was declined.");
  }

  return embed;
}

// =============================================================================
// DEX EMBEDS
// =============================================================================

/**
 * Get rarity emoji for DEX display
 * @param {string} rarityPool - Rarity pool ID
 * @returns {string} Emoji
 */
function getRarityEmoji(rarityPool) {
  const emojis = {
    legendary: "🌟",
    epic: "💜",
    rare: "💎",
    uncommon: "🟢",
    common: "⚪",
  };
  return emojis[rarityPool] || "⚪";
}

/**
 * Build DEX embed for encyclopedia browsing
 * @param {object[]} players - Array of player objects to display
 * @param {number} page - Current page
 * @param {number} totalPages - Total pages
 * @param {number} totalCount - Total players matching filter
 * @param {object} filters - Applied filters { search, rarity }
 * @returns {EmbedBuilder}
 */
export function buildDexEmbed(players, page, totalPages, totalCount, filters) {
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("NFLmon Dex");

  let desc = `Showing ${players.length} of ${totalCount} players`;
  if (filters.search) desc += `\nSearch: "${filters.search}"`;
  if (filters.rarity) desc += `\nRarity: ${formatRarity(filters.rarity)}`;
  embed.setDescription(desc);

  if (players.length === 0) {
    embed.addFields({ name: "No Results", value: "No NFLmon match your search criteria." });
  } else {
    // Discord embeds have a max of 25 fields - limit to 24 to be safe
    const displayPlayers = players.slice(0, 24);
    for (const player of displayPlayers) {
      const rarityEmoji = getRarityEmoji(player?.rarityPool);
      embed.addFields({
        name: `${rarityEmoji} ${player?.name || "Unknown"}`,
        value: `${player?.team || "??"} | ${player?.position || "??"} | #${player?.number || "?"}`,
        inline: true,
      });
    }
  }

  embed.setFooter({ text: `Page ${page}/${totalPages} | Use /nflmon bench to see your collection` });
  return embed;
}
