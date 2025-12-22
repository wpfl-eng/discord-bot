import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ChatInputCommandInteraction,
} from 'discord.js';
import { sql } from '@vercel/postgres';
import * as economyDb from '../../economy/economyDb.js';
import * as inventoryDb from '../../inventory/inventoryDb.js';
import { CONFIG, formatCurrency } from '../../economy/economyConfig.js';
import * as nflmonService from '../../nflmon/nflmonService.js';
import * as nflmonDb from '../../nflmon/nflmonDb.js';
import { TRAINING_CONFIG } from '../../nflmon/nflmonConfig.js';
import type { EconomyUser } from '../../types/database.js';
import type { RollResult } from '../../nflmon/nflmonService.js';

// ============================================================
// Type Definitions
// ============================================================

type ShopItemType = 'economy' | 'inventory' | 'nflmon_pack' | 'nflmon_training';

interface ShopItem {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly price: number;
  readonly description: string;
  readonly type: ShopItemType;
  readonly inventoryQuantity?: number;
  readonly quantity?: number;
}

interface ShopCategory {
  readonly name: string;
  readonly emoji: string;
  readonly items: ShopItem[];
}

interface BuyInventoryResult {
  readonly success: boolean;
  readonly user?: EconomyUser;
  readonly error?: string;
}

interface PurchaseDetails {
  bankCapacity?: number;
  quantity?: number;
  nflmonPack?: boolean;
  packResults?: RollResult[];
  packName?: string;
  trainingSlot?: boolean;
  newMax?: number;
}

// ============================================================
// Shop Configuration
// ============================================================

// Shop items organized by category
const SHOP_CATEGORIES: Record<string, ShopCategory> = {
  economy: {
    name: 'Economy Items',
    emoji: '💰',
    items: [
      {
        id: 'padlock',
        name: 'Padlock',
        emoji: '🔒',
        price: CONFIG.PADLOCK_COST,
        description: 'Protects you from one robbery attempt',
        type: 'economy',
      },
      {
        id: 'bank_expansion',
        name: 'Bank Expansion',
        emoji: '🏦',
        price: CONFIG.BANK_EXPANSION_COST,
        description: `Increases bank capacity by ${formatCurrency(CONFIG.BANK_EXPANSION_AMOUNT)}`,
        type: 'economy',
      },
    ],
  },
  nflmon: {
    name: 'NFLmon',
    emoji: '🎮',
    items: [
      {
        id: 'nflmon_starter_pack',
        name: 'Starter Pack',
        emoji: '📦',
        price: 500,
        description: '1 random NFLmon',
        type: 'nflmon_pack',
        quantity: 1,
      },
      {
        id: 'nflmon_pro_pack',
        name: 'Pro Pack',
        emoji: '📦',
        price: 1500,
        description: '3 random NFLmon',
        type: 'nflmon_pack',
        quantity: 3,
      },
      {
        id: 'nflmon_elite_pack',
        name: 'Elite Pack',
        emoji: '🎯',
        price: 5000,
        description: '5 random NFLmon (best value!)',
        type: 'nflmon_pack',
        quantity: 5,
      },
      {
        id: 'nflmon_training_slot',
        name: 'Training Slot',
        emoji: '🏋️',
        price: 3000,
        description: 'Expand training capacity (+1 slot, max 5)',
        type: 'nflmon_training',
      },
    ],
  },
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get all items as a flat array
 */
function getAllItems(): ShopItem[] {
  return Object.values(SHOP_CATEGORIES).flatMap((cat) => cat.items);
}

/**
 * Find an item by ID
 */
function findItem(itemId: string): ShopItem | null {
  return getAllItems().find((item) => item.id === itemId) ?? null;
}

/**
 * Build the shop embed
 */
function buildShopEmbed(userData: EconomyUser): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🛒 Economy Shop')
    .setDescription(
      `Your wallet: ${formatCurrency(userData.wallet)}\n\nClick a button below to purchase an item.`
    )
    .setTimestamp();

  // Add items by category
  for (const category of Object.values(SHOP_CATEGORIES)) {
    // Add category header
    embed.addFields({
      name: `${category.emoji} ${category.name}`,
      value: '─'.repeat(20),
      inline: false,
    });

    // Add items in this category
    for (const item of category.items) {
      let status = '';
      if (item.id === 'padlock' && userData.has_padlock) {
        status = ' *(Already owned)*';
      }
      embed.addFields({
        name: `${item.emoji} ${item.name} - ${formatCurrency(item.price)}`,
        value: `${item.description}${status}`,
        inline: true,
      });
    }
  }

  return embed;
}

/**
 * Build shop buttons (split into rows of 5 max)
 */
function buildShopButtons(userData: EconomyUser): ActionRowBuilder<ButtonBuilder>[] {
  const allItems = getAllItems();
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Discord allows max 5 buttons per row
  for (let i = 0; i < allItems.length; i += 5) {
    const rowItems = allItems.slice(i, i + 5);
    const buttons = rowItems.map((item) => {
      const canAfford = userData.wallet >= item.price;
      const alreadyOwned = item.id === 'padlock' && userData.has_padlock;

      return new ButtonBuilder()
        .setCustomId(`shop_${item.id}`)
        .setLabel(item.name)
        .setEmoji(item.emoji)
        .setStyle(canAfford && !alreadyOwned ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(!canAfford || alreadyOwned);
    });

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  }

  return rows;
}

/**
 * Build disabled buttons for collector end
 */
function buildDisabledButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const allItems = getAllItems();
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < allItems.length; i += 5) {
    const rowItems = allItems.slice(i, i + 5);
    const buttons = rowItems.map((item) =>
      new ButtonBuilder()
        .setCustomId(`shop_${item.id}`)
        .setLabel(item.name)
        .setEmoji(item.emoji)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  }

  return rows;
}

/**
 * Purchase an inventory item (atomic wallet deduction + inventory add with rollback)
 */
async function buyInventoryItem(
  userId: string,
  itemId: string,
  price: number,
  quantity: number
): Promise<BuyInventoryResult> {
  // Atomic wallet deduction
  const result = await sql`
    UPDATE economy_users
    SET wallet = wallet - ${price}
    WHERE user_id = ${userId}
      AND wallet >= ${price}
    RETURNING *
  `;

  if (!result.rows[0]) {
    return { success: false, error: 'INSUFFICIENT_FUNDS' };
  }

  // Add to inventory with rollback on failure
  try {
    await inventoryDb.addItem(userId, itemId, quantity);
  } catch (error) {
    // Rollback: refund the wallet
    await sql`UPDATE economy_users SET wallet = wallet + ${price} WHERE user_id = ${userId}`;
    console.error(
      `Rolled back shop purchase: Failed to add ${itemId} to inventory for ${userId}:`,
      error
    );
    return { success: false, error: 'INVENTORY_ADD_FAILED' };
  }

  return { success: true, user: result.rows[0] as EconomyUser };
}

// ============================================================
// Command Definition
// ============================================================

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('View and purchase items from the shop');

/**
 * Execute the shop command
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Get or create user
    const userData = await economyDb.getOrCreateUser(userId, username);

    // Build and send shop display
    const embed = buildShopEmbed(userData);
    const components = buildShopButtons(userData);

    const response = await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Handle button interactions
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
      filter: (i) => i.user.id === userId,
    });

    collector.on('collect', async (buttonInteraction) => {
      const itemId = buttonInteraction.customId.replace('shop_', '');
      const item = findItem(itemId);

      if (!item) {
        await buttonInteraction.reply({
          content: 'Item not found!',
          ephemeral: true,
        });
        return;
      }

      // Re-fetch user data
      const currentUser = await economyDb.getUser(userId);

      // Check if user still exists
      if (!currentUser) {
        await buttonInteraction.reply({
          content: 'User data not found!',
          ephemeral: true,
        });
        return;
      }

      // Check if they can still afford it
      if (currentUser.wallet < item.price) {
        await buttonInteraction.reply({
          content: `You no longer have enough coins to buy ${item.name}!`,
          ephemeral: true,
        });
        return;
      }

      // Check if already owned (padlock only)
      if (item.id === 'padlock' && currentUser.has_padlock) {
        await buttonInteraction.reply({
          content: 'You already have a padlock!',
          ephemeral: true,
        });
        return;
      }

      // Process purchase based on type
      let updatedUser: EconomyUser | null | undefined;
      const purchaseDetails: PurchaseDetails = {};

      if (item.type === 'economy') {
        // Economy items: direct effects
        if (item.id === 'padlock') {
          updatedUser = await economyDb.buyPadlock(userId, item.price);
        } else if (item.id === 'bank_expansion') {
          updatedUser = await economyDb.buyBankExpansion(
            userId,
            item.price,
            CONFIG.BANK_EXPANSION_AMOUNT
          );
          purchaseDetails.bankCapacity = updatedUser?.bank_capacity;
        }
      } else if (item.type === 'inventory') {
        // Inventory items: add to user inventory
        const inventoryQty = item.inventoryQuantity ?? 1;
        const result = await buyInventoryItem(userId, item.id, item.price, inventoryQty);
        if (result.success) {
          updatedUser = result.user;
          purchaseDetails.quantity = inventoryQty;
        }
      } else if (item.type === 'nflmon_pack') {
        // NFLmon pack: deduct wallet and roll NFLmon
        const packQty = item.quantity ?? 1;
        const deductResult = await sql`
          UPDATE economy_users
          SET wallet = wallet - ${item.price}
          WHERE user_id = ${userId} AND wallet >= ${item.price}
          RETURNING *
        `;
        if (deductResult.rows.length > 0) {
          try {
            const packResult = await nflmonService.rollMultipleNflmon(
              userId,
              username,
              packQty
            );
            if (packResult.success) {
              updatedUser = deductResult.rows[0] as EconomyUser;
              purchaseDetails.nflmonPack = true;
              purchaseDetails.packResults = packResult.results;
              purchaseDetails.packName = item.name;
            } else {
              // Refund on failure
              await sql`UPDATE economy_users SET wallet = wallet + ${item.price} WHERE user_id = ${userId}`;
            }
          } catch (packError: unknown) {
            // Refund on exception
            console.error('[SHOP] NFLmon pack error, refunding:', packError);
            await sql`UPDATE economy_users SET wallet = wallet + ${item.price} WHERE user_id = ${userId}`;
          }
        }
      } else if (item.type === 'nflmon_training') {
        // NFLmon training slot: use nflmonDb purchase function
        const result = await nflmonDb.purchaseTrainingSlot(userId, item.price);
        if (result.success) {
          updatedUser = await economyDb.getUser(userId);
          purchaseDetails.trainingSlot = true;
          purchaseDetails.newMax = result.newMax;
        } else if (result.error === 'MAX_SLOTS_REACHED') {
          await buttonInteraction.reply({
            content: 'You already have the maximum training slots (5)!',
            ephemeral: true,
          });
          return;
        }
      }

      // If purchase failed
      if (!updatedUser) {
        await buttonInteraction.reply({
          content: `Purchase failed - you no longer have enough coins!`,
          ephemeral: true,
        });
        return;
      }

      // Create purchase confirmation embed
      const purchaseEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Purchase Successful!')
        .setDescription(
          `You bought **${item.emoji} ${item.name}** for ${formatCurrency(item.price)}!`
        )
        .addFields({
          name: 'New Balance',
          value: formatCurrency(updatedUser.wallet),
          inline: true,
        });

      // Add type-specific fields
      if (purchaseDetails.bankCapacity) {
        purchaseEmbed.addFields({
          name: 'New Bank Capacity',
          value: formatCurrency(purchaseDetails.bankCapacity),
          inline: true,
        });
      }

      if (purchaseDetails.quantity) {
        purchaseEmbed.addFields({
          name: 'Added to Inventory',
          value: `${purchaseDetails.quantity}x ${item.name}`,
          inline: true,
        });
        purchaseEmbed.setFooter({ text: 'View your items with /inventory view' });
      }

      // NFLmon pack purchase - show pack opening results
      if (purchaseDetails.nflmonPack && purchaseDetails.packResults) {
        const packLines = purchaseDetails.packResults.map((rollResult: RollResult, i: number) => {
          const { player, rarity } = rollResult;
          const rarityName = rarity?.name ?? 'Unknown';
          return `${i + 1}. **${player.name}** (${player.position}) - ${rarityName}`;
        });
        purchaseEmbed.addFields({
          name: '🎮 NFLmon Received',
          value: packLines.join('\n'),
          inline: false,
        });
        purchaseEmbed.setFooter({ text: 'Use /nflmon bench to view your collection' });
      }

      // Training slot purchase - show new slot count
      if (purchaseDetails.trainingSlot) {
        purchaseEmbed.addFields({
          name: 'Training Slots',
          value: `You now have **${purchaseDetails.newMax}/${TRAINING_CONFIG.MAX_SLOTS}** training slots!`,
          inline: true,
        });
        purchaseEmbed.setFooter({ text: 'Use /nflmon train to assign NFLmon to training' });
      }

      await buttonInteraction.reply({ embeds: [purchaseEmbed], ephemeral: true });

      // Update the shop display
      const newUserData = await economyDb.getUser(userId);
      if (newUserData) {
        const newEmbed = buildShopEmbed(newUserData);
        const newComponents = buildShopButtons(newUserData);

        await interaction.editReply({
          embeds: [newEmbed],
          components: newComponents,
        });
      }
    });

    collector.on('end', async () => {
      // Disable all buttons when collector ends
      const disabledComponents = buildDisabledButtons();

      await interaction
        .editReply({
          components: disabledComponents,
        })
        .catch(() => {});
    });
  } catch (error: unknown) {
    console.error('shop command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
