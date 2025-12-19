import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import { sql } from "@vercel/postgres";
import * as economyDb from "../../economy/economyDb.js";
import * as inventoryDb from "../../inventory/inventoryDb.js";
import { CONFIG, formatCurrency } from "../../economy/economyConfig.js";

// Shop items organized by category
const SHOP_CATEGORIES = {
  economy: {
    name: "Economy Items",
    emoji: "💰",
    items: [
      {
        id: "padlock",
        name: "Padlock",
        emoji: "🔒",
        price: CONFIG.PADLOCK_COST,
        description: "Protects you from one robbery attempt",
        type: "economy",
      },
      {
        id: "bank_expansion",
        name: "Bank Expansion",
        emoji: "🏦",
        price: CONFIG.BANK_EXPANSION_COST,
        description: `Increases bank capacity by ${formatCurrency(CONFIG.BANK_EXPANSION_AMOUNT)}`,
        type: "economy",
      },
    ],
  },
  training: {
    name: "Training Items",
    emoji: "🏟️",
    items: [
      {
        id: "contract_te",
        name: "TE Contract",
        emoji: "📜",
        price: 50,
        description: "Draft a Tight End rookie",
        type: "inventory",
        inventoryQuantity: 1,
      },
      {
        id: "contract_rb",
        name: "RB Contract",
        emoji: "📜",
        price: 100,
        description: "Draft a Running Back rookie",
        type: "inventory",
        inventoryQuantity: 1,
      },
      {
        id: "contract_wr",
        name: "WR Contract",
        emoji: "📜",
        price: 150,
        description: "Draft a Wide Receiver rookie",
        type: "inventory",
        inventoryQuantity: 1,
      },
      {
        id: "contract_qb",
        name: "QB Contract",
        emoji: "📜",
        price: 250,
        description: "Draft a Quarterback rookie",
        type: "inventory",
        inventoryQuantity: 1,
      },
      {
        id: "tool_setup_kit",
        name: "Setup Kit",
        emoji: "🔧",
        price: 500,
        description: "50 uses - Prepares training slots",
        type: "inventory",
        inventoryQuantity: 50,
      },
      {
        id: "tool_water_cooler",
        name: "Water Cooler",
        emoji: "💧",
        price: 300,
        description: "30 uses - Hydrates prepared slots",
        type: "inventory",
        inventoryQuantity: 30,
      },
    ],
  },
};

/**
 * Get all items as a flat array
 * @returns {array}
 */
function getAllItems() {
  return Object.values(SHOP_CATEGORIES).flatMap((cat) => cat.items);
}

/**
 * Find an item by ID
 * @param {string} itemId
 * @returns {object|null}
 */
function findItem(itemId) {
  return getAllItems().find((item) => item.id === itemId) || null;
}

/**
 * Build the shop embed
 * @param {object} userData
 * @returns {EmbedBuilder}
 */
function buildShopEmbed(userData) {
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🛒 Economy Shop")
    .setDescription(
      `Your wallet: ${formatCurrency(userData.wallet)}\n\nClick a button below to purchase an item.`
    )
    .setTimestamp();

  // Add items by category
  for (const category of Object.values(SHOP_CATEGORIES)) {
    // Add category header
    embed.addFields({
      name: `${category.emoji} ${category.name}`,
      value: "─".repeat(20),
      inline: false,
    });

    // Add items in this category
    for (const item of category.items) {
      let status = "";
      if (item.id === "padlock" && userData.has_padlock) {
        status = " *(Already owned)*";
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
 * @param {object} userData
 * @returns {ActionRowBuilder[]}
 */
function buildShopButtons(userData) {
  const allItems = getAllItems();
  const rows = [];

  // Discord allows max 5 buttons per row
  for (let i = 0; i < allItems.length; i += 5) {
    const rowItems = allItems.slice(i, i + 5);
    const buttons = rowItems.map((item) => {
      const canAfford = userData.wallet >= item.price;
      const alreadyOwned = item.id === "padlock" && userData.has_padlock;

      return new ButtonBuilder()
        .setCustomId(`shop_${item.id}`)
        .setLabel(item.name)
        .setEmoji(item.emoji)
        .setStyle(canAfford && !alreadyOwned ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(!canAfford || alreadyOwned);
    });

    rows.push(new ActionRowBuilder().addComponents(buttons));
  }

  return rows;
}

/**
 * Build disabled buttons for collector end
 * @returns {ActionRowBuilder[]}
 */
function buildDisabledButtons() {
  const allItems = getAllItems();
  const rows = [];

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

    rows.push(new ActionRowBuilder().addComponents(buttons));
  }

  return rows;
}

/**
 * Purchase an inventory item (atomic wallet deduction + inventory add with rollback)
 * @param {string} userId
 * @param {string} itemId
 * @param {number} price
 * @param {number} quantity
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
async function buyInventoryItem(userId, itemId, price, quantity) {
  // Atomic wallet deduction
  const result = await sql`
    UPDATE economy_users
    SET wallet = wallet - ${price}
    WHERE user_id = ${userId}
      AND wallet >= ${price}
    RETURNING *
  `;

  if (!result.rows[0]) {
    return { success: false, error: "INSUFFICIENT_FUNDS" };
  }

  // Add to inventory with rollback on failure
  try {
    await inventoryDb.addItem(userId, itemId, quantity);
  } catch (error) {
    // Rollback: refund the wallet
    await sql`UPDATE economy_users SET wallet = wallet + ${price} WHERE user_id = ${userId}`;
    console.error(`Rolled back shop purchase: Failed to add ${itemId} to inventory for ${userId}:`, error);
    return { success: false, error: "INVENTORY_ADD_FAILED" };
  }

  return { success: true, user: result.rows[0] };
}

export const data = new SlashCommandBuilder()
  .setName("shop")
  .setDescription("View and purchase items from the shop");

/**
 * Execute the shop command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
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

    collector.on("collect", async (buttonInteraction) => {
      const itemId = buttonInteraction.customId.replace("shop_", "");
      const item = findItem(itemId);

      if (!item) {
        await buttonInteraction.reply({
          content: "Item not found!",
          ephemeral: true,
        });
        return;
      }

      // Re-fetch user data
      const currentUser = await economyDb.getUser(userId);

      // Check if they can still afford it
      if (currentUser.wallet < item.price) {
        await buttonInteraction.reply({
          content: `You no longer have enough coins to buy ${item.name}!`,
          ephemeral: true,
        });
        return;
      }

      // Check if already owned (padlock only)
      if (item.id === "padlock" && currentUser.has_padlock) {
        await buttonInteraction.reply({
          content: "You already have a padlock!",
          ephemeral: true,
        });
        return;
      }

      // Process purchase based on type
      let updatedUser;
      let purchaseDetails = {};

      if (item.type === "economy") {
        // Economy items: direct effects
        if (item.id === "padlock") {
          updatedUser = await economyDb.buyPadlock(userId, item.price);
        } else if (item.id === "bank_expansion") {
          updatedUser = await economyDb.buyBankExpansion(userId, item.price, CONFIG.BANK_EXPANSION_AMOUNT);
          purchaseDetails.bankCapacity = updatedUser?.bank_capacity;
        }
      } else if (item.type === "inventory") {
        // Inventory items: add to user inventory
        const result = await buyInventoryItem(userId, item.id, item.price, item.inventoryQuantity);
        if (result.success) {
          updatedUser = result.user;
          purchaseDetails.quantity = item.inventoryQuantity;
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
        .setTitle("✅ Purchase Successful!")
        .setDescription(
          `You bought **${item.emoji} ${item.name}** for ${formatCurrency(item.price)}!`
        )
        .addFields({
          name: "New Balance",
          value: formatCurrency(updatedUser.wallet),
          inline: true,
        });

      // Add type-specific fields
      if (purchaseDetails.bankCapacity) {
        purchaseEmbed.addFields({
          name: "New Bank Capacity",
          value: formatCurrency(purchaseDetails.bankCapacity),
          inline: true,
        });
      }

      if (purchaseDetails.quantity) {
        purchaseEmbed.addFields({
          name: "Added to Inventory",
          value: `${purchaseDetails.quantity}x ${item.name}`,
          inline: true,
        });
        purchaseEmbed.setFooter({ text: "View your items with /inventory view" });
      }

      await buttonInteraction.reply({ embeds: [purchaseEmbed], ephemeral: true });

      // Update the shop display
      const newUserData = await economyDb.getUser(userId);
      const newEmbed = buildShopEmbed(newUserData);
      const newComponents = buildShopButtons(newUserData);

      await interaction.editReply({
        embeds: [newEmbed],
        components: newComponents,
      });
    });

    collector.on("end", async () => {
      // Disable all buttons when collector ends
      const disabledComponents = buildDisabledButtons();

      await interaction.editReply({
        components: disabledComponents,
      }).catch(() => {});
    });
  } catch (error) {
    console.error("shop command error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
