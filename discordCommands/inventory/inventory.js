import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import * as inventoryDb from '../../inventory/inventoryDb.js';
import * as economyDb from '../../economy/economyDb.js';
import { ITEM_CATEGORIES, getItemDefinition } from '../../inventory/inventoryConfig.js';
import { formatCurrency } from '../../economy/economyConfig.js';

/**
 * Build the inventory embed (shared between view and refresh)
 * @param {string} username - User's display name
 * @param {array} inventory - Array of inventory items
 * @returns {{embed: EmbedBuilder, sellableItems: array}}
 */
function buildInventoryEmbed(username, inventory) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📦 ${username}'s Inventory`)
    .setTimestamp();

  if (inventory.length === 0) {
    embed.setDescription(
      'Your inventory is empty!\n\nYou can get items from the `/shop` or by training rookies.'
    );
    return { embed, sellableItems: [] };
  }

  // Group items by category
  const itemsByCategory = {};

  for (const item of inventory) {
    const def = getItemDefinition(item.item_type);
    if (!def) continue;

    const category = def.category;
    if (!itemsByCategory[category]) {
      itemsByCategory[category] = [];
    }

    const valueText =
      def.sellable && item.item_value ? ` (${formatCurrency(item.item_value)} each)` : '';

    itemsByCategory[category].push(
      `${def.emoji} **${def.displayName}** x${item.quantity}${valueText}`
    );
  }

  // Sort categories by order and add fields
  const sortedCategories = Object.keys(itemsByCategory).sort((a, b) => {
    const orderA = ITEM_CATEGORIES[a]?.order || 99;
    const orderB = ITEM_CATEGORIES[b]?.order || 99;
    return orderA - orderB;
  });

  for (const category of sortedCategories) {
    const categoryInfo = ITEM_CATEGORIES[category];
    const categoryName = categoryInfo
      ? `${categoryInfo.emoji} ${categoryInfo.displayName}`
      : category;

    embed.addFields({
      name: categoryName,
      value: itemsByCategory[category].join('\n'),
      inline: false,
    });
  }

  // Get sellable items for buttons
  const sellableItems = inventory.filter((item) => {
    const def = getItemDefinition(item.item_type);
    return def && def.sellable && item.quantity > 0;
  });

  if (sellableItems.length > 0) {
    embed.setFooter({
      text: `💰 Use /inventory sell to sell items for coins`,
    });
  }

  return { embed, sellableItems };
}

/**
 * Build sell buttons for sellable items
 * @param {array} sellableItems - Array of sellable inventory items
 * @returns {array} - Array of ActionRowBuilder components
 */
function buildSellButtons(sellableItems) {
  if (sellableItems.length === 0) return [];

  const buttons = sellableItems.slice(0, 5).map((item) => {
    const def = getItemDefinition(item.item_type);
    return new ButtonBuilder()
      .setCustomId(`inv_sell_${item.item_type}`)
      .setLabel(`Sell ${def.displayName}`)
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success);
  });

  return [new ActionRowBuilder().addComponents(buttons)];
}

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('View and manage your inventory')
  .addSubcommand((subcommand) => subcommand.setName('view').setDescription('View your inventory'))
  .addSubcommand((subcommand) =>
    subcommand
      .setName('sell')
      .setDescription('Sell items from your inventory')
      .addStringOption((option) =>
        option
          .setName('item')
          .setDescription('Item to sell')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option.setName('quantity').setDescription('Quantity to sell (default: 1)').setMinValue(1)
      )
  );

/**
 * Execute the inventory command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'view') {
    await handleView(interaction);
  } else if (subcommand === 'sell') {
    await handleSell(interaction);
  }
}

/**
 * Handle /inventory view subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleView(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Ensure user exists in economy system
    await economyDb.getOrCreateUser(userId, username);

    // Get inventory and build display
    const inventory = await inventoryDb.getInventory(userId);
    const { embed, sellableItems } = buildInventoryEmbed(username, inventory);
    const components = buildSellButtons(sellableItems);

    const response = await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Handle button interactions
    if (components.length > 0) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i) => i.user.id === userId,
      });

      collector.on('collect', async (buttonInteraction) => {
        const itemType = buttonInteraction.customId.replace('inv_sell_', '');

        // Sell 1 of the item
        const result = await inventoryDb.sellItem(userId, itemType, 1);

        if (!result.success) {
          const errorMessages = {
            NOT_SELLABLE: 'This item cannot be sold!',
            INSUFFICIENT_QUANTITY: "You don't have any of this item to sell!",
            REMOVE_FAILED: 'Failed to remove item from inventory.',
            WALLET_UPDATE_FAILED: 'Failed to add coins to your wallet.',
          };

          await buttonInteraction.reply({
            content: errorMessages[result.error] || 'Sale failed!',
            ephemeral: true,
          });
          return;
        }

        const def = getItemDefinition(itemType);

        // Create success embed
        const saleEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('💰 Sale Successful!')
          .setDescription(
            `Sold **1x ${def.emoji} ${def.displayName}** for ${formatCurrency(result.earnings)}!`
          )
          .addFields({
            name: 'New Balance',
            value: formatCurrency(result.newBalance),
            inline: true,
          });

        await buttonInteraction.reply({ embeds: [saleEmbed], ephemeral: true });

        // Refresh the inventory display with fresh data
        const newInventory = await inventoryDb.getInventory(userId);
        const { embed: newEmbed, sellableItems: newSellable } = buildInventoryEmbed(
          username,
          newInventory
        );
        const newComponents = buildSellButtons(newSellable);
        await interaction
          .editReply({ embeds: [newEmbed], components: newComponents })
          .catch(() => {});
      });

      collector.on('end', async () => {
        // Remove all buttons when collector ends (avoids stale button issues)
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    }
  } catch (error) {
    console.error('inventory view error:', error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /inventory sell subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSell(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const itemType = interaction.options.getString('item');
    const quantity = interaction.options.getInteger('quantity') || 1;

    // Ensure user exists
    await economyDb.getOrCreateUser(userId, username);

    // Validate item type
    const def = getItemDefinition(itemType);
    if (!def) {
      await interaction.editReply({
        content: `Unknown item type: \`${itemType}\`. Use autocomplete to select a valid item.`,
      });
      return;
    }

    if (!def.sellable) {
      await interaction.editReply({
        content: `${def.emoji} **${def.displayName}** cannot be sold!`,
      });
      return;
    }

    // Check current quantity
    const currentQuantity = await inventoryDb.getItemQuantity(userId, itemType);
    if (currentQuantity < quantity) {
      await interaction.editReply({
        content: `You only have **${currentQuantity}x ${def.emoji} ${def.displayName}**. Cannot sell ${quantity}.`,
      });
      return;
    }

    // Perform sale
    const result = await inventoryDb.sellItem(userId, itemType, quantity);

    if (!result.success) {
      const errorMessages = {
        NOT_SELLABLE: 'This item cannot be sold!',
        INSUFFICIENT_QUANTITY: "You don't have enough of this item!",
        REMOVE_FAILED: 'Failed to remove item from inventory.',
        WALLET_UPDATE_FAILED: 'Failed to add coins to your wallet.',
        INVALID_QUANTITY: 'Invalid quantity specified.',
      };

      await interaction.editReply({
        content: errorMessages[result.error] || 'Sale failed!',
      });
      return;
    }

    // Success embed
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('💰 Sale Successful!')
      .setDescription(
        `Sold **${quantity}x ${def.emoji} ${def.displayName}** for ${formatCurrency(result.earnings)}!`
      )
      .addFields(
        {
          name: 'Price per Item',
          value: formatCurrency(result.earnings / quantity),
          inline: true,
        },
        {
          name: 'Total Earned',
          value: formatCurrency(result.earnings),
          inline: true,
        },
        {
          name: 'New Balance',
          value: formatCurrency(result.newBalance),
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('inventory sell error:', error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Autocomplete handler for item selection
 * @param {import('discord.js').AutocompleteInteraction} interaction
 */
export async function autocomplete(interaction) {
  try {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'item') {
      const userId = interaction.user.id;
      const searchValue = focusedOption.value.toLowerCase();

      // Get user's inventory
      const inventory = await inventoryDb.getInventory(userId);

      // Filter to sellable items and match search
      const choices = inventory
        .filter((item) => {
          const def = getItemDefinition(item.item_type);
          if (!def || !def.sellable) return false;

          // Match against display name or item type
          const matchesName = def.displayName.toLowerCase().includes(searchValue);
          const matchesType = item.item_type.toLowerCase().includes(searchValue);
          return matchesName || matchesType;
        })
        .map((item) => {
          const def = getItemDefinition(item.item_type);
          const value = item.item_value || def.baseValue;
          return {
            name: `${def.emoji} ${def.displayName} x${item.quantity} (${formatCurrency(value)} each)`,
            value: item.item_type,
          };
        })
        .slice(0, 25); // Discord limit

      await interaction.respond(choices);
    }
  } catch (error) {
    console.error('inventory autocomplete error:', error);
    await interaction.respond([]);
  }
}
