import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import * as economyDb from "../../economy/economyDb.js";
import { CONFIG, formatCurrency, CURRENCY_EMOJI } from "../../economy/economyConfig.js";

// Shop items definition
const SHOP_ITEMS = [
  {
    id: "padlock",
    name: "Padlock",
    emoji: "🔒",
    price: CONFIG.PADLOCK_COST,
    description: "Protects you from one robbery attempt",
  },
  {
    id: "bank_expansion",
    name: "Bank Expansion",
    emoji: "🏦",
    price: CONFIG.BANK_EXPANSION_COST,
    description: `Increases bank capacity by ${formatCurrency(CONFIG.BANK_EXPANSION_AMOUNT)}`,
  },
];

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

    // Build shop embed
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🛒 Economy Shop")
      .setDescription(
        `Your wallet: ${formatCurrency(userData.wallet)}\n\nClick a button below to purchase an item.`
      )
      .setTimestamp();

    // Add shop items as fields
    for (const item of SHOP_ITEMS) {
      let status = "";
      if (item.id === "padlock" && userData.has_padlock) {
        status = " *(Already owned)*";
      }
      embed.addFields({
        name: `${item.emoji} ${item.name} - ${formatCurrency(item.price)}`,
        value: `${item.description}${status}`,
        inline: false,
      });
    }

    // Build buttons
    const buttons = SHOP_ITEMS.map((item) => {
      const canAfford = userData.wallet >= item.price;
      const alreadyOwned = item.id === "padlock" && userData.has_padlock;

      return new ButtonBuilder()
        .setCustomId(`shop_${item.id}`)
        .setLabel(`Buy ${item.name}`)
        .setEmoji(item.emoji)
        .setStyle(canAfford && !alreadyOwned ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(!canAfford || alreadyOwned);
    });

    const row = new ActionRowBuilder().addComponents(buttons);

    const response = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // Handle button interactions
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000, // 60 seconds
      filter: (i) => i.user.id === userId,
    });

    collector.on("collect", async (buttonInteraction) => {
      const itemId = buttonInteraction.customId.replace("shop_", "");
      const item = SHOP_ITEMS.find((i) => i.id === itemId);

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

      // Check if already owned (padlock)
      if (item.id === "padlock" && currentUser.has_padlock) {
        await buttonInteraction.reply({
          content: "You already have a padlock!",
          ephemeral: true,
        });
        return;
      }

      // Process purchase atomically
      let updatedUser;
      if (item.id === "padlock") {
        updatedUser = await economyDb.buyPadlock(userId, item.price);
      } else if (item.id === "bank_expansion") {
        updatedUser = await economyDb.buyBankExpansion(userId, item.price, CONFIG.BANK_EXPANSION_AMOUNT);
      }

      // If purchase failed (race condition - wallet changed)
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

      if (item.id === "bank_expansion") {
        purchaseEmbed.addFields({
          name: "New Bank Capacity",
          value: formatCurrency(updatedUser.bank_capacity),
          inline: true,
        });
      }

      await buttonInteraction.reply({ embeds: [purchaseEmbed], ephemeral: true });

      // Update the shop display
      const newUserData = await economyDb.getUser(userId);

      const newEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🛒 Economy Shop")
        .setDescription(
          `Your wallet: ${formatCurrency(newUserData.wallet)}\n\nClick a button below to purchase an item.`
        )
        .setTimestamp();

      for (const shopItem of SHOP_ITEMS) {
        let status = "";
        if (shopItem.id === "padlock" && newUserData.has_padlock) {
          status = " *(Already owned)*";
        }
        newEmbed.addFields({
          name: `${shopItem.emoji} ${shopItem.name} - ${formatCurrency(shopItem.price)}`,
          value: `${shopItem.description}${status}`,
          inline: false,
        });
      }

      // Update buttons
      const newButtons = SHOP_ITEMS.map((shopItem) => {
        const canAfford = newUserData.wallet >= shopItem.price;
        const alreadyOwned = shopItem.id === "padlock" && newUserData.has_padlock;

        return new ButtonBuilder()
          .setCustomId(`shop_${shopItem.id}`)
          .setLabel(`Buy ${shopItem.name}`)
          .setEmoji(shopItem.emoji)
          .setStyle(canAfford && !alreadyOwned ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(!canAfford || alreadyOwned);
      });

      const newRow = new ActionRowBuilder().addComponents(newButtons);

      await interaction.editReply({
        embeds: [newEmbed],
        components: [newRow],
      });
    });

    collector.on("end", async () => {
      // Disable all buttons when collector ends
      const disabledButtons = SHOP_ITEMS.map((item) =>
        new ButtonBuilder()
          .setCustomId(`shop_${item.id}`)
          .setLabel(`Buy ${item.name}`)
          .setEmoji(item.emoji)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      const disabledRow = new ActionRowBuilder().addComponents(disabledButtons);

      await interaction.editReply({
        components: [disabledRow],
      }).catch(() => {}); // Ignore errors if message was deleted
    });
  } catch (error) {
    console.error("shop command error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
