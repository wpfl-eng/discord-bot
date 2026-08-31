import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ChatInputCommandInteraction,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { CONFIG, formatCurrency } from '../../economy/economyConfig.js';
import type { EconomyUser } from '../../types/database.js';

// ============================================================
// Type Definitions
// ============================================================

type ShopItemType = 'economy';

interface ShopItem {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly price: number;
  readonly description: string;
  readonly type: ShopItemType;
}

interface ShopCategory {
  readonly name: string;
  readonly emoji: string;
  readonly items: ShopItem[];
}

interface PurchaseDetails {
  bankCapacity?: number;
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
        id: 'bank_expansion',
        name: 'Bank Expansion',
        emoji: '🏦',
        price: CONFIG.BANK_EXPANSION_COST,
        description: `Increases bank capacity by ${formatCurrency(CONFIG.BANK_EXPANSION_AMOUNT)}`,
        type: 'economy',
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
      embed.addFields({
        name: `${item.emoji} ${item.name} - ${formatCurrency(item.price)}`,
        value: item.description,
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

      return new ButtonBuilder()
        .setCustomId(`shop_${item.id}`)
        .setLabel(item.name)
        .setEmoji(item.emoji)
        .setStyle(canAfford ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(!canAfford);
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

      // Process purchase based on type
      let updatedUser: EconomyUser | null | undefined;
      const purchaseDetails: PurchaseDetails = {};

      if (item.type === 'economy') {
        // Economy items: direct effects
        if (item.id === 'bank_expansion') {
          updatedUser = await economyDb.buyBankExpansion(
            userId,
            item.price,
            CONFIG.BANK_EXPANSION_AMOUNT
          );
          purchaseDetails.bankCapacity = updatedUser?.bank_capacity;
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
