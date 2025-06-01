import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sql } from "@vercel/postgres";
import { 
  DRAFT_CONSTANTS, 
  truncateFieldValue, 
  validateSeasonRange,
  getDraftArchetype
} from "../../helpers/draftTrendsUtils.js";

export const data = new SlashCommandBuilder()
  .setName("drafttrends")
  .setDescription("Analyze draft patterns and tendencies for league members")
  .addStringOption((option) =>
    option
      .setName("user")
      .setDescription("Manager name to analyze")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("seasonmin")
      .setDescription(`Minimum season year (default: ${DRAFT_CONSTANTS.MIN_SEASON})`)
      .setRequired(false)
      .setMinValue(DRAFT_CONSTANTS.MIN_SEASON)
      .setMaxValue(DRAFT_CONSTANTS.MAX_SEASON)
  )
  .addIntegerOption((option) =>
    option
      .setName("seasonmax")
      .setDescription(`Maximum season year (default: ${DRAFT_CONSTANTS.MAX_SEASON})`)
      .setRequired(false)
      .setMinValue(DRAFT_CONSTANTS.MIN_SEASON)
      .setMaxValue(DRAFT_CONSTANTS.MAX_SEASON)
  );

/**
 * Executes the draft trends command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction
 */
export async function execute(interaction) {
  // Defer IMMEDIATELY - we have 3 seconds to acknowledge
  try {
    await interaction.deferReply();
  } catch (error) {
    console.error("[DRAFTTRENDS] Failed to defer reply:", error);
    return;
  }
  
  const timestamp = new Date().toISOString();
  console.log(`[DRAFTTRENDS ${timestamp}] Command started and deferred`);

  try {
    const userName = interaction.options.getString("user");
    const inputSeasonMin = interaction.options.getInteger("seasonmin");
    const inputSeasonMax = interaction.options.getInteger("seasonmax");
    
    const { seasonMin, seasonMax } = validateSeasonRange(inputSeasonMin, inputSeasonMax);
    console.log(`[DRAFTTRENDS] User: ${userName}, Season: ${seasonMin}-${seasonMax}`);
    
    // First, check if we have precomputed data for this range
    let statsResult;
    try {
      console.log("[DRAFTTRENDS] Querying database for precomputed stats...");
      statsResult = await sql`
        SELECT * FROM owner_draft_stats 
        WHERE LOWER(owner) = LOWER(${userName})
        AND season_min = ${seasonMin}
        AND season_max = ${seasonMax}
        ORDER BY computed_at DESC
        LIMIT 1`;
      console.log(`[DRAFTTRENDS] Query returned ${statsResult.rows.length} rows`);
    } catch (dbError) {
      console.error("[DRAFTTRENDS] Database query error:", dbError);
      await interaction.editReply("Database connection error. Please try again later.");
      return;
    }
    
    if (statsResult.rows.length === 0) {
      console.log("[DRAFTTRENDS] No data for specific range, checking full range...");
      // Check if we have data for the full range as a fallback
      let fullRangeResult;
      try {
        console.log("[DRAFTTRENDS] Querying for full range (2010-2024)...");
        fullRangeResult = await sql`
          SELECT * FROM owner_draft_stats 
          WHERE LOWER(owner) = LOWER(${userName})
          AND season_min = 2010
          AND season_max = 2024
          ORDER BY computed_at DESC
          LIMIT 1`;
        console.log(`[DRAFTTRENDS] Full range query returned ${fullRangeResult.rows.length} rows`);
      } catch (dbError) {
        console.error("[DRAFTTRENDS] Database query error (full range):", dbError);
        await interaction.editReply("Database connection error. Please try again later.");
        return;
      }
      
      if (fullRangeResult.rows.length === 0) {
        console.log("[DRAFTTRENDS] No data found for user, getting owner list for suggestions...");
        // Try to find similar names for suggestions
        let ownersResult;
        try {
          console.log("[DRAFTTRENDS] Querying all owners...");
          ownersResult = await sql`
            SELECT DISTINCT owner FROM owner_draft_stats
            ORDER BY owner`;
          console.log(`[DRAFTTRENDS] Found ${ownersResult.rows.length} total owners`);
        } catch (dbError) {
          console.error("[DRAFTTRENDS] Database query error (owners):", dbError);
          await interaction.editReply("Database connection error. Please try again later.");
          return;
        }
        
        const allOwners = ownersResult.rows.map(row => row.owner);
        const lowerUserName = userName.toLowerCase();
        
        const suggestions = allOwners
          .filter(owner => {
            const lowerOwner = owner.toLowerCase();
            return lowerOwner.includes(lowerUserName) || 
                   lowerUserName.includes(lowerOwner) ||
                   lowerOwner.split(' ').some(part => lowerUserName.includes(part)) ||
                   lowerUserName.split(' ').some(part => lowerOwner.includes(part));
          })
          .slice(0, 5);
        
        let replyMsg = `No precomputed data found for "${userName}".\n\n**To use this command:**\n1. Run the precomputation script: \`node precompute-draft-trends.js ${seasonMin} ${seasonMax}\`\n2. Then try this command again`;
        
        if (suggestions.length > 0) {
          replyMsg += `\n\n**Did you mean one of these?**\n${suggestions.map(s => `• ${s}`).join("\n")}`;
        }
        
        console.log("[DRAFTTRENDS] Sending no data found message...");
        await interaction.editReply(replyMsg);
        console.log("[DRAFTTRENDS] Message sent, returning");
        return;
      }
      
      // Use full range data but note it in the response
      statsResult.rows = fullRangeResult.rows;
    }
    
    const stats = statsResult.rows[0];
    console.log("[DRAFTTRENDS] Got stats for:", stats.owner);
    console.log("[DRAFTTRENDS] Stats object keys:", Object.keys(stats));
    
    // Parse the JSON stats
    if (stats.stats_json) {
      console.log("[DRAFTTRENDS] Parsing JSON stats...");
      try {
        stats.complexStats = JSON.parse(stats.stats_json);
        console.log("[DRAFTTRENDS] JSON parsed successfully");
      } catch (parseError) {
        console.error("[DRAFTTRENDS] Failed to parse JSON:", parseError);
        stats.complexStats = {};
      }
    } else {
      console.log("[DRAFTTRENDS] No JSON stats found");
    }
    
    // Create the enhanced embeds
    console.log("[DRAFTTRENDS] Creating enhanced embeds...");
    const embeds = createEnhancedDraftTrendsEmbed(stats);
    
    try {
      await interaction.editReply({ embeds: embeds });
      console.log("[DRAFTTRENDS] Enhanced embeds sent successfully!");
    } catch (embedError) {
      console.error("[DRAFTTRENDS] Enhanced embeds failed, trying simple embed:", embedError);
      
      // Fallback to simple embed
      try {
        const simpleEmbed = createSimpleEmbed(stats);
        await interaction.editReply({ embeds: [simpleEmbed] });
        console.log("[DRAFTTRENDS] Simple embed fallback sent successfully!");
      } catch (simpleError) {
        console.error("[DRAFTTRENDS] Simple embed also failed, using text:", simpleError);
        
        // Final fallback to text
        const textResponse = createTextResponse(stats);
        await interaction.editReply({ content: textResponse });
        console.log("[DRAFTTRENDS] Text fallback sent successfully!");
      }
    }
    
  } catch (error) {
    console.error("[DRAFTTRENDS] Error in command:", error);
    console.error("[DRAFTTRENDS] Stack trace:", error.stack);
    try {
      await interaction.editReply("An error occurred while analyzing draft trends. Make sure the precomputation script has been run: `node precompute-draft-trends.js`");
    } catch (replyError) {
      console.error("[DRAFTTRENDS] Failed to send error message:", replyError);
    }
  }
}

/**
 * Creates enhanced embeds for draft trends analysis
 * @param {Object} stats - Owner draft statistics
 * @returns {Array<EmbedBuilder>} Array containing main and prediction embeds
 */
function createEnhancedDraftTrendsEmbed(stats) {
  const complexStats = stats.complexStats || {};
  const seasonRange = stats.season_min === stats.season_max 
    ? `(${stats.season_min})` 
    : `(${stats.season_min}-${stats.season_max})`;

  // Collect main embed fields
  const mainFields = [];
  
  // Power Metrics
  const powerMetrics = calculatePowerMetrics(stats, complexStats);
  const consistency = calculateConsistency(stats, complexStats);
  const valueHunting = calculateValueHunting(stats, complexStats);
  
  mainFields.push({
    name: "⚡ Power Metrics",
    value: truncateFieldValue([
      `**Draft IQ**: ${powerMetrics.draftIQ}/100`,
      `**Consistency**: ${consistency}/100`,
      `**Risk Tolerance**: ${powerMetrics.riskScore}/100`,
      `**Value Hunter**: ${valueHunting}/100`
    ].join("\n")),
    inline: true
  });
  
  // Signature Moves
  const signatureMoves = getSignatureMoves(stats, complexStats);
  if (signatureMoves.length > 0) {
    mainFields.push({
      name: "🎨 Signature Moves",
      value: truncateFieldValue(signatureMoves.map(move => `• ${move}`).join("\n")),
      inline: true
    });
  }
  
  // Elite Stats
  const eliteStats = getEliteStats(stats, complexStats);
  if (eliteStats.length > 0) {
    mainFields.push({
      name: "🏆 Elite Traits",
      value: truncateFieldValue(eliteStats.map(stat => `• ${stat}`).join("\n")),
      inline: false
    });
  }
  
  // Team DNA
  if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const teamDNA = complexStats.topTeams
      .slice(0, 3)
      .map((team, idx) => {
        const emoji = idx === 0 ? "👑" : idx === 1 ? "🥈" : "🥉";
        return `${emoji} **${team.team}** - ${team.count} picks (${team.percentage}%)`;
      })
      .join("\n");
    
    mainFields.push({
      name: "🧬 Team DNA",
      value: truncateFieldValue(teamDNA),
      inline: true
    });
  }
  
  // Position Architecture
  const positionArchitecture = getPositionArchitecture(complexStats);
  if (positionArchitecture) {
    mainFields.push({
      name: "🏗️ Draft Architecture",
      value: truncateFieldValue(positionArchitecture),
      inline: true
    });
  }
  
  // Loyalty Players
  if (complexStats.repeatPlayers && complexStats.repeatPlayers.length > 0) {
    const loyaltyStars = complexStats.repeatPlayers
      .slice(0, 3)
      .map(p => {
        const emoji = p.count >= 4 ? "💎" : p.count >= 3 ? "⭐" : "🌟";
        return `${emoji} **${p.player}** (${p.count}x) - ${p.seasons.join(", ")}`;
      })
      .join("\n");
    
    mainFields.push({
      name: "💝 Ride or Die Players",
      value: truncateFieldValue(loyaltyStars),
      inline: false
    });
  }

  // Create main embed
  const mainEmbed = new EmbedBuilder()
    .setColor(0xFF6B35)
    .setTitle(`🎯 ${stats.owner}'s Draft DNA ${seasonRange}`)
    .setDescription(truncateFieldValue(generatePersonalityProfile(stats), 4096))
    .addFields(...mainFields)
    .setTimestamp()
    .setFooter({ text: "WPFL Draft Intelligence™" });

  // Collect prediction embed fields
  const predictionFields = [];
  
  // Bold Predictions
  const predictions = generateBoldPredictions(stats, complexStats);
  predictionFields.push({
    name: "🎯 Bold Predictions",
    value: truncateFieldValue(predictions.map((pred, idx) => `**${idx + 1}.** ${pred}`).join("\n\n")),
    inline: false
  });
  
  // Sleeper Alerts
  const sleeperAlerts = generateSleeperAlerts(stats, complexStats);
  if (sleeperAlerts.length > 0) {
    predictionFields.push({
      name: "😴 Sleeper Alerts",
      value: truncateFieldValue(sleeperAlerts.join("\n")),
      inline: false
    });
  }
  
  // Strategic Recommendations
  const recommendations = generateStrategicRecommendations(stats, complexStats);
  predictionFields.push({
    name: "📊 Strategic Edge",
    value: truncateFieldValue(recommendations.join("\n")),
    inline: false
  });

  // Create prediction embed
  const predictionEmbed = new EmbedBuilder()
    .setColor(0x9D4EDD)
    .setTitle(`🔮 2025 Draft Predictions for ${stats.owner}`)
    .addFields(...predictionFields)
    .setFooter({ text: "Powered by WPFL Predictive Analytics" });
  
  return [mainEmbed, predictionEmbed];
}

/**
 * Creates a simple text response for draft trends
 * @param {Object} stats - Owner draft statistics
 * @returns {string} Formatted text response
 */
function createTextResponse(stats) {
  const complexStats = stats.complexStats || {};
  const archetype = getDraftArchetype(stats);
  const totalYears = stats.season_max - stats.season_min + 1;
  
  let response = `🎯 **${stats.owner}'s Draft DNA (${stats.season_min}-${stats.season_max})**\n\n`;
  response += `${archetype}\n`;
  response += `*${totalYears} years of draft dominance analyzed*\n\n`;
  
  response += `**📊 Key Stats:**\n`;
  response += `• Total Picks: ${stats.total_picks} (${stats.snake_picks} snake, ${stats.auction_picks} auction)\n`;
  
  if (stats.auction_max_bid) {
    response += `• Biggest Auction Bid: $${stats.auction_max_bid}\n`;
  }
  
  if (stats.auction_avg_value && typeof stats.auction_avg_value === 'number') {
    response += `• Average Auction Value: $${stats.auction_avg_value.toFixed(1)}\n`;
  }
  
  if (stats.auction_roi) {
    response += `• ROI: ${stats.auction_roi} points per dollar\n`;
  }
  
  // Add top team if available
  if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const topTeam = complexStats.topTeams[0];
    response += `• Favorite Team: ${topTeam.team} (${topTeam.count} picks, ${topTeam.percentage}%)\n`;
  }
  
  // Add favorite position if available
  if (complexStats.favoritePosition) {
    response += `• Favorite Position: ${complexStats.favoritePosition.position} (${complexStats.favoritePosition.percentage}%)\n`;
  }
  
  // Add some loyalty info
  if (complexStats.repeatPlayers && complexStats.repeatPlayers.length > 0) {
    response += `\n**💝 Loyalty:**\n`;
    complexStats.repeatPlayers.slice(0, 3).forEach(player => {
      response += `• ${player.player} (drafted ${player.count}x)\n`;
    });
  }
  
  return response.trim();
}

/**
 * Creates a simple embed using EmbedBuilder
 * @param {Object} stats - Owner draft statistics
 * @returns {EmbedBuilder} EmbedBuilder instance
 */
function createSimpleEmbed(stats) {
  const complexStats = stats.complexStats || {};
  const archetype = getDraftArchetype(stats);
  const totalYears = stats.season_max - stats.season_min + 1;
  
  const seasonRange = stats.season_min === stats.season_max 
    ? `(${stats.season_min})` 
    : `(${stats.season_min}-${stats.season_max})`;
  
  // Collect all fields first
  const fields = [];
  
  // Basic stats field
  fields.push({
    name: "📊 Draft Summary",
    value: `Total Picks: ${stats.total_picks}\nSnake: ${stats.snake_picks} | Auction: ${stats.auction_picks}`,
    inline: true
  });
  
  // Auction stats if available
  if (stats.auction_max_bid) {
    const avgValue = typeof stats.auction_avg_value === 'number' 
      ? stats.auction_avg_value.toFixed(1) 
      : 'N/A';
    
    fields.push({
      name: "💸 Auction Stats",
      value: `Max Bid: $${stats.auction_max_bid}\nAvg Value: $${avgValue}`,
      inline: true
    });
  }
  
  // Team preference
  if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const topTeam = complexStats.topTeams[0];
    fields.push({
      name: "🏈 Team DNA",
      value: `${topTeam.team}: ${topTeam.count} picks (${topTeam.percentage}%)`,
      inline: true
    });
  }
  
  // Position preference
  if (complexStats.favoritePosition) {
    fields.push({
      name: "🎯 Position Focus",
      value: `${complexStats.favoritePosition.position}: ${complexStats.favoritePosition.percentage}%`,
      inline: true
    });
  }
  
  // Loyalty section
  if (complexStats.repeatPlayers && complexStats.repeatPlayers.length > 0) {
    const loyaltyText = complexStats.repeatPlayers
      .slice(0, 3)
      .map(p => `${p.player} (${p.count}x)`)
      .join('\n');
    
    fields.push({
      name: "💝 Loyalty Players",
      value: loyaltyText,
      inline: false
    });
  }
  
  // Create embed with all fields at once
  const embed = new EmbedBuilder()
    .setColor(0xFF6B35)
    .setTitle(`🎯 ${stats.owner}'s Draft DNA ${seasonRange}`)
    .setDescription(`${archetype}\n*${totalYears} years of draft dominance analyzed*`)
    .addFields(...fields)
    .setTimestamp()
    .setFooter({ text: "WPFL Draft Intelligence™" });
  
  return embed;
}

/**
 * Generates a personality profile for a draft analyst
 * @param {Object} stats - Owner statistics
 * @returns {string} Formatted personality profile
 */
function generatePersonalityProfile(stats) {
  const profiles = [];
  
  // Get primary archetype
  profiles.push(getDraftArchetype(stats));
  
  // Add flavor text
  const totalYears = stats.season_max - stats.season_min + 1;
  profiles.push(`*${totalYears} years of draft dominance analyzed*`);
  
  return profiles.join("\n");
}

/**
 * Calculates consistency metric based on draft patterns
 * @param {Object} stats - Basic owner statistics
 * @param {Object} complexStats - Complex statistics object
 * @returns {number} Consistency score 0-100
 */
function calculateConsistency(stats, complexStats) {
  let consistency = 50; // Base score
  
  // Position consistency - if they heavily favor one position
  if (complexStats.favoritePosition) {
    const percentage = parseFloat(complexStats.favoritePosition.percentage);
    if (percentage > 40) consistency += 20;
    else if (percentage > 30) consistency += 10;
  }
  
  // Team loyalty consistency
  if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const topTeamPercentage = parseFloat(complexStats.topTeams[0].percentage);
    if (topTeamPercentage > 15) consistency += 15;
    else if (topTeamPercentage > 10) consistency += 10;
  }
  
  // Repeat player consistency
  if (complexStats.repeatPlayers && complexStats.repeatPlayers.length > 0) {
    const repeatCount = complexStats.repeatPlayers.filter(p => p.count >= 3).length;
    if (repeatCount >= 3) consistency += 15;
    else if (repeatCount >= 2) consistency += 10;
    else if (repeatCount >= 1) consistency += 5;
  }
  
  // Draft position consistency (lower variance = more consistent)
  if (stats.avg_draft_position && stats.earliest_pick && stats.latest_pick) {
    const range = stats.latest_pick - stats.earliest_pick;
    const avgPick = parseFloat(stats.avg_draft_position);
    const variance = range / avgPick;
    if (variance < 2) consistency += 10;
    else if (variance < 3) consistency += 5;
  }
  
  return Math.min(100, Math.max(0, consistency));
}

/**
 * Calculates value hunting metric
 * @param {Object} stats - Basic owner statistics
 * @param {Object} complexStats - Complex statistics object
 * @returns {number} Value hunting score 0-100
 */
function calculateValueHunting(stats, complexStats) {
  let valueScore = 20; // Base score
  
  // Low average value = value hunter
  if (stats.auction_avg_value) {
    const avgValue = typeof stats.auction_avg_value === 'number' 
      ? stats.auction_avg_value 
      : parseFloat(stats.auction_avg_value);
    
    if (!isNaN(avgValue)) {
      if (avgValue < 10) valueScore += 40;
      else if (avgValue < 15) valueScore += 30;
      else if (avgValue < 20) valueScore += 20;
      else if (avgValue > 25) valueScore -= 10; // Penalty for high spenders
    }
  }
  
  // High ROI = value hunter
  if (stats.auction_roi) {
    const roi = parseFloat(stats.auction_roi);
    if (!isNaN(roi)) {
      if (roi > 12) valueScore += 30;
      else if (roi > 10) valueScore += 20;
      else if (roi > 8) valueScore += 10;
    }
  }
  
  // Low max bid relative to average = value hunter
  if (stats.auction_max_bid && stats.auction_avg_value) {
    const maxBid = parseFloat(stats.auction_max_bid);
    const avgValue = typeof stats.auction_avg_value === 'number' 
      ? stats.auction_avg_value 
      : parseFloat(stats.auction_avg_value);
    
    if (!isNaN(maxBid) && !isNaN(avgValue) && avgValue > 0) {
      const ratio = maxBid / avgValue;
      if (ratio < 3) valueScore += 20;  // Doesn't splurge much
      else if (ratio < 4) valueScore += 10;
      else if (ratio > 5) valueScore -= 10; // Big spender penalty
    }
  }
  
  // High hit rate with low spend = value hunter
  if (stats.auction_hit_rate && stats.auction_avg_value) {
    const hitRate = parseFloat(stats.auction_hit_rate);
    const avgValue = typeof stats.auction_avg_value === 'number' 
      ? stats.auction_avg_value 
      : parseFloat(stats.auction_avg_value);
    
    if (!isNaN(hitRate) && !isNaN(avgValue) && hitRate > 50 && avgValue < 20) {
      valueScore += 10;
    }
  }
  
  return Math.min(100, Math.max(0, Math.round(valueScore)));
}

/**
 * Calculates power metrics for draft analysis
 * @param {Object} stats - Basic owner statistics
 * @param {Object} complexStats - Complex statistics object
 * @returns {Object} Power metrics including draftIQ and riskScore
 */
function calculatePowerMetrics(stats, complexStats) {
  let draftIQ = 50; // Base score
  
  // ROI bonus
  if (stats.auction_roi) {
    const roiScore = parseFloat(stats.auction_roi);
    draftIQ += Math.min(25, roiScore * 5);
  }
  
  // Hit rate bonus
  if (stats.auction_hit_rate) {
    draftIQ += parseFloat(stats.auction_hit_rate) / 4;
  }
  
  // Risk score based on max bid and variance
  let riskScore = 0;
  if (stats.auction_max_bid > 50) {
    riskScore += (stats.auction_max_bid - 50);
  }
  if (stats.auction_avg_value > 20) {
    riskScore += 20;
  }
  riskScore = Math.min(100, riskScore * 1.5);
  
  return {
    draftIQ: Math.min(100, Math.round(draftIQ)),
    riskScore: Math.round(riskScore)
  };
}

function getSignatureMoves(stats, complexStats) {
  const moves = [];
  
  // Position-based signatures
  if (complexStats.favoritePosition?.position === "RB" && parseFloat(complexStats.favoritePosition.percentage) > 35) {
    moves.push("🏃 **RB Hammerer** - Pounds the RB position");
  } else if (complexStats.favoritePosition?.position === "WR" && parseFloat(complexStats.favoritePosition.percentage) > 40) {
    moves.push("📡 **WR Whisperer** - Elite WR talent scout");
  }
  
  // Auction signatures
  if (stats.auction_max_bid > 70) {
    moves.push(`💸 **Big Game Hunter** - Record bid: $${stats.auction_max_bid}`);
  }
  if (stats.auction_avg_value < 10 && stats.auction_picks > 10) {
    moves.push("🔍 **Bargain Bin Boss** - Master of the $1-10 range");
  }
  
  // Team loyalty signatures
  if (complexStats.topTeams?.[0]?.count >= 8) {
    moves.push(`${complexStats.topTeams[0].team} **Team Captain** - ${complexStats.topTeams[0].count} players drafted`);
  }
  
  // Round-based signatures
  const earlyRounds = complexStats.positionByRound?.early || {};
  const totalEarly = Object.values(earlyRounds).reduce((a, b) => a + b, 0);
  const earlyWRs = earlyRounds["WR"] || 0;
  const earlyRBs = earlyRounds["RB"] || 0;
  
  if (totalEarly > 0 && earlyWRs / totalEarly > 0.6) {
    moves.push("📻 **Zero-RB Zealot** - WR early and often");
  } else if (totalEarly > 0 && earlyRBs / totalEarly > 0.6) {
    moves.push("🥩 **Bellcow Believer** - RBs rule the early rounds");
  }
  
  return moves.slice(0, 4); // Limit to 4 signature moves
}

function getEliteStats(stats, complexStats) {
  const eliteTraits = [];
  
  // Check for league-leading stats
  if (stats.auction_roi && parseFloat(stats.auction_roi) > 12) {
    eliteTraits.push(`🎯 **Elite ROI**: ${stats.auction_roi} points per dollar`);
  }
  
  if (complexStats.draftTrends?.consistency > 85) {
    eliteTraits.push(`🎪 **Master of Consistency**: ${complexStats.draftTrends.consistency}/100 score`);
  }
  
  if (complexStats.repeatPlayers?.length > 7) {
    eliteTraits.push(`💕 **Loyalty King**: ${complexStats.repeatPlayers.length} repeat relationships`);
  }
  
  if (stats.auction_hit_rate && parseFloat(stats.auction_hit_rate) > 65) {
    eliteTraits.push(`🎰 **Hit Rate Hero**: ${stats.auction_hit_rate}% success rate`);
  }
  
  return eliteTraits;
}

function getPositionArchitecture(complexStats) {
  if (!complexStats.positionByRound) return null;
  
  const architecture = [];
  
  // Early round strategy
  const early = complexStats.positionByRound.early || {};
  const earlyTotal = Object.values(early).reduce((a, b) => a + b, 0);
  if (earlyTotal > 0) {
    const topEarly = Object.entries(early)
      .sort(([,a], [,b]) => b - a)[0];
    if (topEarly) {
      const percentage = ((topEarly[1] / earlyTotal) * 100).toFixed(0);
      architecture.push(`**Early**: ${topEarly[0]}-heavy (${percentage}%)`);
    }
  }
  
  // Mid round tendencies
  const mid = complexStats.positionByRound.mid || {};
  const midTotal = Object.values(mid).reduce((a, b) => a + b, 0);
  if (midTotal > 0) {
    const topMid = Object.entries(mid)
      .sort(([,a], [,b]) => b - a)[0];
    if (topMid) {
      const percentage = ((topMid[1] / midTotal) * 100).toFixed(0);
      architecture.push(`**Mid**: ${topMid[0]} focus (${percentage}%)`);
    }
  }
  
  // Late round habits
  const late = complexStats.positionByRound.late || {};
  const lateQB = late["QB"] || 0;
  const lateTE = late["TE"] || 0;
  const lateTotal = Object.values(late).reduce((a, b) => a + b, 0);
  
  if (lateTotal > 0 && (lateQB + lateTE) / lateTotal > 0.5) {
    architecture.push(`**Late**: Streaming specialist`);
  } else if (lateTotal > 0) {
    architecture.push(`**Late**: Depth builder`);
  }
  
  return architecture.join("\n");
}

/**
 * Generates bold predictions for future drafts
 * @param {Object} stats - Owner statistics
 * @param {Object} complexStats - Complex statistics object
 * @returns {Array<string>} Array of prediction strings
 */
function generateBoldPredictions(stats, complexStats) {
  const predictions = [];
  
  // Timing-based prediction
  if (stats.avg_draft_position) {
    const avgPick = parseFloat(stats.avg_draft_position);
    if (avgPick < 30) {
      predictions.push(`Early drafter alert: They'll grab their QB/TE by round 5, leaving value at RB/WR`);
    } else if (avgPick > 70) {
      predictions.push(`Late round specialist: Expect them to corner the market on a specific position after round 10`);
    }
  }
  
  // Budget allocation prediction for auction
  if (stats.auction_max_bid && stats.auction_avg_value) {
    const maxBid = parseFloat(stats.auction_max_bid);
    const totalSpent = parseFloat(stats.auction_total_spent);
    const picks = stats.auction_picks;
    
    if (picks > 0) {
      const budgetPerPick = totalSpent / picks;
      predictions.push(`First 3 picks will consume $${Math.round(budgetPerPick * 4.5)} of their $200 budget`);
    }
  }
  
  // Weakness exploitation
  const positions = complexStats.positionFrequency || {};
  const lowPositions = Object.entries(positions)
    .filter(([pos, count]) => count < stats.total_picks * 0.1 && ['QB', 'TE', 'WR'].includes(pos))
    .map(([pos]) => pos);
  
  if (lowPositions.length > 0) {
    predictions.push(`${lowPositions[0]} is their blind spot - they'll panic reach when the run starts`);
  }
  
  // Pattern break prediction
  if (complexStats.repeatPlayers && complexStats.repeatPlayers.length > 5) {
    predictions.push(`Creature of habit: Will draft 3+ players from their "comfort list" regardless of value`);
  } else if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const topTeam = complexStats.topTeams[0];
    if (parseFloat(topTeam.percentage) > 15) {
      predictions.push(`${topTeam.team} homer warning: Will reach 10+ spots for their ${topTeam.team} sleeper`);
    }
  }
  
  // Auction behavior prediction
  if (stats.auction_bust_rate && parseFloat(stats.auction_bust_rate) > 35) {
    predictions.push(`Nomination strategy: Nominate their favorite positions early - they'll overbid when nervous`);
  }
  
  return predictions.slice(0, 4);
}

function generateSleeperAlerts(stats, complexStats) {
  const alerts = [];
  
  // Based on favorite teams
  if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const team = complexStats.topTeams[0].team;
    alerts.push(`👀 Watch for ${team} rookies and camp standouts`);
  }
  
  // Based on value hunting score
  if (complexStats.draftTrends?.valueHunting > 60) {
    alerts.push(`💎 Specializes in late-round gems - monitor their picks after round 10`);
  }
  
  // Based on position trends
  if (complexStats.positionByRound?.late?.["WR"] > 5) {
    alerts.push(`📡 Late-round WR specialist - they know something you don't`);
  }
  
  return alerts;
}

function generateStrategicRecommendations(stats, complexStats) {
  const recommendations = [];
  
  // Auction-specific strategies
  if (stats.auction_picks > 0) {
    const avgValue = parseFloat(stats.auction_avg_value) || 15;
    const maxBid = parseFloat(stats.auction_max_bid) || 50;
    
    if (maxBid > 65) {
      recommendations.push(`💸 **Big Spender Alert**: Nominate studs early - they'll blow 40% of budget in first 3 picks`);
    } else if (avgValue < 15) {
      recommendations.push(`⏰ **Value Vulture**: They wait for deals - bid up the $8-15 players to drain their budget`);
    }
  }
  
  // Position-based counter strategies
  const favPos = complexStats.favoritePosition?.position;
  const favPct = parseFloat(complexStats.favoritePosition?.percentage || 0);
  
  if (favPos && favPct > 30) {
    const counterMap = {
      'RB': `🎯 **RB Addict Counter**: Let them hoard RBs - grab 3 top-10 WRs and stream RBs`,
      'WR': `🏃 **WR Heavy Counter**: Lock up 2 elite RBs early while they chase receivers`,
      'QB': `📉 **QB Reach Alert**: They'll grab QB rounds 3-5 - wait and grab 2 in rounds 10+`,
      'TE': `🎪 **TE Premium**: They value TE - either grab Kelce/Andrews or punt completely`
    };
    
    if (counterMap[favPos]) {
      recommendations.push(counterMap[favPos]);
    }
  }
  
  // Draft behavior exploits
  if (stats.avg_draft_position) {
    const avgPick = parseFloat(stats.avg_draft_position);
    if (avgPick < 40) {
      recommendations.push(`🎯 **Early Drafter**: They pick rounds 1-3 heavy - snipe their round 4-6 targets`);
    } else if (avgPick > 80) {
      recommendations.push(`🏝️ **Late Round Hero**: They find gems late - target their typical round 8-10 players early`);
    }
  }
  
  // Weakness targeting
  const positions = complexStats.positionFrequency || {};
  const weakPositions = Object.entries(positions)
    .filter(([pos, count]) => count < stats.total_picks * 0.15 && ['QB', 'TE'].includes(pos))
    .map(([pos]) => pos);
  
  if (weakPositions.length > 0) {
    recommendations.push(`🎪 **${weakPositions[0]} Run**: Start a ${weakPositions[0]} run in mid-rounds - they'll panic reach`);
  }
  
  return recommendations.slice(0, 3);
}