import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import {
  CONFIG,
  formatCurrency,
  isCooldownOver,
  CURRENCY_EMOJI,
  CHANNELS,
} from '../../economy/economyConfig.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';

export const data = new SlashCommandBuilder()
  .setName('rob')
  .setDescription('Attempt to intercept coins from another player')
  .addUserOption((option) =>
    option.setName('target').setDescription('The player to pick off').setRequired(true)
  );

/**
 * Execute the rob command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  try {
    const attackerId = interaction.user.id;
    const attackerUsername = interaction.user.username;
    const targetUser = interaction.options.getUser('target');

    // Can't rob yourself
    if (targetUser.id === attackerId) {
      await interaction.editReply({
        content: "You can't intercept your own passes!",
      });
      return;
    }

    // Can't rob bots
    if (targetUser.bot) {
      await interaction.editReply({
        content: "You can't pick off the refs!",
      });
      return;
    }

    // Get or create both users
    const attackerData = await economyDb.getOrCreateUser(attackerId, attackerUsername);
    const targetData = await economyDb.getOrCreateUser(targetUser.id, targetUser.username);

    // Check attacker cooldown
    const robCooldownMs = CONFIG.ROB_COOLDOWN_MINUTES * 60 * 1000;
    if (!isCooldownOver(attackerData.last_rob, robCooldownMs)) {
      const nextRobTime = new Date(attackerData.last_rob).getTime() + robCooldownMs;
      const discordTimestamp = Math.floor(nextRobTime / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏈 Interception Failed')
        .setDescription(
          `You're still reviewing film from your last pick attempt!\n\nBack on the field <t:${discordTimestamp}:R>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Check if target was recently robbed
    const victimCooldownMs = CONFIG.ROB_VICTIM_COOLDOWN_MINUTES * 60 * 1000;
    if (!isCooldownOver(targetData.last_robbed_at, victimCooldownMs)) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏈 Interception Failed')
        .setDescription(
          `**${targetUser.username}** just got picked off and is protecting the ball!\n\nFind another target.`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Check if target has enough to steal
    if (targetData.wallet < CONFIG.ROB_MIN_WALLET) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏈 Interception Failed')
        .setDescription(
          `**${targetUser.username}** isn't carrying enough to be worth the risk.\n\nThey need at least ${formatCurrency(CONFIG.ROB_MIN_WALLET)} in their wallet.`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Check if attacker has enough to pay fine if they fail
    if (attackerData.wallet < CONFIG.ROB_FAIL_FINE) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏈 Interception Failed')
        .setDescription(
          `You need at least ${formatCurrency(CONFIG.ROB_FAIL_FINE)} in your wallet to attempt an interception (in case you get flagged for pass interference).`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Update attacker's last rob timestamp
    await economyDb.setLastRob(attackerId);

    // Check if target has padlock
    if (targetData.has_padlock) {
      // Padlock blocks the rob
      await economyDb.setPadlock(targetUser.id, false);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🛡️ Pass Defended!')
        .setDescription(
          `**${targetUser.username}**'s offensive line blocked your attempt!\n\nTheir protection has been used up.`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Notify the victim that their padlock saved them
      await interaction.channel.send({
        content: `🛡️ <@${targetUser.id}>'s O-line protected them from an interception attempt by **${attackerUsername}**!`,
      });
      return;
    }

    // Determine success or failure
    const isSuccess = Math.random() < CONFIG.ROB_SUCCESS_RATE;

    // Calculate next rob time for display
    const nextRobTime = Date.now() + robCooldownMs;
    const discordTimestamp = Math.floor(nextRobTime / 1000);

    if (isSuccess) {
      // Calculate stolen amount (10-30% of target's wallet)
      const stealPercent =
        CONFIG.ROB_MIN_PERCENT + Math.random() * (CONFIG.ROB_MAX_PERCENT - CONFIG.ROB_MIN_PERCENT);
      const stolenAmount = Math.floor(targetData.wallet * stealPercent);

      // Transfer money atomically
      const { from: updatedVictim, to: updatedAttacker } = await economyDb.transferBetweenUsers(
        targetUser.id,
        attackerId,
        stolenAmount
      );

      // If transfer failed (victim didn't have enough), handle gracefully
      if (!updatedVictim || !updatedAttacker) {
        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('🏈 Interception Failed')
          .setDescription(
            `**${targetUser.username}** threw the ball away just in time! Nothing to intercept.`
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Update victim's robbed timestamp
      await economyDb.setLastRobbed(targetUser.id, attackerId);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🏈 PICK SIX!')
        .setDescription(
          `You intercepted ${formatCurrency(stolenAmount)} from **${targetUser.username}** and took it to the house!`
        )
        .addFields(
          {
            name: 'Intercepted',
            value: formatCurrency(stolenAmount),
            inline: true,
          },
          {
            name: 'Your New Balance',
            value: formatCurrency(updatedAttacker.wallet),
            inline: true,
          }
        )
        .setFooter({ text: `Look for another target` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // PUBLIC ANNOUNCEMENT - Send to town-square channel
      const announcementEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🚨 TURNOVER!')
        .setDescription(
          `<@${targetUser.id}> just got picked off by **${attackerUsername}** for ${formatCurrency(stolenAmount)}!`
        )
        .setTimestamp();

      if (CHANNELS.TOWN_SQUARE) {
        try {
          const townSquare = await interaction.client.channels.fetch(CHANNELS.TOWN_SQUARE);
          if (townSquare) {
            await townSquare.send({ embeds: [announcementEmbed] });
          }
        } catch (err) {
          console.error('Failed to send robbery announcement to town-square:', err);
        }
      }

      // Check for achievements (non-blocking)
      checkForAchievements({
        actionType: ACTION_TYPES.ROB_SUCCESS,
        userId: attackerId,
        username: attackerUsername,
        client: interaction.client,
        amount: stolenAmount,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
      }).catch((err) => console.error('Failed to check achievements:', err));
    } else {
      // Failed - pay fine using atomic operation
      const updatedAttacker = await economyDb.payRobFine(attackerId, CONFIG.ROB_FAIL_FINE);

      // If they couldn't pay the fine (shouldn't happen due to check above)
      if (!updatedAttacker) {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🚩 Pass Interference!')
        .setDescription(
          `You got flagged trying to pick off **${targetUser.username}**!\n\nYou paid a ${formatCurrency(CONFIG.ROB_FAIL_FINE)} penalty.`
        )
        .addFields(
          {
            name: 'Penalty',
            value: formatCurrency(CONFIG.ROB_FAIL_FINE),
            inline: true,
          },
          {
            name: 'Your New Balance',
            value: formatCurrency(updatedAttacker.wallet),
            inline: true,
          }
        )
        .setFooter({ text: 'The refs saw everything!' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Check for achievements (non-blocking)
      checkForAchievements({
        actionType: ACTION_TYPES.ROB_FAIL,
        userId: attackerId,
        username: attackerUsername,
        client: interaction.client,
        amount: CONFIG.ROB_FAIL_FINE,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
      }).catch((err) => console.error('Failed to check achievements:', err));
    }
  } catch (error) {
    console.error('rob command error:', error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
