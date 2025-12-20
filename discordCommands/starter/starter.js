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
import { generateIVs, getRarityById } from "../../nflmon/nflmonConfig.js";

export const data = new SlashCommandBuilder()
  .setName("starter")
  .setDescription("Choose your first NFLmon! (One-time only)");

/**
 * Build embed showing 5 starter choices
 * @param {object[]} players - Array of 5 common players
 * @returns {EmbedBuilder}
 */
function buildStarterEmbed(players) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Choose Your Starter NFLmon!")
    .setDescription(
      "Welcome, Trainer! Select one of these 5 players to begin your NFLmon journey.\n\n" +
        "**Click a button below to make your choice.**"
    );

  players.forEach((player, index) => {
    embed.addFields({
      name: `${index + 1}. ${player.name}`,
      value: `**${player.team}** | ${player.position} | #${player.number}`,
      inline: true,
    });
  });

  embed.setFooter({ text: "This choice is permanent - choose wisely!" });
  return embed;
}

/**
 * Build selection buttons for 5 players
 * @returns {ActionRowBuilder}
 */
function buildStarterButtons() {
  const row = new ActionRowBuilder();

  for (let i = 0; i < 5; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`starter_select_${i}`)
        .setLabel(`${i + 1}`)
        .setStyle(ButtonStyle.Primary)
    );
  }

  return row;
}

/**
 * Build success embed after selection
 * @param {object} player - Selected player
 * @param {object} nflmon - Created NFLmon record
 * @returns {EmbedBuilder}
 */
function buildSuccessEmbed(player, nflmon) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Congratulations!")
    .setThumbnail(player.imageUrl)
    .setDescription(
      `You chose **${player.name}** as your starter NFLmon!\n\n` +
        `**Team:** ${player.team}\n` +
        `**Position:** ${player.position}\n` +
        `**Rarity:** Common\n\n` +
        `Use \`/nflmon view ${nflmon.id}\` to see your new NFLmon's stats!`
    )
    .setFooter({ text: "Good luck on your NFLmon journey!" });
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const username = interaction.user.username;

  // Check if user already claimed starter
  const hasClaimed = await nflmonDb.hasClaimedStarter(userId);
  if (hasClaimed) {
    await interaction.editReply({
      content: "You've already claimed your starter NFLmon! Use `/nflmon bench` to view your collection.",
    });
    return;
  }

  // Get 5 random common players
  const players = nflmonService.getRandomCommonPlayers(5);
  if (players.length < 5) {
    await interaction.editReply({
      content: "Error: Not enough common players available. Please contact an admin.",
    });
    return;
  }

  // Build and send selection UI
  const embed = buildStarterEmbed(players);
  const buttons = buildStarterButtons();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });

  // Create button collector
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000, // 1 minute to choose
    filter: (i) => i.user.id === userId,
  });

  collector.on("collect", async (buttonInteraction) => {
    // Parse selection index
    const index = parseInt(buttonInteraction.customId.split("_")[2]);
    const selectedPlayer = players[index];

    if (!selectedPlayer) {
      await buttonInteraction.update({
        content: "Error: Invalid selection.",
        embeds: [],
        components: [],
      });
      collector.stop();
      return;
    }

    // Double-check they haven't claimed in the meantime (race condition prevention)
    const stillUnclaimed = !(await nflmonDb.hasClaimedStarter(userId));
    if (!stillUnclaimed) {
      await buttonInteraction.update({
        content: "You've already claimed your starter NFLmon!",
        embeds: [],
        components: [],
      });
      collector.stop();
      return;
    }

    // Create the NFLmon
    const ivs = generateIVs();
    const nflmon = await nflmonDb.addNflmon({
      userId,
      playerId: selectedPlayer.id,
      rarity: "common",
      ivs,
      acquiredSource: "starter",
    });

    if (!nflmon) {
      await buttonInteraction.update({
        content: "Error creating NFLmon. Please try again or contact an admin.",
        embeds: [],
        components: [],
      });
      collector.stop();
      return;
    }

    // Mark starter as claimed
    await nflmonDb.markStarterClaimed(userId);

    // Ensure stats are initialized with username
    await nflmonDb.getOrCreateStats(userId, username);

    console.log(`[STARTER] ${username} chose ${selectedPlayer.name} as their starter`);

    // Show success
    const successEmbed = buildSuccessEmbed(selectedPlayer, nflmon);
    await buttonInteraction.update({
      embeds: [successEmbed],
      components: [],
    });

    collector.stop();
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time" && collected.size === 0) {
      // Timed out without selection
      await interaction.editReply({
        content: "Selection timed out. Run `/starter` again when you're ready to choose.",
        embeds: [],
        components: [],
      }).catch(() => {});
    }
  });
}
