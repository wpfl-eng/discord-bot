import cron from 'node-cron';
import { Client, EmbedBuilder, DiscordAPIError } from 'discord.js';
import * as trainingDb from './trainingDb.js';

// ============ Type Definitions ============

/**
 * User notification data from training database
 */
export interface UserNotification {
  readonly user_id: string;
  readonly username: string;
  readonly ready_count: number;
}

// ============ Service Class ============

/**
 * Background service for sending training notifications
 * Follows the same pattern as TriviaService
 */
export class TrainingNotificationService {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Initialize the notification scheduler
   */
  init(): void {
    // Check every 2 minutes
    cron.schedule('*/2 * * * *', () => this.checkReadyPlayers());
    console.log('[TRAINING] Notification service initialized (every 2 min)');
  }

  /**
   * Check for users with ready players and send notifications
   */
  async checkReadyPlayers(): Promise<void> {
    try {
      const dbUsers = await trainingDb.getUsersNeedingNotification();

      // Convert ready_count from string (PostgreSQL COUNT) to number
      for (const dbUser of dbUsers) {
        const user: UserNotification = {
          user_id: dbUser.user_id,
          username: dbUser.username,
          ready_count: parseInt(dbUser.ready_count, 10) || 0,
        };
        await this.notifyUser(user);
      }

      if (dbUsers.length > 0) {
        console.log(`[TRAINING] Sent ${dbUsers.length} notification(s)`);
      }
    } catch (error) {
      console.error('[TRAINING] Notification check error:', error);
    }
  }

  /**
   * Send a DM notification to a user
   * @param user - User notification data
   */
  async notifyUser(user: UserNotification): Promise<void> {
    try {
      const discordUser = await this.client.users.fetch(user.user_id);
      await discordUser.send({
        embeds: [this.buildNotificationEmbed(user.ready_count)],
      });
      await trainingDb.updateLastNotified(user.user_id);
    } catch (error) {
      // Type guard for Discord API errors
      if (error instanceof DiscordAPIError) {
        if (error.code === 50007) {
          // Cannot send messages to this user (DMs disabled)
          console.log(`[TRAINING] User ${user.user_id} has DMs disabled`);
        } else if (error.code === 10013) {
          // Unknown User - user left server or deleted account
          console.log(`[TRAINING] Unknown user ${user.user_id}`);
        } else {
          console.error(`[TRAINING] Failed to notify ${user.user_id}:`, error);
        }
      } else {
        console.error(`[TRAINING] Failed to notify ${user.user_id}:`, error);
      }
    }
  }

  /**
   * Build the notification embed
   * @param readyCount - Number of ready players
   * @returns Notification embed
   */
  buildNotificationEmbed(readyCount: number): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('⭐ Rookies Ready to Graduate!')
      .setDescription(
        `You have **${readyCount}** player${readyCount > 1 ? 's' : ''} ready to graduate!\n\n` +
          `Use \`/train manage\` to graduate them before they bust!`
      )
      .setFooter({ text: 'Disable these notifications with /train settings' })
      .setTimestamp();
  }
}
