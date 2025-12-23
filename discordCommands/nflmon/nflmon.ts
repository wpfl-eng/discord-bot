// NFLmon Command
// Main command for NFLmon collection management

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ChatInputCommandInteraction,
  ButtonInteraction,
  AutocompleteInteraction,
  TextChannel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  MessageComponentInteraction,
} from 'discord.js';
import * as nflmonDb from '../../nflmon/nflmonDb.js';
import type { Nflmon, NflmonTrade } from '../../nflmon/nflmonDb.js';
import * as nflmonService from '../../nflmon/nflmonService.js';
import { TRADE_ERRORS } from '../../nflmon/nflmonService.js';
import type { PendingTrade } from '../../nflmon/nflmonService.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const ITEMS_PER_PAGE = 10;

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "NFLmon not found or doesn't belong to you.",
  INVALID_SLOT: 'Invalid training slot. Check your available slots with `/nflmon stats`.',
  SLOT_OCCUPIED: 'That training slot is already in use.',
  NOT_IN_TRAINING: 'This NFLmon is not currently in training.',
  ALREADY_IN_TRAINING: 'This NFLmon is already in a training slot.',
};

const COLLECTOR_TIMEOUT_MS = 300000; // 5 minutes
const RARITY_OPTIONS = ['all', 'common', 'uncommon', 'rare', 'epic', 'legendary'];
const VALID_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// =============================================================================
// LOCAL TYPES
// =============================================================================

interface DexFilters {
  r: string | null;
  s: string | null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build pagination buttons for bench view
 */
function buildPaginationButtons(
  page: number,
  totalPages: number,
  rarity: string | null = null
): ActionRowBuilder<ButtonBuilder>[] {
  if (totalPages <= 1) return [];

  const row = new ActionRowBuilder<ButtonBuilder>();
  const rarityParam = rarity ? `_${rarity}` : '';

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`nflmon_bench_prev_${page}${rarityParam}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`nflmon_bench_next_${page}${rarityParam}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );

  return [row];
}

/**
 * Build trade response buttons (for DM)
 */
function buildTradeResponseButtons(tradeId: number): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nflmon_trade_accept_${tradeId}`)
        .setLabel('Accept Trade')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`nflmon_trade_reject_${tradeId}`)
        .setLabel('Reject Trade')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

/**
 * Build dex pagination buttons
 */
function buildDexPaginationButtons(
  page: number,
  totalPages: number,
  search: string | null,
  rarity: string | null
): ActionRowBuilder<ButtonBuilder>[] {
  if (totalPages <= 1) return [];

  // Encode filters as base64 JSON to avoid delimiter parsing issues
  const filterData = JSON.stringify({ r: rarity || null, s: search?.slice(0, 20) || null });
  const encodedFilters = Buffer.from(filterData).toString('base64');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`nflmon_dex_prev_${page}_${encodedFilters}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`nflmon_dex_next_${page}_${encodedFilters}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );

  return [row];
}

/**
 * Build pending trades action buttons
 */
function buildPendingTradeButtons(
  trade: NflmonTrade,
  userId: string
): ActionRowBuilder<ButtonBuilder>[] {
  const isIncoming = trade.to_user_id === userId;

  if (isIncoming) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`nflmon_trade_accept_${trade.id}`)
          .setLabel('Accept')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`nflmon_trade_reject_${trade.id}`)
          .setLabel('Reject')
          .setStyle(ButtonStyle.Danger)
      ),
    ];
  } else {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`nflmon_trade_cancel_${trade.id}`)
          .setLabel('Cancel Trade')
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  }
}

/**
 * Build main menu embed - splash page with user stats
 */
async function buildMainMenuEmbed(userId: string, username: string): Promise<EmbedBuilder> {
  const stats = await nflmonDb.getOrCreateStats(userId, username);
  const trainingNflmon = await nflmonDb.getTrainingNflmon(userId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('NFLmon Collection Manager')
    .setDescription(
      'Welcome to NFLmon! Catch, train, and trade NFL player cards.\n\n' +
        'Use the buttons below to manage your collection.'
    )
    .addFields(
      { name: 'Total Caught', value: stats.total_caught.toString(), inline: true },
      {
        name: 'In Training',
        value: `${trainingNflmon.length}/${stats.max_training_slots}`,
        inline: true,
      },
      { name: 'Legendaries', value: stats.legendary_count.toString(), inline: true },
      { name: 'Highest Level', value: stats.highest_level_reached.toString(), inline: true }
    )
    .setFooter({ text: 'Session expires in 5 minutes' });

  return embed;
}

/**
 * Build main menu buttons
 */
function buildMainMenuButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('nflmon_menu_bench')
      .setLabel('Bench')
      .setEmoji('📦')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('nflmon_menu_view')
      .setLabel('View')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('nflmon_menu_train')
      .setLabel('Train')
      .setEmoji('💪')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('nflmon_menu_untrain')
      .setLabel('Untrain')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('nflmon_menu_stats')
      .setLabel('Stats')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('nflmon_menu_dex')
      .setLabel('Dex')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nflmon_menu_trade')
      .setLabel('Trade')
      .setEmoji('🤝')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

/**
 * Build trade submenu buttons
 */
function buildTradeSubmenuButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('nflmon_trade_menu_offer')
      .setLabel('Offer')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('nflmon_trade_menu_pending')
      .setLabel('Pending')
      .setEmoji('📥')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('nflmon_trade_menu_cancel')
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('nflmon_back_trade')
      .setLabel('Back')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

/**
 * Build rarity filter buttons for bench view
 */
function buildRarityFilterButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('nflmon_rarity_bench_all')
      .setLabel('All')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('nflmon_rarity_bench_common')
      .setLabel('Common')
      .setEmoji('⚪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nflmon_rarity_bench_uncommon')
      .setLabel('Uncommon')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nflmon_rarity_bench_rare')
      .setLabel('Rare')
      .setEmoji('💎')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('nflmon_rarity_bench_epic')
      .setLabel('Epic')
      .setEmoji('💜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nflmon_rarity_bench_legendary')
      .setLabel('Legendary')
      .setEmoji('🌟')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nflmon_back_main')
      .setLabel('Back')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

// =============================================================================
// MODAL BUILDERS
// =============================================================================

/**
 * Create modal for viewing an NFLmon by ID
 */
function createViewModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('nflmon_modal_view')
    .setTitle('View NFLmon');

  const nflmonIdInput = new TextInputBuilder()
    .setCustomId('nflmon_id')
    .setLabel('NFLmon ID')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter the ID from your bench')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nflmonIdInput));
  return modal;
}

/**
 * Create modal for training an NFLmon
 */
function createTrainModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('nflmon_modal_train')
    .setTitle('Train NFLmon');

  const nflmonIdInput = new TextInputBuilder()
    .setCustomId('nflmon_id')
    .setLabel('NFLmon ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const slotInput = new TextInputBuilder()
    .setCustomId('slot')
    .setLabel('Training Slot (1-5, leave blank for auto)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nflmonIdInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(slotInput)
  );
  return modal;
}

/**
 * Create modal for untraining an NFLmon
 */
function createUntrainModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('nflmon_modal_untrain')
    .setTitle('Remove from Training');

  const nflmonIdInput = new TextInputBuilder()
    .setCustomId('nflmon_id')
    .setLabel('NFLmon ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nflmonIdInput));
  return modal;
}

/**
 * Create modal for browsing the NFLmon dex
 */
function createDexModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('nflmon_modal_dex')
    .setTitle('Browse NFLmon Dex');

  const searchInput = new TextInputBuilder()
    .setCustomId('search')
    .setLabel('Search (name, position:WR, or team:KC)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const rarityInput = new TextInputBuilder()
    .setCustomId('rarity')
    .setLabel('Rarity filter (common/uncommon/rare/epic/legendary)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(searchInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(rarityInput)
  );
  return modal;
}

/**
 * Create modal for offering a trade
 */
function createTradeOfferModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('nflmon_modal_trade_offer')
    .setTitle('Create Trade Offer');

  const targetUserInput = new TextInputBuilder()
    .setCustomId('target_user')
    .setLabel('Target User ID (right-click user > Copy User ID)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(17)
    .setMaxLength(20)
    .setRequired(true);

  const myNflmonInput = new TextInputBuilder()
    .setCustomId('my_nflmon')
    .setLabel('Your NFLmon ID to offer')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const theirNflmonInput = new TextInputBuilder()
    .setCustomId('their_nflmon')
    .setLabel('Their NFLmon ID you want (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const coinsInput = new TextInputBuilder()
    .setCustomId('coins')
    .setLabel('Coins to include (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(targetUserInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(myNflmonInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(theirNflmonInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(coinsInput)
  );
  return modal;
}

/**
 * Create modal for cancelling a trade
 */
function createTradeCancelModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('nflmon_modal_trade_cancel')
    .setTitle('Cancel Trade');

  const tradeIdInput = new TextInputBuilder()
    .setCustomId('trade_id')
    .setLabel('Trade ID to cancel')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(tradeIdInput));
  return modal;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate NFLmon ID input from modal
 * @param str - Raw string input from user
 * @returns Validated positive integer or null if invalid
 */
function validateNflmonId(str: string): number | null {
  const parsed = parseInt(str, 10);
  if (isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * Validate training slot input from modal
 * @param str - Raw string input from user
 * @returns Validated slot number (1-5), null for auto-assign, or null if invalid
 */
function validateTrainingSlot(str: string): number | null {
  const trimmed = str.trim();
  if (trimmed === '') {
    return null; // Auto-assign
  }
  const parsed = parseInt(trimmed, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 5) {
    return null;
  }
  return parsed;
}

/**
 * Validate rarity input from modal
 * @param str - Raw string input from user
 * @returns Validated rarity string or null if invalid/empty
 */
function validateRarity(str: string): string | null {
  const trimmed = str.trim().toLowerCase();
  if (trimmed === '') {
    return null; // No filter
  }
  if (!VALID_RARITIES.includes(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Validate Discord user ID input from modal
 * @param str - Raw string input from user
 * @returns Validated Discord snowflake ID or null if invalid
 */
function validateDiscordUserId(str: string): string | null {
  const trimmed = str.trim();
  const discordIdPattern = /^\d{17,20}$/;
  if (!discordIdPattern.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Validate coins input from modal
 * @param str - Raw string input from user
 * @returns Validated non-negative integer or null if invalid
 */
function validateCoins(str: string): number | null {
  const trimmed = str.trim();
  if (trimmed === '') {
    return 0; // No coins
  }
  const parsed = parseInt(trimmed, 10);
  if (isNaN(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

// =============================================================================
// SLASH COMMAND BUILDER
// =============================================================================

export const data = new SlashCommandBuilder()
  .setName('nflmon')
  .setDescription('NFLmon collection management - catch, train, and trade!');

// =============================================================================
// MAIN EXECUTE FUNCTION
// =============================================================================

/**
 * Handle menu interaction router - routes based on customId prefix
 */
async function handleMenuInteraction(
  interaction: MessageComponentInteraction,
  userId: string,
  username: string,
  originalInteraction: ChatInputCommandInteraction
): Promise<void> {
  const customId = interaction.customId;

  // === MAIN MENU BUTTONS ===
  if (customId === 'nflmon_menu_bench') {
    // Show rarity filter buttons
    await interaction.deferUpdate();
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Select Rarity Filter')
      .setDescription('Choose a rarity to filter your bench, or "All" to see everything.');
    await interaction.editReply({
      embeds: [embed],
      components: buildRarityFilterButtons(),
    });
    return;
  }

  if (customId === 'nflmon_menu_view') {
    await interaction.showModal(createViewModal());

    // Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        time: 60000,
        filter: (mi) => mi.customId === 'nflmon_modal_view' && mi.user.id === userId,
      });
    } catch {
      // Modal dismissed or timed out - just return
      return;
    }

    await modalInteraction.deferUpdate();

    // Validate input
    const idStr = modalInteraction.fields.getTextInputValue('nflmon_id');
    const nflmonId = validateNflmonId(idStr);

    if (nflmonId === null) {
      await modalInteraction.followUp({
        content: 'Invalid NFLmon ID. Please enter a positive number.',
        ephemeral: true,
      });
      return;
    }

    // Execute the view action - get NFLmon and display
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await modalInteraction.followUp({
        content: ERROR_MESSAGES.NOT_FOUND,
        ephemeral: true,
      });
      return;
    }

    const displayData = nflmonService.getDisplayData(nflmon);
    if (!displayData) {
      await modalInteraction.followUp({ content: 'Error loading NFLmon data.', ephemeral: true });
      return;
    }

    const embed = nflmonService.buildNflmonCard(displayData);
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_main')
        .setLabel('Back to Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );

    await modalInteraction.editReply({ embeds: [embed], components: [backRow] });
    return;
  }

  if (customId === 'nflmon_menu_train') {
    await interaction.showModal(createTrainModal());

    // Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        time: 60000,
        filter: (mi) => mi.customId === 'nflmon_modal_train' && mi.user.id === userId,
      });
    } catch {
      // Modal dismissed or timed out - just return
      return;
    }

    await modalInteraction.deferUpdate();

    // Validate inputs
    const idStr = modalInteraction.fields.getTextInputValue('nflmon_id');
    const nflmonId = validateNflmonId(idStr);

    if (nflmonId === null) {
      await modalInteraction.followUp({
        content: 'Invalid NFLmon ID. Please enter a positive number.',
        ephemeral: true,
      });
      return;
    }

    const slotStr = modalInteraction.fields.getTextInputValue('slot');
    const slot = validateTrainingSlot(slotStr);

    // Get user stats to check max training slots
    const stats = await nflmonDb.getOrCreateStats(userId, username);

    // Check if NFLmon exists and belongs to user
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await modalInteraction.followUp({
        content: ERROR_MESSAGES.NOT_FOUND,
        ephemeral: true,
      });
      return;
    }

    // Check if already in training
    if (nflmon.training_slot !== null) {
      await modalInteraction.followUp({
        content: ERROR_MESSAGES.ALREADY_IN_TRAINING,
        ephemeral: true,
      });
      return;
    }

    // Determine final slot (auto-assign if null)
    let finalSlot = slot;
    if (finalSlot === null) {
      const trainingNflmon = await nflmonDb.getTrainingNflmon(userId);
      const usedSlots = trainingNflmon.map((n) => n.training_slot);

      for (let i = 1; i <= stats.max_training_slots; i++) {
        if (!usedSlots.includes(i)) {
          finalSlot = i;
          break;
        }
      }

      if (finalSlot === null) {
        await modalInteraction.followUp({
          content: `All ${stats.max_training_slots} training slots are full. Use the Untrain button to remove one first.`,
          ephemeral: true,
        });
        return;
      }
    }

    // Validate slot is within user's max
    if (finalSlot > stats.max_training_slots) {
      await modalInteraction.followUp({
        content: ERROR_MESSAGES.INVALID_SLOT,
        ephemeral: true,
      });
      return;
    }

    // Assign to training slot
    const result = await nflmonDb.setTrainingSlot(userId, nflmonId, finalSlot);

    if (!result.success) {
      const errorMsg = ERROR_MESSAGES[result.error] || 'Failed to assign training slot.';
      await modalInteraction.followUp({ content: errorMsg, ephemeral: true });
      return;
    }

    // Get player info for response
    const player = nflmonService.getPlayer(nflmon.player_id);
    const name = nflmon.nickname || player?.name || 'Unknown';

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Training Started!')
      .setDescription(
        `**${name}** is now training in slot **${finalSlot}**!\n\n` +
          `They will earn XP when you play Wordle, Trivia, and other games.`
      );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_main')
        .setLabel('Back to Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );

    await modalInteraction.editReply({ embeds: [embed], components: [backRow] });
    return;
  }

  if (customId === 'nflmon_menu_untrain') {
    await interaction.showModal(createUntrainModal());

    // Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        time: 60000,
        filter: (mi) => mi.customId === 'nflmon_modal_untrain' && mi.user.id === userId,
      });
    } catch {
      // Modal dismissed or timed out - just return
      return;
    }

    await modalInteraction.deferUpdate();

    // Validate input
    const idStr = modalInteraction.fields.getTextInputValue('nflmon_id');
    const nflmonId = validateNflmonId(idStr);

    if (nflmonId === null) {
      await modalInteraction.followUp({
        content: 'Invalid NFLmon ID. Please enter a positive number.',
        ephemeral: true,
      });
      return;
    }

    // Get NFLmon to check if it's in training
    const nflmon = await nflmonDb.getNflmonByUser(userId, nflmonId);
    if (!nflmon) {
      await modalInteraction.followUp({
        content: ERROR_MESSAGES.NOT_FOUND,
        ephemeral: true,
      });
      return;
    }

    if (nflmon.training_slot === null) {
      await modalInteraction.followUp({
        content: ERROR_MESSAGES.NOT_IN_TRAINING,
        ephemeral: true,
      });
      return;
    }

    const oldSlot = nflmon.training_slot;

    // Remove from training
    const result = await nflmonDb.removeFromTraining(userId, nflmonId);
    if (!result) {
      await modalInteraction.followUp({
        content: 'Failed to remove from training.',
        ephemeral: true,
      });
      return;
    }

    const player = nflmonService.getPlayer(nflmon.player_id);
    const name = nflmon.nickname || player?.name || 'Unknown';

    const embed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle('Training Stopped')
      .setDescription(`**${name}** has been removed from training slot **${oldSlot}**.`);

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_main')
        .setLabel('Back to Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );

    await modalInteraction.editReply({ embeds: [embed], components: [backRow] });
    return;
  }

  if (customId === 'nflmon_menu_stats') {
    await interaction.deferUpdate();
    // Execute stats directly - Task 9 will have internal execute function
    const stats = await nflmonDb.getOrCreateStats(userId, username);
    const trainingNflmon = await nflmonDb.getTrainingNflmon(userId);
    const embed = nflmonService.buildStatsEmbed(stats, trainingNflmon);

    // Add back button
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_main')
        .setLabel('Back to Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.editReply({ embeds: [embed], components: [backRow] });
    return;
  }

  if (customId === 'nflmon_menu_dex') {
    await interaction.showModal(createDexModal());

    // Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        time: 60000,
        filter: (mi) => mi.customId === 'nflmon_modal_dex' && mi.user.id === userId,
      });
    } catch {
      // Modal dismissed or timed out - just return
      return;
    }

    await modalInteraction.deferUpdate();

    // Get and validate inputs
    const search = modalInteraction.fields.getTextInputValue('search').trim().toLowerCase() || null;
    const rarityStr = modalInteraction.fields.getTextInputValue('rarity').trim();
    const rarity = validateRarity(rarityStr);

    // Validate rarity if provided
    if (rarityStr !== '' && rarity === null) {
      await modalInteraction.followUp({
        content: 'Invalid rarity. Valid options: common, uncommon, rare, epic, legendary',
        ephemeral: true,
      });
      return;
    }

    // Get all players from JSON (single source of truth)
    let players = nflmonService.getAllPlayers();

    // Apply filters
    if (rarity) {
      players = players.filter((p) => p.rarityPool === rarity);
    }
    if (search) {
      if (search.startsWith('position:')) {
        const pos = search.replace('position:', '').toUpperCase();
        players = players.filter((p) => p.position === pos);
      } else if (search.startsWith('team:')) {
        const team = search.replace('team:', '').toUpperCase();
        players = players.filter((p) => p.team.toUpperCase() === team);
      } else {
        players = players.filter((p) => p.name.toLowerCase().includes(search));
      }
    }

    // Sort and paginate
    players.sort((a, b) => a.name.localeCompare(b.name));
    const totalCount = players.length;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;
    const page = 1;
    const paginated = players.slice(0, ITEMS_PER_PAGE);

    const embed = nflmonService.buildDexEmbed(paginated, page, totalPages, totalCount, {
      search: search ?? undefined,
      rarity: rarity ?? undefined,
    });
    const paginationComponents = buildDexPaginationButtons(page, totalPages, search, rarity);

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_main')
        .setLabel('Back to Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );

    await modalInteraction.editReply({
      embeds: [embed],
      components: [...paginationComponents, backRow],
    });
    return;
  }

  if (customId === 'nflmon_menu_trade') {
    await interaction.deferUpdate();
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('NFLmon Trading')
      .setDescription('Trade NFLmon with other users!');
    await interaction.editReply({
      embeds: [embed],
      components: buildTradeSubmenuButtons(),
    });
    return;
  }

  // === TRADE SUBMENU ===
  if (customId === 'nflmon_trade_menu_offer') {
    await interaction.showModal(createTradeOfferModal());

    // Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        time: 60000,
        filter: (mi) => mi.customId === 'nflmon_modal_trade_offer' && mi.user.id === userId,
      });
    } catch {
      // Modal dismissed or timed out - just return
      return;
    }

    await modalInteraction.deferUpdate();

    // Get and validate inputs
    const targetUserStr = modalInteraction.fields.getTextInputValue('target_user');
    const targetUserId = validateDiscordUserId(targetUserStr);

    if (targetUserId === null) {
      await modalInteraction.followUp({
        content: 'Invalid User ID. Please enter a valid Discord user ID (17-20 digits).',
        ephemeral: true,
      });
      return;
    }

    const myNflmonStr = modalInteraction.fields.getTextInputValue('my_nflmon');
    const myNflmonId = validateNflmonId(myNflmonStr);

    if (myNflmonId === null) {
      await modalInteraction.followUp({
        content: 'Invalid NFLmon ID for your offer. Please enter a positive number.',
        ephemeral: true,
      });
      return;
    }

    const theirNflmonStr = modalInteraction.fields.getTextInputValue('their_nflmon').trim();
    let theirNflmonId: number | null = null;
    if (theirNflmonStr !== '') {
      theirNflmonId = validateNflmonId(theirNflmonStr);
      if (theirNflmonId === null) {
        await modalInteraction.followUp({
          content: 'Invalid NFLmon ID for their NFLmon. Please enter a positive number or leave blank.',
          ephemeral: true,
        });
        return;
      }
    }

    const coinsStr = modalInteraction.fields.getTextInputValue('coins').trim();
    const coinsOffered = validateCoins(coinsStr);

    if (coinsOffered === null) {
      await modalInteraction.followUp({
        content: 'Invalid coins value. Please enter a non-negative number or leave blank.',
        ephemeral: true,
      });
      return;
    }

    // Prevent self-trade
    if (targetUserId === userId) {
      await modalInteraction.followUp({
        content: TRADE_ERRORS.SELF_TRADE,
        ephemeral: true,
      });
      return;
    }

    // Validate my NFLmon exists and not in training
    const myNflmon = await nflmonDb.getNflmonByUser(userId, myNflmonId);
    if (!myNflmon) {
      await modalInteraction.followUp({
        content: ERROR_MESSAGES.NOT_FOUND,
        ephemeral: true,
      });
      return;
    }
    if (myNflmon.training_slot !== null) {
      await modalInteraction.followUp({
        content: 'Your NFLmon is in training. Untrain it first.',
        ephemeral: true,
      });
      return;
    }

    // Validate their NFLmon if specified
    let theirNflmon: Nflmon | null = null;
    if (theirNflmonId) {
      theirNflmon = await nflmonDb.getNflmonByUser(targetUserId, theirNflmonId);
      if (!theirNflmon) {
        await modalInteraction.followUp({
          content: "The requested NFLmon doesn't exist or doesn't belong to that user.",
          ephemeral: true,
        });
        return;
      }
      if (theirNflmon.training_slot !== null) {
        await modalInteraction.followUp({
          content: 'That NFLmon is currently in training. The owner must untrain it first.',
          ephemeral: true,
        });
        return;
      }
    }

    // Fetch target user from Discord
    let targetUser;
    try {
      targetUser = await originalInteraction.client.users.fetch(targetUserId);
    } catch {
      await modalInteraction.followUp({
        content: 'Could not find that user. Please check the User ID.',
        ephemeral: true,
      });
      return;
    }

    // Create the trade
    const dbTrade = await nflmonDb.createTrade({
      fromUserId: userId,
      toUserId: targetUserId,
      fromNflmonId: myNflmonId,
      toNflmonId: theirNflmonId,
      coinsOffered,
    });

    if (!dbTrade) {
      await modalInteraction.followUp({
        content: 'Failed to create trade offer.',
        ephemeral: true,
      });
      return;
    }

    // Convert to PendingTrade format for embed functions
    const trade: PendingTrade = {
      id: dbTrade.id,
      from_user_id: dbTrade.from_user_id,
      to_user_id: dbTrade.to_user_id,
      expires_at: dbTrade.expires_at,
      from_username: username,
      to_username: targetUser.username,
      coins_offered: dbTrade.coins_offered,
    };

    // Get player info for embeds
    const myPlayer = nflmonService.getPlayer(myNflmon.player_id);
    const theirPlayer = theirNflmon ? nflmonService.getPlayer(theirNflmon.player_id) : null;

    // Build confirmation embed for sender
    const senderEmbed = nflmonService.buildTradeOfferEmbed(
      trade,
      myNflmon,
      theirNflmon,
      myPlayer,
      theirPlayer
    );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_trade')
        .setLabel('Back to Trade Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );

    await modalInteraction.editReply({ embeds: [senderEmbed], components: [backRow] });

    // Send DM to recipient
    try {
      const recipientEmbed = nflmonService.buildTradeReceivedEmbed(
        trade,
        myNflmon,
        theirNflmon,
        myPlayer,
        theirPlayer,
        username
      );
      const dmButtons = buildTradeResponseButtons(trade.id);
      await targetUser.send({ embeds: [recipientEmbed], components: dmButtons });
    } catch {
      console.log('[NFLMON] Could not DM trade recipient - they may have DMs disabled');
    }

    console.log(`[NFLMON] Trade #${trade.id} created: ${username} -> ${targetUser.username}`);
    return;
  }

  if (customId === 'nflmon_trade_menu_pending') {
    await interaction.deferUpdate();
    // Show pending trades - simplified for now
    const trades = await nflmonDb.getPendingTrades(userId);
    if (trades.length === 0) {
      await interaction.editReply({
        content: 'You have no pending trades.',
        embeds: [],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('nflmon_back_trade')
            .setLabel('Back')
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Secondary)
        )],
      });
      return;
    }
    const embed = nflmonService.buildPendingTradesEmbed(trades, userId, 1, 1);
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_trade')
        .setLabel('Back')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.editReply({ embeds: [embed], components: [backRow] });
    return;
  }

  if (customId === 'nflmon_trade_menu_cancel') {
    await interaction.showModal(createTradeCancelModal());

    // Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        time: 60000,
        filter: (mi) => mi.customId === 'nflmon_modal_trade_cancel' && mi.user.id === userId,
      });
    } catch {
      // Modal dismissed or timed out - just return
      return;
    }

    await modalInteraction.deferUpdate();

    // Validate input
    const tradeIdStr = modalInteraction.fields.getTextInputValue('trade_id');
    const tradeId = validateNflmonId(tradeIdStr); // Reuse validation for positive integers

    if (tradeId === null) {
      await modalInteraction.followUp({
        content: 'Invalid Trade ID. Please enter a positive number.',
        ephemeral: true,
      });
      return;
    }

    // Cancel the trade
    const cancelledTrade = await nflmonDb.cancelTrade(userId, tradeId);

    if (!cancelledTrade) {
      await modalInteraction.followUp({
        content: TRADE_ERRORS.NOT_SENDER || 'Failed to cancel trade. Make sure the Trade ID is correct and you are the sender.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle('Trade Cancelled')
      .setDescription(`Trade #${tradeId} has been cancelled.`);

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_trade')
        .setLabel('Back to Trade Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );

    await modalInteraction.editReply({ embeds: [embed], components: [backRow] });
    return;
  }

  // === RARITY FILTERS ===
  if (customId.startsWith('nflmon_rarity_bench_')) {
    await interaction.deferUpdate();
    const rarity = customId.replace('nflmon_rarity_bench_', '');
    const filterRarity = rarity === 'all' ? null : rarity;

    // Fetch bench data
    const benchRecords = await nflmonDb.getBench(userId, {
      rarity: filterRarity ?? undefined,
      page: 1,
      limit: 10,
    });
    const totalCount = await nflmonDb.getBenchCount(userId, filterRarity ?? undefined);
    const totalPages = Math.ceil(totalCount / 10) || 1;

    const embed = nflmonService.buildBenchEmbed(benchRecords, 1, totalPages, totalCount);

    // Build back button row
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('nflmon_back_main')
        .setLabel('Back to Menu')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [backRow] });
    return;
  }

  // === BACK BUTTONS ===
  if (customId === 'nflmon_back_main') {
    await interaction.deferUpdate();
    const embed = await buildMainMenuEmbed(userId, username);
    await interaction.editReply({
      content: '',
      embeds: [embed],
      components: buildMainMenuButtons(),
    });
    return;
  }

  if (customId === 'nflmon_back_trade') {
    await interaction.deferUpdate();
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('NFLmon Trading')
      .setDescription('Trade NFLmon with other users!');
    await interaction.editReply({
      embeds: [embed],
      components: buildTradeSubmenuButtons(),
    });
    return;
  }

  // === UNHANDLED ===
  console.log('[NFLMON] Unhandled menu interaction:', customId);
  await interaction.deferUpdate();
}

/**
 * Execute the nflmon command - menu-driven interface
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // Build and show splash page with main menu
  const embed = await buildMainMenuEmbed(userId, username);
  const components = buildMainMenuButtons();

  const response = await interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
    fetchReply: true,
  });

  // Create unified collector for all interactions
  const collector = response.createMessageComponentCollector({
    time: COLLECTOR_TIMEOUT_MS,
    filter: (i: MessageComponentInteraction) => i.user.id === userId,
  });

  collector.on('collect', async (buttonInteraction: MessageComponentInteraction) => {
    try {
      await handleMenuInteraction(buttonInteraction, userId, username, interaction);
    } catch (error) {
      console.error('[NFLMON] Menu interaction error:', error);
      try {
        if (!buttonInteraction.replied && !buttonInteraction.deferred) {
          await buttonInteraction.reply({
            content: 'An error occurred. Please try again.',
            ephemeral: true,
          });
        }
      } catch {
        // Ignore follow-up errors
      }
    }
  });

  collector.on('end', async () => {
    try {
      // Disable all buttons on timeout
      const disabledComponents = buildMainMenuButtons().map((row) => {
        const newRow = new ActionRowBuilder<ButtonBuilder>();
        row.components.forEach((button) => {
          newRow.addComponents(ButtonBuilder.from(button).setDisabled(true));
        });
        return newRow;
      });
      await interaction.editReply({ components: disabledComponents });
    } catch {
      // Message may have been deleted
    }
  });
}

// =============================================================================
// HANDLER FUNCTIONS
// =============================================================================

/**
 * Handle /nflmon bench
 */
async function handleBench(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const rarity = interaction.options.getString('rarity');
    const page = interaction.options.getInteger('page') || 1;

    // Fetch data
    const benchRecords = await nflmonDb.getBench(userId, {
      rarity: rarity ?? undefined,
      page,
      limit: ITEMS_PER_PAGE,
    });
    const totalCount = await nflmonDb.getBenchCount(userId, rarity ?? undefined);
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;

    // Build embed
    const embed = nflmonService.buildBenchEmbed(benchRecords, page, totalPages, totalCount);

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
        filter: (i: ButtonInteraction) => i.user.id === userId,
      });

      collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
        const [, , action, currentPageStr, filterRarity] = buttonInteraction.customId.split('_');
        const currentPage = parseInt(currentPageStr, 10);
        const newPage = action === 'prev' ? currentPage - 1 : currentPage + 1;

        // Fetch new page
        const newRecords = await nflmonDb.getBench(userId, {
          rarity: (filterRarity || rarity) ?? undefined,
          page: newPage,
          limit: ITEMS_PER_PAGE,
        });

        const newEmbed = nflmonService.buildBenchEmbed(newRecords, newPage, totalPages, totalCount);
        const newComponents = buildPaginationButtons(newPage, totalPages, filterRarity || rarity);

        await buttonInteraction.update({
          embeds: [newEmbed],
          components: newComponents,
        });
      });

      collector.on('end', async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    }
  } catch (error) {
    console.error('[NFLMON] bench error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon view
 */
async function handleView(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const nflmonId = interaction.options.getInteger('id', true);

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
        content: 'Error loading NFLmon data.',
      });
      return;
    }

    // Build and send card
    const embed = nflmonService.buildNflmonCard(displayData);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[NFLMON] view error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon train
 */
async function handleTrain(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const nflmonId = interaction.options.getInteger('id', true);
    let slot = interaction.options.getInteger('slot');

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
      const errorMsg = ERROR_MESSAGES[result.error] || 'Failed to assign training slot.';
      await interaction.editReply({ content: errorMsg });
      return;
    }

    // Get player info for response
    const player = nflmonService.getPlayer(nflmon.player_id);
    const name = nflmon.nickname || player?.name || 'Unknown';

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Training Started!')
      .setDescription(
        `**${name}** is now training in slot **${slot}**!\n\n` +
          `They will earn XP when you play Wordle, Trivia, and other games.`
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[NFLMON] train error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon untrain
 */
async function handleUntrain(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const nflmonId = interaction.options.getInteger('id', true);

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
        content: 'Failed to remove from training.',
      });
      return;
    }

    const player = nflmonService.getPlayer(nflmon.player_id);
    const name = nflmon.nickname || player?.name || 'Unknown';

    const embed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle('Training Stopped')
      .setDescription(`**${name}** has been removed from training slot **${oldSlot}**.`);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[NFLMON] untrain error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon stats
 */
async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
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
    console.error('[NFLMON] stats error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon dex
 */
async function handleDex(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const search = interaction.options.getString('search')?.toLowerCase();
    const rarity = interaction.options.getString('rarity');
    const page = interaction.options.getInteger('page') || 1;

    // Get all players from JSON (single source of truth)
    let players = nflmonService.getAllPlayers();

    // Apply filters
    if (rarity) {
      players = players.filter((p) => p.rarityPool === rarity);
    }
    if (search) {
      if (search.startsWith('position:')) {
        const pos = search.replace('position:', '').toUpperCase();
        players = players.filter((p) => p.position === pos);
      } else if (search.startsWith('team:')) {
        const team = search.replace('team:', '').toUpperCase();
        players = players.filter((p) => p.team.toUpperCase() === team);
      } else {
        players = players.filter((p) => p.name.toLowerCase().includes(search));
      }
    }

    // Sort and paginate
    players.sort((a, b) => a.name.localeCompare(b.name));
    const totalCount = players.length;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;
    const paginated = players.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    const embed = nflmonService.buildDexEmbed(paginated, page, totalPages, totalCount, {
      search: search ?? undefined,
      rarity: rarity ?? undefined,
    });
    const components = buildDexPaginationButtons(page, totalPages, search ?? null, rarity);

    const response = await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Handle pagination if buttons exist
    if (components.length > 0) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i: ButtonInteraction) => i.user.id === interaction.user.id,
      });

      collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
        const parts = buttonInteraction.customId.split('_');
        const action = parts[2]; // prev or next
        const currentPage = parseInt(parts[3], 10);

        // Decode base64 JSON filters
        let filterRarity: string | null = null;
        let filterSearch: string | null = null;
        try {
          const encodedFilters = parts[4];
          if (encodedFilters) {
            const filterData: DexFilters = JSON.parse(
              Buffer.from(encodedFilters, 'base64').toString('utf8')
            );
            filterRarity = filterData.r || null;
            filterSearch = filterData.s || null;
          }
        } catch (e) {
          console.error('[NFLMON] Failed to decode DEX filters:', e);
        }

        const newPage = action === 'prev' ? currentPage - 1 : currentPage + 1;

        // Re-filter players
        let filteredPlayers = nflmonService.getAllPlayers();
        if (filterRarity) {
          filteredPlayers = filteredPlayers.filter((p) => p.rarityPool === filterRarity);
        }
        if (filterSearch) {
          if (filterSearch.startsWith('position:')) {
            const pos = filterSearch.replace('position:', '').toUpperCase();
            filteredPlayers = filteredPlayers.filter((p) => p.position === pos);
          } else if (filterSearch.startsWith('team:')) {
            const team = filterSearch.replace('team:', '').toUpperCase();
            filteredPlayers = filteredPlayers.filter((p) => p.team.toUpperCase() === team);
          } else {
            filteredPlayers = filteredPlayers.filter((p) =>
              p.name.toLowerCase().includes(filterSearch!)
            );
          }
        }

        filteredPlayers.sort((a, b) => a.name.localeCompare(b.name));

        // Recalculate totalPages based on filtered results
        const newTotalPages = Math.ceil(filteredPlayers.length / ITEMS_PER_PAGE) || 1;

        const newPaginated = filteredPlayers.slice(
          (newPage - 1) * ITEMS_PER_PAGE,
          newPage * ITEMS_PER_PAGE
        );

        const newEmbed = nflmonService.buildDexEmbed(
          newPaginated,
          newPage,
          newTotalPages,
          filteredPlayers.length,
          { search: filterSearch ?? undefined, rarity: filterRarity ?? undefined }
        );
        const newComponents = buildDexPaginationButtons(
          newPage,
          newTotalPages,
          filterSearch,
          filterRarity
        );

        await buttonInteraction.update({
          embeds: [newEmbed],
          components: newComponents,
        });
      });

      collector.on('end', async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    }
  } catch (error) {
    console.error('[NFLMON] dex error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon trade offer
 */
async function handleTradeOffer(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const targetUser = interaction.options.getUser('user', true);
    const myNflmonId = interaction.options.getInteger('my_nflmon', true);
    const theirNflmonId = interaction.options.getInteger('their_nflmon');
    const coinsOffered = interaction.options.getInteger('coins') || 0;

    // Prevent self-trade
    if (targetUser.id === userId) {
      await interaction.editReply({ content: TRADE_ERRORS.SELF_TRADE });
      return;
    }

    // Validate my NFLmon exists and not in training
    const myNflmon = await nflmonDb.getNflmonByUser(userId, myNflmonId);
    if (!myNflmon) {
      await interaction.editReply({ content: ERROR_MESSAGES.NOT_FOUND });
      return;
    }
    if (myNflmon.training_slot !== null) {
      await interaction.editReply({
        content: 'Your NFLmon is in training. Untrain it first with `/nflmon untrain`.',
      });
      return;
    }

    // Validate their NFLmon if specified
    let theirNflmon: Nflmon | null = null;
    if (theirNflmonId) {
      theirNflmon = await nflmonDb.getNflmonByUser(targetUser.id, theirNflmonId);
      if (!theirNflmon) {
        await interaction.editReply({
          content: "The requested NFLmon doesn't exist or doesn't belong to that user.",
        });
        return;
      }
      if (theirNflmon.training_slot !== null) {
        await interaction.editReply({
          content: 'That NFLmon is currently in training. The owner must untrain it first.',
        });
        return;
      }
    }

    // Create the trade
    const dbTrade = await nflmonDb.createTrade({
      fromUserId: userId,
      toUserId: targetUser.id,
      fromNflmonId: myNflmonId,
      toNflmonId: theirNflmonId,
      coinsOffered,
    });

    if (!dbTrade) {
      await interaction.editReply({ content: 'Failed to create trade offer.' });
      return;
    }

    // Convert to PendingTrade format for embed functions
    const trade: PendingTrade = {
      id: dbTrade.id,
      from_user_id: dbTrade.from_user_id,
      to_user_id: dbTrade.to_user_id,
      expires_at: dbTrade.expires_at,
      from_username: username,
      to_username: targetUser.username,
      coins_offered: dbTrade.coins_offered,
    };

    // Get player info for embeds
    const myPlayer = nflmonService.getPlayer(myNflmon.player_id);
    const theirPlayer = theirNflmon ? nflmonService.getPlayer(theirNflmon.player_id) : null;

    // Build confirmation embed for sender
    const senderEmbed = nflmonService.buildTradeOfferEmbed(
      trade,
      myNflmon,
      theirNflmon,
      myPlayer,
      theirPlayer
    );
    await interaction.editReply({ embeds: [senderEmbed] });

    // Send DM to recipient
    try {
      const recipientEmbed = nflmonService.buildTradeReceivedEmbed(
        trade,
        myNflmon,
        theirNflmon,
        myPlayer,
        theirPlayer,
        username
      );
      const dmButtons = buildTradeResponseButtons(trade.id);
      await targetUser.send({ embeds: [recipientEmbed], components: dmButtons });
    } catch {
      console.log('[NFLMON] Could not DM trade recipient - they may have DMs disabled');
    }

    console.log(`[NFLMON] Trade #${trade.id} created: ${username} -> ${targetUser.username}`);
  } catch (error) {
    console.error('[NFLMON] trade offer error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon trade pending
 */
async function handleTradePending(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;

    // Get pending trades for user
    const trades = await nflmonDb.getPendingTrades(userId);

    if (trades.length === 0) {
      await interaction.editReply({
        content: 'You have no pending trades.',
      });
      return;
    }

    // Build embed and buttons for each trade
    const embed = nflmonService.buildPendingTradesEmbed(trades, userId, 1, 1);

    // For simplicity, show action buttons for the first trade only
    const firstTrade = trades[0];
    const components = buildPendingTradeButtons(firstTrade, userId);

    const response = await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Handle button clicks
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
      filter: (i: ButtonInteraction) => i.user.id === userId,
    });

    collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      const [, , action, tradeIdStr] = buttonInteraction.customId.split('_');
      const tradeId = parseInt(tradeIdStr, 10);

      if (action === 'accept') {
        const result = await nflmonService.processTradeAccept(userId, tradeId);

        await buttonInteraction.update({
          embeds: [result.responseEmbed],
          components: [],
        });

        // Announce trade completion publicly
        if (result.success && result.announceEmbed) {
          try {
            const channelId = process.env.GENERAL_CHANNEL_ID;
            if (channelId) {
              const channel = await interaction.client.channels.fetch(channelId);
              if (channel && channel.isTextBased()) {
                await (channel as TextChannel).send({ embeds: [result.announceEmbed] });
              }
            }
          } catch (announceError) {
            const errorMessage =
              announceError instanceof Error ? announceError.message : 'Unknown error';
            console.log('[NFLMON] Could not announce trade:', errorMessage);
          }
        }

        collector.stop();
      } else if (action === 'reject') {
        const result = await nflmonService.processTradeReject(userId, tradeId);

        await buttonInteraction.update({
          embeds: [result.responseEmbed],
          components: [],
        });
        collector.stop();
      } else if (action === 'cancel') {
        const result = await nflmonService.processTradeCancel(userId, tradeId);

        await buttonInteraction.update({
          embeds: [result.responseEmbed],
          components: [],
        });
        collector.stop();
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  } catch (error) {
    console.error('[NFLMON] trade pending error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

/**
 * Handle /nflmon trade cancel
 */
async function handleTradeCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const tradeId = interaction.options.getInteger('trade_id', true);

    const cancelledTrade = await nflmonDb.cancelTrade(userId, tradeId);

    if (!cancelledTrade) {
      // cancelTrade returns null if trade not found or user isn't the sender
      const errorMsg = TRADE_ERRORS.NOT_SENDER || 'Failed to cancel trade.';
      await interaction.editReply({ content: errorMsg });
      return;
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle('Trade Cancelled')
          .setDescription(`Trade #${tradeId} has been cancelled.`),
      ],
    });
  } catch (error) {
    console.error('[NFLMON] trade cancel error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${errorMessage}`,
    });
  }
}

// =============================================================================
// AUTOCOMPLETE HANDLER
// =============================================================================

/**
 * Handle autocomplete for NFLmon ID
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focusedOption = interaction.options.getFocused(true);

    // Handle both "id" and "my_nflmon" options (both are NFLmon IDs for the current user)
    if (focusedOption.name === 'id' || focusedOption.name === 'my_nflmon') {
      const userId = interaction.user.id;
      const searchValue = focusedOption.value.toString().toLowerCase();

      // Get user's bench (limit 100 for autocomplete)
      const bench = await nflmonDb.getBench(userId, { limit: 100 });

      // Filter and format choices
      const choices = bench
        .filter((record) => {
          const player = nflmonService.getPlayer(record.player_id);
          const name = record.nickname || player?.name || '';
          const idMatch = record.id.toString().includes(searchValue);
          const nameMatch = name.toLowerCase().includes(searchValue);
          return idMatch || nameMatch || searchValue === '';
        })
        .slice(0, 25)
        .map((record) => {
          const player = nflmonService.getPlayer(record.player_id);
          const name = record.nickname || player?.name || 'Unknown';
          const trainingIndicator = record.training_slot ? ' [T]' : '';
          return {
            name: `#${record.id} - ${name} (Lv.${record.level})${trainingIndicator}`,
            value: record.id,
          };
        });

      await interaction.respond(choices);
    }
  } catch (error) {
    console.error('[NFLMON] autocomplete error:', error);
    await interaction.respond([]);
  }
}
