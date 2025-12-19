import cron from "node-cron";
import { EmbedBuilder } from "discord.js";
import * as trainingDb from "./trainingDb.js";

/**
 * Background service for sending training notifications
 * Follows the same pattern as TriviaService
 */
export class TrainingNotificationService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Initialize the notification scheduler
   */
  init() {
    // Check every 2 minutes
    cron.schedule("*/2 * * * *", () => this.checkReadyPlayers());
    console.log("[TRAINING] Notification service initialized (every 2 min)");
  }

  /**
   * Check for users with ready players and send notifications
   */
  async checkReadyPlayers() {
    try {
      const users = await trainingDb.getUsersNeedingNotification();

      for (const user of users) {
        await this.notifyUser(user);
      }

      if (users.length > 0) {
        console.log(`[TRAINING] Sent ${users.length} notification(s)`);
      }
    } catch (error) {
      console.error("[TRAINING] Notification check error:", error);
    }
  }

  /**
   * Send a DM notification to a user
   * @param {object} user - { user_id, username, ready_count }
   */
  async notifyUser(user) {
    try {
      const discordUser = await this.client.users.fetch(user.user_id);
      await discordUser.send({
        embeds: [this.buildNotificationEmbed(user.ready_count)],
      });
      await trainingDb.updateLastNotified(user.user_id);
    } catch (error) {
      if (error.code === 50007) {
        // Cannot send messages to this user (DMs disabled)
        console.log(`[TRAINING] User ${user.user_id} has DMs disabled`);
      } else if (error.code === 10013) {
        // Unknown User - user left server or deleted account
        console.log(`[TRAINING] Unknown user ${user.user_id}`);
      } else {
        console.error(`[TRAINING] Failed to notify ${user.user_id}:`, error);
      }
    }
  }

  /**
   * Build the notification embed
   * @param {number} readyCount - Number of ready players
   * @returns {EmbedBuilder}
   */
  buildNotificationEmbed(readyCount) {
    return new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("⭐ Rookies Ready to Graduate!")
      .setDescription(
        `You have **${readyCount}** player${readyCount > 1 ? "s" : ""} ready to graduate!\n\n` +
          `Use \`/train manage\` to graduate them before they bust!`
      )
      .setFooter({ text: "Disable these notifications with /train settings" })
      .setTimestamp();
  }
}
