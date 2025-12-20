import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import {
  CONFIG,
  formatCurrency,
  SLOTS_SYMBOLS,
  SLOTS_PAYOUTS,
  CHANNELS,
} from '../../economy/economyConfig.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';
import type { EconomyUser } from '../../types/database.js';
import type { SlotSymbol } from '../../economy/economyConfig.js';

// ============================================================
// Type Definitions
// ============================================================

interface PayoutResult {
  readonly multiplier: number;
  readonly resultText: string;
  readonly isBigWin?: boolean;
}

// ============================================================
// Module State
// ============================================================

// In-memory cooldown tracking (resets on bot restart - acceptable for 10s cooldown)
const slotsCooldowns: Map<string, number> = new Map();

// ============================================================
// Command Definition
// ============================================================

export const data = new SlashCommandBuilder()
  .setName('slots')
  .setDescription('Spin the football-themed slot machine!')
  .addStringOption((option) =>
    option.setName('amount').setDescription("Amount to bet (number or 'all')").setRequired(true)
  );

// ============================================================
// Helper Functions
// ============================================================

/**
 * Spin a single reel using weighted random selection
 * @returns The selected symbol
 */
function spinReel(): SlotSymbol {
  const totalWeight: number = SLOTS_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let random: number = Math.random() * totalWeight;

  for (const symbol of SLOTS_SYMBOLS) {
    random -= symbol.weight;
    if (random <= 0) return symbol;
  }
  return SLOTS_SYMBOLS[0];
}

/**
 * Calculate payout based on the three reels
 * @param reels - Array of 3 symbol objects
 * @returns Payout result with multiplier and result text
 */
function calculatePayout(reels: SlotSymbol[]): PayoutResult {
  const [r1, r2, r3] = reels;
  const emojis: string[] = reels.map((r) => r.emoji);

  // Check for three of a kind
  if (r1.emoji === r2.emoji && r2.emoji === r3.emoji) {
    const emoji: string = r1.emoji;
    if (emoji === '🎰') {
      return { multiplier: SLOTS_PAYOUTS.tripleJackpot, resultText: 'JACKPOT!!!', isBigWin: true };
    }
    if (emoji === '🏆') {
      return {
        multiplier: SLOTS_PAYOUTS.tripleTrophy,
        resultText: 'Triple Trophy!',
        isBigWin: true,
      };
    }
    if (emoji === '🥇') {
      return { multiplier: SLOTS_PAYOUTS.tripleGold, resultText: 'Triple Gold!' };
    }
    if (emoji === '⭐') {
      return { multiplier: SLOTS_PAYOUTS.tripleStar, resultText: 'Triple Star!' };
    }
    if (emoji === '🏟️') {
      return { multiplier: SLOTS_PAYOUTS.tripleStadium, resultText: 'Triple Stadium!' };
    }
    // Common symbols (football, ball, target)
    return { multiplier: SLOTS_PAYOUTS.tripleCommon, resultText: 'Triple Match!' };
  }

  // Check for two of a kind with special symbols
  const jackpotCount: number = emojis.filter((e) => e === '🎰').length;
  const trophyCount: number = emojis.filter((e) => e === '🏆').length;

  if (jackpotCount === 2 || trophyCount === 2) {
    return { multiplier: SLOTS_PAYOUTS.twoSpecial, resultText: 'Two Special!' };
  }

  // Check for any two matching
  if (r1.emoji === r2.emoji || r2.emoji === r3.emoji || r1.emoji === r3.emoji) {
    return { multiplier: SLOTS_PAYOUTS.twoMatching, resultText: 'Two Matching!' };
  }

  // No matches
  return { multiplier: 0, resultText: 'No Match' };
}

/**
 * Format the slot machine display
 * @param reels - Array of 3 symbol objects
 * @returns Formatted slot machine display
 */
function formatSlotMachine(reels: SlotSymbol[]): string {
  return `\`\`\`
┌─────┬─────┬─────┐
│  ${reels[0].emoji}  │  ${reels[1].emoji}  │  ${reels[2].emoji}  │
└─────┴─────┴─────┘
\`\`\``;
}

// ============================================================
// Command Execution
// ============================================================

/**
 * Execute the slots command
 * @param interaction - The Discord command interaction
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;
    const amountStr: string = interaction.options.getString('amount')!.toLowerCase();

    // Check cooldown
    const lastSpin: number | undefined = slotsCooldowns.get(userId);
    if (lastSpin) {
      const elapsed: number = Date.now() - lastSpin;
      const cooldownMs: number = CONFIG.SLOTS_COOLDOWN_SECONDS * 1000;
      if (elapsed < cooldownMs) {
        const remaining: number = Math.ceil((cooldownMs - elapsed) / 1000);
        await interaction.editReply({
          content: `Slow down! You can spin again in ${remaining} seconds.`,
        });
        return;
      }
    }

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    // Parse amount
    let amount: number;
    let isAllIn: boolean = false;

    if (amountStr === 'all' || amountStr === 'max') {
      amount = userData.wallet;
      isAllIn = true;
    } else {
      amount = parseInt(amountStr);
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      await interaction.editReply({
        content: "Please enter a valid amount (a positive number or 'all').",
      });
      return;
    }

    // Check min/max
    if (amount < CONFIG.SLOTS_MIN) {
      await interaction.editReply({
        content: `Minimum bet is ${formatCurrency(CONFIG.SLOTS_MIN)}.`,
      });
      return;
    }

    if (amount > CONFIG.SLOTS_MAX) {
      await interaction.editReply({
        content: `Maximum bet is ${formatCurrency(CONFIG.SLOTS_MAX)}.`,
      });
      return;
    }

    // Check if user has enough in wallet
    if (userData.wallet < amount) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🎰 Slots Failed')
        .setDescription(
          `You don't have enough coins in your wallet!\n\nYour wallet: ${formatCurrency(userData.wallet)}\nBet amount: ${formatCurrency(amount)}`
        )
        .setFooter({ text: 'Tip: Use /withdraw to get coins from your bank' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Set cooldown
    slotsCooldowns.set(userId, Date.now());

    // Spin the reels
    const reels: SlotSymbol[] = [spinReel(), spinReel(), spinReel()];
    const { multiplier, resultText, isBigWin }: PayoutResult = calculatePayout(reels);

    const allInText: string = isAllIn ? ' ALL IN!' : '';
    const slotDisplay: string = formatSlotMachine(reels);

    if (multiplier > 0) {
      // Win
      const winnings: number = amount * multiplier - amount; // Net winnings
      const updatedUser: EconomyUser | null = await economyDb.gambleWin(userId, winnings);

      // Handle null case (shouldn't happen, but be consistent with lose case)
      if (!updatedUser) {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(isBigWin ? 0xf1c40f : 0x2ecc71)
        .setTitle(`🎰 ${resultText}${allInText}`)
        .setDescription(`${slotDisplay}\nYou won ${formatCurrency(amount * multiplier)}!`)
        .addFields(
          { name: 'Bet', value: formatCurrency(amount), inline: true },
          { name: 'Multiplier', value: `${multiplier}x`, inline: true },
          { name: 'Payout', value: formatCurrency(amount * multiplier), inline: true },
          { name: 'New Balance', value: formatCurrency(updatedUser.wallet), inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Announce big wins in casino channel
      if (isBigWin && CHANNELS.CASINO) {
        try {
          const casinoChannel = await interaction.client.channels.fetch(CHANNELS.CASINO);
          if (casinoChannel && 'send' in casinoChannel) {
            const announcementEmbed = new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle(`🎰 ${resultText} 🎰`)
              .setDescription(
                `${slotDisplay}\n<@${userId}> just hit **${resultText}**!\n\nWon ${formatCurrency(amount * multiplier)} on a ${formatCurrency(amount)} bet!`
              )
              .setTimestamp();

            await casinoChannel.send({ embeds: [announcementEmbed] });
          }
        } catch (error: unknown) {
          console.error('Failed to send casino announcement:', error);
        }
      }

      // Check for achievements (non-blocking)
      checkForAchievements({
        actionType: ACTION_TYPES.SLOTS_WIN,
        userId,
        username,
        client: interaction.client,
        amount: amount * multiplier,
      }).catch((err: unknown) => console.error('Failed to check achievements:', err));
    } else {
      // Lose
      const updatedUser: EconomyUser | null = await economyDb.gambleLose(userId, amount);

      if (!updatedUser) {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
        });
        return;
      }

      const brokeText: string = updatedUser.wallet === 0 ? "\n\n💸 You're broke!" : '';

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`🎰 ${resultText}${allInText}`)
        .setDescription(`${slotDisplay}\nYou lost ${formatCurrency(amount)}!${brokeText}`)
        .addFields(
          { name: 'Bet', value: formatCurrency(amount), inline: true },
          { name: 'Lost', value: `-${formatCurrency(amount)}`, inline: true },
          { name: 'New Balance', value: formatCurrency(updatedUser.wallet), inline: true }
        )
        .setFooter({ text: 'Better luck next spin!' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Check for achievements (non-blocking)
      checkForAchievements({
        actionType: ACTION_TYPES.SLOTS_LOSE,
        userId,
        username,
        client: interaction.client,
        amount,
      }).catch((err: unknown) => console.error('Failed to check achievements:', err));
    }
  } catch (error: unknown) {
    console.error('slots command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
