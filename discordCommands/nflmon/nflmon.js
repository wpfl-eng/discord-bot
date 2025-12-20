// NFLmon Command
// Main command for NFLmon collection management

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import * as nflmonDb from "../../nflmon/nflmonDb.js";
import * as nflmonService from "../../nflmon/nflmonService.js";
import {
  getSellValue,
  formatRarity,
  TRAINING_CONFIG,
} from "../../nflmon/nflmonConfig.js";
import { formatCurrency } from "../../economy/economyConfig.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const ITEMS_PER_PAGE = 10;

const ERROR_MESSAGES = {
  NOT_FOUND: "NFLmon not found or doesn't belong to you.",
  IN_TRAINING: "You must untrain this NFLmon before selling.",
  INVALID_SLOT: "Invalid training slot. Check your available slots with `/nflmon stats`.",
  SLOT_OCCUPIED: "That training slot is already in use.",
  NOT_IN_TRAINING: "This NFLmon is not currently in training.",
  ALREADY_IN_TRAINING: "This NFLmon is already in a training slot.",
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build pagination buttons for bench view
 * @param {number} page - Current page
 * @param {number} totalPages - Total pages
 * @param {string|null} rarity - Optional rarity filter
 * @returns {ActionRowBuilder[]}
 */
function buildPaginationButtons(page, totalPages, rarity = null) {
  if (totalPages <= 1) return [];

  const row = new ActionRowBuilder();
  const rarityParam = rarity ? `_${rarity}` : "";

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`nflmon_bench_prev_${page}${rarityParam}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`nflmon_bench_next_${page}${rarityParam}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );

  return [row];
}

/**
 * Build sell confirmation buttons
 * @param {number} nflmonId - NFLmon ID
 * @returns {ActionRowBuilder[]}
 */
function buildSellConfirmButtons(nflmonId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`nflmon_sell_confirm_${nflmonId}`)
        .setLabel("Confirm Sell")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`nflmon_sell_cancel`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

/**
 * Build evolution success embed
 * @param {object} displayData - Display data from getDisplayData
 * @param {object} newStage - New evolution stage
 * @returns {EmbedBuilder}
 */
function buildEvolutionEmbed(displayData, newStage) {
  const { player } = displayData;

  return new EmbedBuilder()
    .setColor(displayData.rarityColor)
    .setTitle(`${newStage.emoji} Evolution Complete!`)
    .setThumbnail(player.imageUrl)
    .setDescription(
      `**${displayData.displayName}** evolved to **${newStage.name}**!\n\n` +
        `**Team:** ${player.team} | **Position:** ${player.position}\n` +
        `**Level:** ${displayData.level} | **Rarity:** ${displayData.rarityName}`
    );
}

// =============================================================================
// SLASH COMMAND BUILDER
// =============================================================================

export const data = new SlashCommandBuilder()
  .setName("nflmon")
  .setDescription("NFLmon collection management")

  // bench [rarity] [page]
  .addSubcommand((sub) =>
    sub
      .setName("bench")
      .setDescription("View your NFLmon collection")
      .addStringOption((opt) =>
        opt
          .setName("rarity")
          .setDescription("Filter by rarity")
          .setRequired(false)
          .addChoices(
            { name: "Common", value: "common" },
            { name: "Uncommon", value: "uncommon" },
            { name: "Rare", value: "rare" },
            { name: "Epic", value: "epic" },
            { name: "Legendary", value: "legendary" }
          )
      )
      .addIntegerOption((opt) =>
        opt.setName("page").setDescription("Page number").setMinValue(1)
      )
  )

  // view <id>
  .addSubcommand((sub) =>
    sub
      .setName("view")
      .setDescription("View detailed NFLmon stats")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("NFLmon ID")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )

  // train <id> [slot]
  .addSubcommand((sub) =>
    sub
      .setName("train")
      .setDescription("Assign NFLmon to a training slot")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("NFLmon ID")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("slot")
          .setDescription("Training slot (1-5)")
          .setMinValue(1)
          .setMaxValue(5)
      )
  )

  // untrain <id>
  .addSubcommand((sub) =>
    sub
      .setName("untrain")
      .setDescription("Remove NFLmon from training")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("NFLmon ID")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )

  // nickname <id> [name]
  .addSubcommand((sub) =>
    sub
      .setName("nickname")
      .setDescription("Set or clear NFLmon nickname")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("NFLmon ID")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("New nickname (leave empty to clear)")
          .setMaxLength(50)
      )
  )

  // evolve <id>
  .addSubcommand((sub) =>
    sub
      .setName("evolve")
      .setDescription("Evolve your NFLmon to the next stage")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("NFLmon ID")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )

  // sell <id>
  .addSubcommand((sub) =>
    sub
      .setName("sell")
      .setDescription("Sell an NFLmon for coins")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("NFLmon ID")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )

  // stats
  .addSubcommand((sub) =>
    sub.setName("stats").setDescription("View your NFLmon statistics")
  )

  // leaderboard [category]
  .addSubcommand((sub) =>
    sub
      .setName("leaderboard")
      .setDescription("View NFLmon rankings")
      .addStringOption((opt) =>
        opt
          .setName("category")
          .setDescription("Leaderboard category")
          .addChoices(
            { name: "Total Caught", value: "total_caught" },
            { name: "Legendaries", value: "legendary_count" },
            { name: "Highest Level", value: "highest_level_reached" },
            { name: "Total Evolved", value: "total_evolved" }
          )
      )
  );

// =============================================================================
// MAIN EXECUTE FUNCTION
// =============================================================================

/**
 * Execute the nflmon command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "bench":
      await handleBench(interaction);
      break;
    case "view":
      await handleView(interaction);
      break;
    case "train":
      await handleTrain(interaction);
      break;
    case "untrain":
      await handleUntrain(interaction);
      break;
    case "nickname":
      await handleNickname(interaction);
      break;
    case "evolve":
      await handleEvolve(interaction);
      break;
    case "sell":
      await handleSell(interaction);
      break;
    case "stats":
      await handleStats(interaction);
      break;
    case "leaderboard":
      await handleLeaderboard(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

// =============================================================================
// HANDLER FUNCTIONS
// =============================================================================

/**
 * Handle /nflmon bench
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleBench(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const rarity = interaction.options.getString("rarity");
    const page = interaction.options.getInteger("page") || 1;

    // Fetch data
    const benchRecords = await nflmonDb.getBench(userId, {
      rarity,
      page,
      limit: ITEMS_PER_PAGE,
    });
    const totalCount = await nflmonDb.getBenchCount(userId, rarity);
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;

    // Build embed
    const embed = nflmonService.buildBenchEmbed(
      benchRecords,
      page,
      totalPages,
      totalCount
    );

    // Build pagination buttons
    const components = buildPaginationButtons(page, totalPages, rarity);

    const response = await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Handle pagination if buttons exist
    if (components.length > 0) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i) => i.user.id === userId,
      });

      collector.on("collect", async (buttonInteraction) => {
        const [, , action, currentPageStr, filterRarity] =
          buttonInteraction.customId.split("_");
        const currentPage = parseInt(currentPageStr);
        const newPage = action === "prev" ? currentPage - 1 : currentPage + 1;

        // Fetch new page
        const newRecords = await nflmonDb.getBench(userId, {
          rarity: filterRarity || rarity,
          page: newPage,
          limit: ITEMS_PER_PAGE,
        });

        const newEmbed = nflmonService.buildBenchEmbed(
          newRecords,
          newPage,
          totalPages,
          totalCount
        );
        const newComponents = buildPaginationButtons(
          newPage,
          totalPages,
          filterRarity || rarity
        );

        await buttonInteraction.update({
          embeds: [newEmbed],
          components: newComponents,
        });
      });

      collector.on("end", async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    }
  } catch (error) {
    console.error("[NFLMON] bench error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon view
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleView(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const nflmonId = interaction.options.getInteger("id");

    // Get NFLmon with ownership check
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_FOUND });
      return;
    }

    // Get enriched display data
    const displayData = nflmonService.getDisplayData(nflmon);
    if (!displayData) {
      await interaction.editReply({
        content: "Error loading NFLmon data.",
      });
      return;
    }

    // Build and send card
    const embed = nflmonService.buildNflmonCard(displayData);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[NFLMON] view error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon train
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleTrain(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const nflmonId = interaction.options.getInteger("id");
    let slot = interaction.options.getInteger("slot");

    // Ensure user stats exist
    const stats = await nflmonDb.getOrCreateStats(userId, username);

    // Check if NFLmon exists and belongs to user
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_FOUND });
      return;
    }

    // Check if already in training
    if (nflmon.training_slot !== null) {
      await interaction.editReply({
        content: `This NFLmon is already in training slot ${nflmon.training_slot}.`,
      });
      return;
    }

    // If no slot provided, find first empty slot
    if (!slot) {
      const trainingNflmon = await nflmonDb.getTrainingNflmon(userId);
      const usedSlots = trainingNflmon.map((n) => n.training_slot);

      for (let i = 1; i <= stats.max_training_slots; i++) {
        if (!usedSlots.includes(i)) {
          slot = i;
          break;
        }
      }

      if (!slot) {
        await interaction.editReply({
          content: `All ${stats.max_training_slots} training slots are full. Use \`/nflmon untrain\` to remove one first.`,
        });
        return;
      }
    }

    // Validate slot is within user's max
    if (slot > stats.max_training_slots) {
      await interaction.editReply({
        content: `You only have ${stats.max_training_slots} training slot(s). Purchase more from the shop!`,
      });
      return;
    }

    // Assign to training slot
    const result = await nflmonDb.setTrainingSlot(userId, nflmonId, slot);

    if (!result.success) {
      const errorMsg =
        ERROR_MESSAGES[result.error] || "Failed to assign training slot.";
      await interaction.editReply({ content: errorMsg });
      return;
    }

    // Get player info for response
    const player = nflmonService.getPlayer(nflmon.player_id);
    const name = nflmon.nickname || player?.name || "Unknown";

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("Training Started!")
      .setDescription(
        `**${name}** is now training in slot **${slot}**!\n\n` +
          `They will earn XP when you play Wordle, Trivia, and other games.`
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[NFLMON] train error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon untrain
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleUntrain(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const nflmonId = interaction.options.getInteger("id");

    // Get NFLmon to check if it's in training
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_FOUND });
      return;
    }

    if (nflmon.training_slot === null) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_IN_TRAINING });
      return;
    }

    const oldSlot = nflmon.training_slot;

    // Remove from training
    const result = await nflmonDb.removeFromTraining(userId, nflmonId);
    if (!result) {
      await interaction.editReply({
        content: "Failed to remove from training.",
      });
      return;
    }

    const player = nflmonService.getPlayer(nflmon.player_id);
    const name = nflmon.nickname || player?.name || "Unknown";

    const embed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle("Training Stopped")
      .setDescription(
        `**${name}** has been removed from training slot **${oldSlot}**.`
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[NFLMON] untrain error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon nickname
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleNickname(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const nflmonId = interaction.options.getInteger("id");
    const newName = interaction.options.getString("name") || null;

    // Update nickname
    const result = await nflmonDb.setNickname(userId, nflmonId, newName);
    if (!result) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_FOUND });
      return;
    }

    const player = nflmonService.getPlayer(result.player_id);
    const originalName = player?.name || "Unknown";

    const embed = new EmbedBuilder().setColor(0x3498db);

    if (newName) {
      embed
        .setTitle("Nickname Set!")
        .setDescription(
          `**${originalName}** is now nicknamed **${newName}**.`
        );
    } else {
      embed
        .setTitle("Nickname Cleared")
        .setDescription(`Nickname removed. Now using original name: **${originalName}**.`);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[NFLMON] nickname error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon evolve
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleEvolve(interaction) {
  // Evolve is PUBLIC (achievement moment)
  await interaction.deferReply({ ephemeral: false });

  try {
    const userId = interaction.user.id;
    const nflmonId = interaction.options.getInteger("id");

    // Get NFLmon
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_FOUND });
      return;
    }

    // Get display data to check evolution status
    const displayData = nflmonService.getDisplayData(nflmon);
    if (!displayData) {
      await interaction.editReply({ content: "Error loading NFLmon data." });
      return;
    }

    // Check if can evolve
    if (!displayData.canEvolve) {
      await interaction.editReply({
        content: displayData.evolutionReason || "This NFLmon cannot evolve right now.",
      });
      return;
    }

    // Perform evolution
    const evolved = await nflmonDb.evolveNflmon(
      userId,
      nflmonId,
      displayData.nextStage.id
    );

    if (!evolved) {
      await interaction.editReply({ content: "Evolution failed." });
      return;
    }

    // Build and send evolution embed
    const embed = buildEvolutionEmbed(displayData, displayData.nextStage);
    await interaction.editReply({ embeds: [embed] });

    console.log(
      `[NFLMON] ${interaction.user.username}'s ${displayData.displayName} evolved to ${displayData.nextStage.name}`
    );
  } catch (error) {
    console.error("[NFLMON] evolve error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon sell
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSell(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const nflmonId = interaction.options.getInteger("id");

    // Get NFLmon for display
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_FOUND });
      return;
    }

    // Check if in training
    if (nflmon.training_slot !== null) {
      await interaction.editReply({ content: ERROR_MESSAGES.IN_TRAINING });
      return;
    }

    const player = nflmonService.getPlayer(nflmon.player_id);
    const name = nflmon.nickname || player?.name || "Unknown";
    const sellValue = getSellValue(nflmon.rarity);
    const rarityName = formatRarity(nflmon.rarity);

    // Show confirmation
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("Confirm Sale")
      .setDescription(
        `Are you sure you want to sell **${name}**?\n\n` +
          `**Rarity:** ${rarityName}\n` +
          `**Level:** ${nflmon.level}\n` +
          `**Sell Value:** ${formatCurrency(sellValue)}\n\n` +
          `This action cannot be undone!`
      );

    const components = buildSellConfirmButtons(nflmonId);

    const response = await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Handle confirmation
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000,
      filter: (i) => i.user.id === userId,
    });

    collector.on("collect", async (buttonInteraction) => {
      if (buttonInteraction.customId === "nflmon_sell_cancel") {
        await buttonInteraction.update({
          embeds: [
            new EmbedBuilder()
              .setColor(0x808080)
              .setTitle("Sale Cancelled")
              .setDescription("You decided not to sell."),
          ],
          components: [],
        });
        collector.stop();
        return;
      }

      // Confirm sell
      const result = await nflmonDb.sellNflmon(userId, nflmonId);

      if (!result.success) {
        const errorMsg =
          ERROR_MESSAGES[result.error] || "Sale failed.";
        await buttonInteraction.update({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff0000)
              .setTitle("Sale Failed")
              .setDescription(errorMsg),
          ],
          components: [],
        });
        collector.stop();
        return;
      }

      await buttonInteraction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle("Sale Complete!")
            .setDescription(
              `You sold **${name}** for ${formatCurrency(result.value)}!`
            ),
        ],
        components: [],
      });
      collector.stop();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction
          .editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x808080)
                .setTitle("Sale Expired")
                .setDescription("Confirmation timed out."),
            ],
            components: [],
          })
          .catch(() => {});
      }
    });
  } catch (error) {
    console.error("[NFLMON] sell error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon stats
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleStats(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Get stats and training NFLmon
    const stats = await nflmonDb.getOrCreateStats(userId, username);
    const trainingNflmon = await nflmonDb.getTrainingNflmon(userId);

    // Build and send stats embed
    const embed = nflmonService.buildStatsEmbed(stats, trainingNflmon);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[NFLMON] stats error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /nflmon leaderboard
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleLeaderboard(interaction) {
  // Leaderboard is PUBLIC
  await interaction.deferReply({ ephemeral: false });

  try {
    const category =
      interaction.options.getString("category") || "total_caught";

    // Get leaderboard entries
    const entries = await nflmonDb.getLeaderboard(category, 10);

    // Build and send leaderboard embed
    const embed = nflmonService.buildLeaderboardEmbed(entries, category);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[NFLMON] leaderboard error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

// =============================================================================
// AUTOCOMPLETE HANDLER
// =============================================================================

/**
 * Handle autocomplete for NFLmon ID
 * @param {import('discord.js').AutocompleteInteraction} interaction
 */
export async function autocomplete(interaction) {
  try {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === "id") {
      const userId = interaction.user.id;
      const searchValue = focusedOption.value.toString().toLowerCase();

      // Get user's bench (limit 100 for autocomplete)
      const bench = await nflmonDb.getBench(userId, { limit: 100 });

      // Filter and format choices
      const choices = bench
        .filter((record) => {
          const player = nflmonService.getPlayer(record.player_id);
          const name = record.nickname || player?.name || "";
          const idMatch = record.id.toString().includes(searchValue);
          const nameMatch = name.toLowerCase().includes(searchValue);
          return idMatch || nameMatch || searchValue === "";
        })
        .slice(0, 25)
        .map((record) => {
          const player = nflmonService.getPlayer(record.player_id);
          const name = record.nickname || player?.name || "Unknown";
          const trainingIndicator = record.training_slot ? " [T]" : "";
          return {
            name: `#${record.id} - ${name} (Lv.${record.level})${trainingIndicator}`,
            value: record.id,
          };
        });

      await interaction.respond(choices);
    }
  } catch (error) {
    console.error("[NFLMON] autocomplete error:", error);
    await interaction.respond([]);
  }
}
