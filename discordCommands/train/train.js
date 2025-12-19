import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuBuilder,
} from "discord.js";
import * as trainingDb from "../../training/trainingDb.js";
import * as inventoryDb from "../../inventory/inventoryDb.js";
import {
  renderGrid,
  buildStatusText,
  getActionableSlots,
  formatSlotNumbers,
  getStatusSummary,
} from "../../training/trainingUtils.js";
import { TRAINING_CONFIG, getPosition, getPositionKeys } from "../../training/trainingConfig.js";
import { formatCurrency } from "../../economy/economyConfig.js";

export const data = new SlashCommandBuilder()
  .setName("train")
  .setDescription("Manage your Training Ground")
  .addSubcommand((sub) =>
    sub.setName("view").setDescription("View your training facility")
  )
  .addSubcommand((sub) =>
    sub.setName("manage").setDescription("Manage your training slots")
  )
  .addSubcommand((sub) =>
    sub.setName("settings").setDescription("Configure notification settings")
  )
  .addSubcommand((sub) =>
    sub.setName("stats").setDescription("View your training statistics")
  );

/**
 * Execute the train command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "view") {
    await handleView(interaction);
  } else if (subcommand === "manage") {
    await handleManage(interaction);
  } else if (subcommand === "settings") {
    await handleSettings(interaction);
  } else if (subcommand === "stats") {
    await handleStats(interaction);
  }
}

// ============ View Subcommand ============

/**
 * Handle /train view
 */
async function handleView(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Get or create training ground
    const { ground, slots, isNew } = await trainingDb.getOrCreateTrainingGround(userId, username);

    // Refresh slot states (training→ready, ready→busted)
    await trainingDb.refreshSlotStates(userId);
    const currentSlots = await trainingDb.getTrainingSlots(userId);

    // Build embed
    const embed = buildViewEmbed(username, currentSlots, isNew);

    // Build buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("train_manage")
        .setLabel("Manage")
        .setEmoji("🔧")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("train_refresh")
        .setLabel("Refresh")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    );

    const response = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // Handle button interactions
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000,
      filter: (i) => i.user.id === userId,
    });

    collector.on("collect", async (buttonInteraction) => {
      if (buttonInteraction.customId === "train_refresh") {
        await buttonInteraction.deferUpdate();
        await trainingDb.refreshSlotStates(userId);
        const refreshedSlots = await trainingDb.getTrainingSlots(userId);
        const newEmbed = buildViewEmbed(username, refreshedSlots, false);
        await interaction.editReply({ embeds: [newEmbed] });
      } else if (buttonInteraction.customId === "train_manage") {
        await buttonInteraction.deferUpdate();
        await showManageMenu(interaction, userId);
      }
    });

    collector.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  } catch (error) {
    console.error("train view error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Build the view embed
 */
function buildViewEmbed(username, slots, isNew) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🏟️ ${username}'s Training Ground`)
    .setDescription(
      isNew
        ? "**Welcome to your new Training Ground!**\nYou've been given a starter kit to begin training rookies.\n\n"
        : ""
    )
    .addFields(
      {
        name: "Training Grid",
        value: "```\n" + renderGrid(slots) + "\n```",
        inline: false,
      },
      {
        name: "📊 Status",
        value: buildStatusText(slots),
        inline: false,
      }
    )
    .setFooter({ text: "Use /train manage to set up, hydrate, draft, and graduate!" })
    .setTimestamp();

  if (isNew) {
    embed.addFields({
      name: "🎁 Starter Kit Received",
      value: "• 10x Setup Kit uses\n• 10x Water Cooler uses\n• 2x TE Contracts",
      inline: false,
    });
  }

  return embed;
}

// ============ Manage Subcommand ============

/**
 * Handle /train manage
 */
async function handleManage(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Ensure training ground exists
    await trainingDb.getOrCreateTrainingGround(userId, username);
    await trainingDb.refreshSlotStates(userId);

    await showManageMenu(interaction, userId);
  } catch (error) {
    console.error("train manage error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Show the management menu with action buttons
 */
async function showManageMenu(interaction, userId) {
  const slots = await trainingDb.getTrainingSlots(userId);
  const summary = getStatusSummary(slots);

  // Get tool quantities
  const setupKitQty = await inventoryDb.getItemQuantity(userId, "tool_setup_kit");
  const waterCoolerQty = await inventoryDb.getItemQuantity(userId, "tool_water_cooler");

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🔧 Training Ground Management")
    .addFields(
      {
        name: "Training Grid",
        value: "```\n" + renderGrid(slots) + "\n```",
        inline: false,
      },
      {
        name: "🧰 Your Tools",
        value: `🔧 Setup Kit: **${setupKitQty}** uses\n💧 Water Cooler: **${waterCoolerQty}** uses`,
        inline: true,
      },
      {
        name: "📊 Slot Status",
        value: buildStatusText(slots),
        inline: true,
      }
    )
    .setFooter({ text: "Select an action below" })
    .setTimestamp();

  // Build action buttons based on what's possible
  const buttons = [];

  // Setup button - if there are empty slots and user has tool
  if (summary.empty > 0 && setupKitQty > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("train_action_setup")
        .setLabel(`Setup (${summary.empty})`)
        .setEmoji("🔧")
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Hydrate button
  if (summary.prepared > 0 && waterCoolerQty > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("train_action_hydrate")
        .setLabel(`Hydrate (${summary.prepared})`)
        .setEmoji("💧")
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Draft button
  if (summary.hydrated > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("train_action_draft")
        .setLabel(`Draft (${summary.hydrated})`)
        .setEmoji("📜")
        .setStyle(ButtonStyle.Success)
    );
  }

  // Graduate button
  if (summary.ready > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("train_action_graduate")
        .setLabel(`Graduate (${summary.ready})`)
        .setEmoji("⭐")
        .setStyle(ButtonStyle.Success)
    );
  }

  // Clear busted button
  if (summary.busted > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("train_action_clear")
        .setLabel(`Clear Busted (${summary.busted})`)
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger)
    );
  }

  // Add back/refresh button
  buttons.push(
    new ButtonBuilder()
      .setCustomId("train_action_refresh")
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  // Split into rows (max 5 per row)
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  const response = await interaction.editReply({
    embeds: [embed],
    components: rows,
  });

  // Handle button interactions
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000,
    filter: (i) => i.user.id === userId,
  });

  collector.on("collect", async (btnInteraction) => {
    const action = btnInteraction.customId.replace("train_action_", "");

    try {
      if (action === "refresh") {
        await btnInteraction.deferUpdate();
        await trainingDb.refreshSlotStates(userId);
        await showManageMenu(interaction, userId);
      } else if (action === "setup") {
        await handleSetupAll(btnInteraction, interaction, userId);
      } else if (action === "hydrate") {
        await handleHydrateAll(btnInteraction, interaction, userId);
      } else if (action === "draft") {
        await handleDraftMenu(btnInteraction, interaction, userId);
      } else if (action === "graduate") {
        await handleGraduateAll(btnInteraction, interaction, userId);
      } else if (action === "clear") {
        await handleClearAll(btnInteraction, interaction, userId);
      }
    } catch (error) {
      console.error(`train action ${action} error:`, error);
      await btnInteraction.reply({
        content: `Error: ${error.message}`,
        ephemeral: true,
      });
    }
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ============ Action Handlers ============

/**
 * Setup all empty slots
 */
async function handleSetupAll(btnInteraction, interaction, userId) {
  await btnInteraction.deferUpdate();

  const slots = await trainingDb.getTrainingSlots(userId);
  const emptySlots = getActionableSlots(slots, "setup");
  const indexes = emptySlots.map((s) => s.slot_index);

  const result = await trainingDb.setupSlots(userId, indexes);

  if (!result.success) {
    await btnInteraction.followUp({
      content: getErrorMessage(result.error, result),
      ephemeral: true,
    });
    return;
  }

  await btnInteraction.followUp({
    content: `🔧 Set up **${result.updated}** slot${result.updated > 1 ? "s" : ""}! They're now ready for hydration.`,
    ephemeral: true,
  });

  await trainingDb.refreshSlotStates(userId);
  await showManageMenu(interaction, userId);
}

/**
 * Hydrate all prepared slots
 */
async function handleHydrateAll(btnInteraction, interaction, userId) {
  await btnInteraction.deferUpdate();

  const slots = await trainingDb.getTrainingSlots(userId);
  const preparedSlots = getActionableSlots(slots, "hydrate");
  const indexes = preparedSlots.map((s) => s.slot_index);

  const result = await trainingDb.hydrateSlots(userId, indexes);

  if (!result.success) {
    await btnInteraction.followUp({
      content: getErrorMessage(result.error, result),
      ephemeral: true,
    });
    return;
  }

  await btnInteraction.followUp({
    content: `💧 Hydrated **${result.updated}** slot${result.updated > 1 ? "s" : ""}! Ready for drafting rookies.`,
    ephemeral: true,
  });

  await trainingDb.refreshSlotStates(userId);
  await showManageMenu(interaction, userId);
}

/**
 * Show draft position menu
 */
async function handleDraftMenu(btnInteraction, interaction, userId) {
  await btnInteraction.deferUpdate();

  // Get available contracts
  const positions = getPositionKeys();
  const contractCounts = {};

  for (const pos of positions) {
    const config = getPosition(pos);
    contractCounts[pos] = await inventoryDb.getItemQuantity(userId, config.contractItemType);
  }

  // Build select menu for positions
  const options = positions
    .filter((pos) => contractCounts[pos] > 0)
    .map((pos) => {
      const config = getPosition(pos);
      return {
        label: `${config.displayName} (${contractCounts[pos]} contracts)`,
        value: pos,
        emoji: config.emoji,
        description: `Train time: ${config.trainTimeMinutes}m`,
      };
    });

  if (options.length === 0) {
    await btnInteraction.followUp({
      content: "You don't have any contracts! Buy some from `/shop`.",
      ephemeral: true,
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("train_draft_position")
    .setPlaceholder("Select a position to draft")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);

  const draftEmbed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📜 Draft a Rookie")
    .setDescription("Select a position to draft into your hydrated slots.")
    .addFields(
      { name: "Your Contracts", value: positions.map((p) => `${getPosition(p).emoji} ${p}: **${contractCounts[p]}**`).join("\n"), inline: true }
    );

  await interaction.editReply({
    embeds: [draftEmbed],
    components: [row],
  });

  // Handle select
  const selectResponse = await interaction.fetchReply();
  const selectCollector = selectResponse.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: 60000,
    filter: (i) => i.user.id === userId,
  });

  selectCollector.on("collect", async (selectInteraction) => {
    await selectInteraction.deferUpdate();

    const position = selectInteraction.values[0];
    await draftToFirstHydrated(interaction, userId, position);
    selectCollector.stop();
  });

  selectCollector.on("end", async (collected, reason) => {
    if (reason === "time" && collected.size === 0) {
      await showManageMenu(interaction, userId);
    }
  });
}

/**
 * Draft to the first available hydrated slot
 */
async function draftToFirstHydrated(interaction, userId, position) {
  const slots = await trainingDb.getTrainingSlots(userId);
  const hydratedSlots = getActionableSlots(slots, "draft");

  if (hydratedSlots.length === 0) {
    await interaction.followUp({
      content: "No hydrated slots available!",
      ephemeral: true,
    });
    await showManageMenu(interaction, userId);
    return;
  }

  const slotIndex = hydratedSlots[0].slot_index;
  const result = await trainingDb.draftRookie(userId, slotIndex, position);

  if (!result.success) {
    await interaction.followUp({
      content: getErrorMessage(result.error, result),
      ephemeral: true,
    });
    await showManageMenu(interaction, userId);
    return;
  }

  const config = getPosition(position);
  await interaction.followUp({
    content: `${config.emoji} Drafted a **${config.displayName}** rookie! Training for ${config.trainTimeMinutes} minutes.`,
    ephemeral: true,
  });

  await showManageMenu(interaction, userId);
}

/**
 * Graduate all ready players
 */
async function handleGraduateAll(btnInteraction, interaction, userId) {
  await btnInteraction.deferUpdate();

  const slots = await trainingDb.getTrainingSlots(userId);
  const readySlots = getActionableSlots(slots, "graduate");

  let totalValue = 0;
  const graduated = [];

  for (const slot of readySlots) {
    const result = await trainingDb.graduateSlot(userId, slot.slot_index);
    if (result.success) {
      totalValue += result.value;
      graduated.push({ position: result.position, value: result.value });
    }
  }

  if (graduated.length === 0) {
    await btnInteraction.followUp({
      content: "No players ready to graduate!",
      ephemeral: true,
    });
    return;
  }

  const details = graduated
    .map((g) => `${getPosition(g.position).emoji} ${g.position}: ${formatCurrency(g.value)}`)
    .join("\n");

  await btnInteraction.followUp({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("⭐ Rookies Graduated!")
        .setDescription(`Graduated **${graduated.length}** player${graduated.length > 1 ? "s" : ""}!`)
        .addFields(
          { name: "Players", value: details, inline: true },
          { name: "Total Value", value: formatCurrency(totalValue), inline: true }
        )
        .setFooter({ text: "Sell your rookies with /inventory sell" }),
    ],
    ephemeral: true,
  });

  await trainingDb.refreshSlotStates(userId);
  await showManageMenu(interaction, userId);
}

/**
 * Clear all busted slots
 */
async function handleClearAll(btnInteraction, interaction, userId) {
  await btnInteraction.deferUpdate();

  const slots = await trainingDb.getTrainingSlots(userId);
  const bustedSlots = getActionableSlots(slots, "clear");

  let cleared = 0;
  for (const slot of bustedSlots) {
    const result = await trainingDb.clearBustedSlot(userId, slot.slot_index);
    if (result.success) cleared++;
  }

  if (cleared === 0) {
    await btnInteraction.followUp({
      content: "No busted slots to clear!",
      ephemeral: true,
    });
    return;
  }

  await btnInteraction.followUp({
    content: `🗑️ Cleared **${cleared}** busted slot${cleared > 1 ? "s" : ""}. They can be used again.`,
    ephemeral: true,
  });

  await showManageMenu(interaction, userId);
}

// ============ Settings Subcommand ============

/**
 * Handle /train settings
 */
async function handleSettings(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Ensure training ground exists
    const { ground } = await trainingDb.getOrCreateTrainingGround(userId, username);
    const isEnabled = ground.notify_ready;

    // Build embed
    const embed = new EmbedBuilder()
      .setColor(isEnabled ? 0x2ecc71 : 0x95a5a6)
      .setTitle("🔔 Training Notification Settings")
      .setDescription(
        `📬 Ready Notifications: **${isEnabled ? "Enabled" : "Disabled"}** ${isEnabled ? "✅" : "❌"}\n\n` +
          `When enabled, you'll receive a DM when your rookies are ready to graduate (max once per 30 min).`
      )
      .setTimestamp();

    // Build toggle button
    const button = new ButtonBuilder()
      .setCustomId("train_settings_toggle")
      .setLabel(isEnabled ? "Disable Notifications" : "Enable Notifications")
      .setEmoji(isEnabled ? "🔕" : "🔔")
      .setStyle(isEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    const response = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // Handle button interaction
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
      filter: (i) => i.user.id === userId,
    });

    collector.on("collect", async (btnInteraction) => {
      await btnInteraction.deferUpdate();

      // Toggle the setting
      const currentGround = await trainingDb.getTrainingGround(userId);
      const newValue = !currentGround.notify_ready;
      await trainingDb.updateNotificationSetting(userId, newValue);

      // Update embed and button
      const newEmbed = new EmbedBuilder()
        .setColor(newValue ? 0x2ecc71 : 0x95a5a6)
        .setTitle("🔔 Training Notification Settings")
        .setDescription(
          `📬 Ready Notifications: **${newValue ? "Enabled" : "Disabled"}** ${newValue ? "✅" : "❌"}\n\n` +
            `When enabled, you'll receive a DM when your rookies are ready to graduate (max once per 30 min).`
        )
        .setTimestamp();

      const newButton = new ButtonBuilder()
        .setCustomId("train_settings_toggle")
        .setLabel(newValue ? "Disable Notifications" : "Enable Notifications")
        .setEmoji(newValue ? "🔕" : "🔔")
        .setStyle(newValue ? ButtonStyle.Secondary : ButtonStyle.Primary);

      const newRow = new ActionRowBuilder().addComponents(newButton);

      await interaction.editReply({
        embeds: [newEmbed],
        components: [newRow],
      });

      await btnInteraction.followUp({
        content: newValue
          ? "🔔 Notifications enabled! You'll receive a DM when rookies are ready."
          : "🔕 Notifications disabled.",
        ephemeral: true,
      });
    });

    collector.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  } catch (error) {
    console.error("train settings error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

// ============ Stats Subcommand ============

/**
 * Handle /train stats
 */
async function handleStats(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Ensure training ground exists
    const { ground } = await trainingDb.getOrCreateTrainingGround(userId, username);

    // Calculate success rate
    const total = ground.total_graduated + ground.total_busted;
    let successRate = "N/A";
    if (total > 0) {
      successRate = ((ground.total_graduated / total) * 100).toFixed(1) + "%";
    }

    // Get inventory counts for each rookie type
    const positions = getPositionKeys();
    const rosterLines = [];
    for (const pos of positions) {
      const config = getPosition(pos);
      const qty = await inventoryDb.getItemQuantity(userId, config.rookieItemType);
      rosterLines.push(`${config.emoji} ${config.displayName}: **${qty}**`);
    }

    // Format created date
    const createdAt = new Date(ground.created_at);
    const dateStr = createdAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    // Build embed
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`📊 ${username}'s Training Stats`)
      .addFields(
        {
          name: "Performance",
          value:
            `⭐ Players Graduated: **${ground.total_graduated}**\n` +
            `💀 Players Busted: **${ground.total_busted}**\n` +
            `📈 Success Rate: **${successRate}**`,
          inline: true,
        },
        {
          name: "Account",
          value: `🏟️ Training Since: **${dateStr}**`,
          inline: true,
        },
        {
          name: "🎽 Current Roster",
          value: rosterLines.join("\n") || "No rookies yet!",
          inline: false,
        }
      )
      .setFooter({ text: "Sell your rookies with /inventory sell" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("train stats error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

// ============ Helpers ============

/**
 * Get user-friendly error message
 */
function getErrorMessage(error, details = {}) {
  const messages = {
    NO_SLOTS_SELECTED: "No slots selected!",
    INSUFFICIENT_TOOLS: `Not enough tools! Need ${details.needed}, have ${details.have}.`,
    NO_EMPTY_SLOTS: "No empty slots to set up!",
    NO_PREPARED_SLOTS: "No prepared slots to hydrate!",
    INVALID_POSITION: "Invalid position selected!",
    NO_CONTRACT: `No ${details.position} contracts! Buy from /shop.`,
    SLOT_NOT_HYDRATED: "That slot isn't hydrated!",
    NOT_READY: "That player isn't ready to graduate yet!",
    NOT_BUSTED: "That slot isn't busted!",
  };

  return messages[error] || `Error: ${error}`;
}
