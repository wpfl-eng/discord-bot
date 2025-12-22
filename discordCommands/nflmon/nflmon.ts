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
} from 'discord.js';
import * as nflmonDb from '../../nflmon/nflmonDb.js';
import type { Nflmon, NflmonTrade } from '../../nflmon/nflmonDb.js';
import * as nflmonService from '../../nflmon/nflmonService.js';
import { TRADE_ERRORS } from '../../nflmon/nflmonService.js';
import type { DisplayData, PendingTrade } from '../../nflmon/nflmonService.js';
import { formatRarity } from '../../nflmon/nflmonConfig.js';

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

// =============================================================================
// SLASH COMMAND BUILDER
// =============================================================================

export const data = new SlashCommandBuilder()
  .setName('nflmon')
  .setDescription('NFLmon collection management')

  // bench [rarity] [page]
  .addSubcommand((sub) =>
    sub
      .setName('bench')
      .setDescription('View your NFLmon collection')
      .addStringOption((opt) =>
        opt
          .setName('rarity')
          .setDescription('Filter by rarity')
          .setRequired(false)
          .addChoices(
            { name: 'Common', value: 'common' },
            { name: 'Uncommon', value: 'uncommon' },
            { name: 'Rare', value: 'rare' },
            { name: 'Epic', value: 'epic' },
            { name: 'Legendary', value: 'legendary' }
          )
      )
      .addIntegerOption((opt) => opt.setName('page').setDescription('Page number').setMinValue(1))
  )

  // view <id>
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View detailed NFLmon stats')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('NFLmon ID').setRequired(true).setAutocomplete(true)
      )
  )

  // train <id> [slot]
  .addSubcommand((sub) =>
    sub
      .setName('train')
      .setDescription('Assign NFLmon to a training slot')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('NFLmon ID').setRequired(true).setAutocomplete(true)
      )
      .addIntegerOption((opt) =>
        opt.setName('slot').setDescription('Training slot (1-5)').setMinValue(1).setMaxValue(5)
      )
  )

  // untrain <id>
  .addSubcommand((sub) =>
    sub
      .setName('untrain')
      .setDescription('Remove NFLmon from training')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('NFLmon ID').setRequired(true).setAutocomplete(true)
      )
  )

  // stats
  .addSubcommand((sub) => sub.setName('stats').setDescription('View your NFLmon statistics'))

  // dex [search] [rarity] [page]
  .addSubcommand((sub) =>
    sub
      .setName('dex')
      .setDescription('Browse the NFLmon encyclopedia')
      .addStringOption((opt) =>
        opt.setName('search').setDescription('Search: name, position:WR, or team:KC')
      )
      .addStringOption((opt) =>
        opt
          .setName('rarity')
          .setDescription('Filter by rarity')
          .addChoices(
            { name: 'Common', value: 'common' },
            { name: 'Uncommon', value: 'uncommon' },
            { name: 'Rare', value: 'rare' },
            { name: 'Epic', value: 'epic' },
            { name: 'Legendary', value: 'legendary' }
          )
      )
      .addIntegerOption((opt) => opt.setName('page').setDescription('Page number').setMinValue(1))
  )

  // trade subcommand group
  .addSubcommandGroup((group) =>
    group
      .setName('trade')
      .setDescription('Trade NFLmon with other users')
      .addSubcommand((sub) =>
        sub
          .setName('offer')
          .setDescription('Create a trade offer')
          .addUserOption((opt) =>
            opt.setName('user').setDescription('User to trade with').setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt
              .setName('my_nflmon')
              .setDescription('Your NFLmon ID to offer')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addIntegerOption((opt) =>
            opt.setName('their_nflmon').setDescription('Their NFLmon ID you want (optional)')
          )
          .addIntegerOption((opt) =>
            opt.setName('coins').setDescription('Coins to include').setMinValue(0)
          )
      )
      .addSubcommand((sub) => sub.setName('pending').setDescription('View your pending trades'))
      .addSubcommand((sub) =>
        sub
          .setName('cancel')
          .setDescription('Cancel a trade you sent')
          .addIntegerOption((opt) =>
            opt.setName('trade_id').setDescription('Trade ID to cancel').setRequired(true)
          )
      )
  );

// =============================================================================
// MAIN EXECUTE FUNCTION
// =============================================================================

/**
 * Execute the nflmon command
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  // Handle trade subcommand group
  if (subcommandGroup === 'trade') {
    switch (subcommand) {
      case 'offer':
        await handleTradeOffer(interaction);
        return;
      case 'pending':
        await handleTradePending(interaction);
        return;
      case 'cancel':
        await handleTradeCancel(interaction);
        return;
      default:
        await interaction.reply({
          content: 'Unknown trade subcommand.',
          ephemeral: true,
        });
        return;
    }
  }

  // Handle regular subcommands
  switch (subcommand) {
    case 'bench':
      await handleBench(interaction);
      break;
    case 'view':
      await handleView(interaction);
      break;
    case 'train':
      await handleTrain(interaction);
      break;
    case 'untrain':
      await handleUntrain(interaction);
      break;
    case 'stats':
      await handleStats(interaction);
      break;
    case 'dex':
      await handleDex(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Unknown subcommand.',
        ephemeral: true,
      });
  }
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
        const currentPage = parseInt(currentPageStr);
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
        const currentPage = parseInt(parts[3]);

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
      const tradeId = parseInt(tradeIdStr);

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
