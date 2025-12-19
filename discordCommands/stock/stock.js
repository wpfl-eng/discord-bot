import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import * as economyDb from "../../economy/economyDb.js";
import * as stockDb from "../../stock/stockDb.js";
import * as stockApi from "../../stock/stockApi.js";
import { formatCurrency } from "../../economy/economyConfig.js";
import { STOCK_CONFIG, STOCK_MESSAGES, formatShares, formatPrice } from "../../stock/stockConfig.js";
import { checkForAchievements } from "../../achievements/achievementService.js";
import { ACTION_TYPES } from "../../achievements/achievementConfig.js";

// In-memory cooldown tracking (resets on bot restart - acceptable for 30s cooldown)
const tradeCooldowns = new Map();

export const data = new SlashCommandBuilder()
  .setName("stock")
  .setDescription("Buy and sell stocks with your coins")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("buy")
      .setDescription("Buy shares of a stock")
      .addStringOption((option) =>
        option
          .setName("ticker")
          .setDescription("Stock ticker symbol (e.g., AAPL, MSFT)")
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("Amount of coins to spend")
          .setRequired(true)
          .setMinValue(STOCK_CONFIG.TRADE_MIN)
          .setMaxValue(STOCK_CONFIG.TRADE_MAX)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("sell")
      .setDescription("Sell shares of a stock")
      .addStringOption((option) =>
        option
          .setName("ticker")
          .setDescription("Stock ticker symbol (e.g., AAPL, MSFT)")
          .setRequired(true)
      )
      .addNumberOption((option) =>
        option
          .setName("shares")
          .setDescription("Number of shares to sell")
          .setRequired(true)
          .setMinValue(0.000001)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("portfolio").setDescription("View your stock portfolio")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("quote")
      .setDescription("Get the current price of a stock")
      .addStringOption((option) =>
        option.setName("ticker").setDescription("Stock ticker symbol").setRequired(true)
      )
  );

/**
 * Execute the stock command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "buy":
      await handleBuy(interaction);
      break;
    case "sell":
      await handleSell(interaction);
      break;
    case "portfolio":
      await handlePortfolio(interaction);
      break;
    case "quote":
      await handleQuote(interaction);
      break;
  }
}

/**
 * Check and enforce trade cooldown
 * @param {string} userId - Discord user ID
 * @returns {{onCooldown: boolean, remainingSeconds?: number}}
 */
function checkCooldown(userId) {
  const lastTrade = tradeCooldowns.get(userId);
  if (lastTrade) {
    const elapsed = Date.now() - lastTrade;
    const cooldownMs = STOCK_CONFIG.TRADE_COOLDOWN_SECONDS * 1000;
    if (elapsed < cooldownMs) {
      return {
        onCooldown: true,
        remainingSeconds: Math.ceil((cooldownMs - elapsed) / 1000),
      };
    }
  }
  return { onCooldown: false };
}

/**
 * Handle /stock buy subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleBuy(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const ticker = interaction.options.getString("ticker");
    const amount = interaction.options.getInteger("amount");

    // Check cooldown
    const cooldown = checkCooldown(userId);
    if (cooldown.onCooldown) {
      await interaction.editReply({
        content: STOCK_MESSAGES.COOLDOWN(cooldown.remainingSeconds),
      });
      return;
    }

    // Validate ticker format
    if (!stockApi.isValidTickerFormat(ticker)) {
      await interaction.editReply({
        content: STOCK_MESSAGES.INVALID_TICKER,
      });
      return;
    }

    // Get or create user
    const userData = await economyDb.getOrCreateUser(userId, username);

    // Check wallet balance
    if (userData.wallet < amount) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("Stock Purchase Failed")
        .setDescription(
          `${STOCK_MESSAGES.INSUFFICIENT_FUNDS}\n\nYour wallet: ${formatCurrency(userData.wallet)}\nTrade amount: ${formatCurrency(amount)}`
        )
        .setFooter({ text: "Tip: Use /withdraw to get coins from your bank" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Fetch stock quote
    const quoteResult = await stockApi.getQuote(ticker);
    if (!quoteResult.success) {
      await interaction.editReply({ content: quoteResult.error });
      return;
    }

    const { data: quote } = quoteResult;
    const shares = amount / quote.currentPrice;

    // Set cooldown before executing trade
    tradeCooldowns.set(userId, Date.now());

    // Execute purchase
    const buyResult = await stockDb.buyShares(
      userId,
      quote.ticker,
      shares,
      quote.currentPrice,
      amount
    );

    if (!buyResult.success) {
      const errorMessages = {
        INSUFFICIENT_FUNDS: STOCK_MESSAGES.INSUFFICIENT_FUNDS,
      };
      await interaction.editReply({
        content: errorMessages[buyResult.error] || "Purchase failed. Please try again.",
      });
      return;
    }

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`Bought ${quote.ticker}`)
      .setDescription(
        `Successfully purchased ${formatShares(shares)} shares of **${quote.ticker}**`
      )
      .addFields(
        { name: "Shares Purchased", value: formatShares(shares), inline: true },
        { name: "Price per Share", value: `$${formatPrice(quote.currentPrice)}`, inline: true },
        { name: "Total Cost", value: formatCurrency(amount), inline: true },
        { name: "New Wallet Balance", value: formatCurrency(buyResult.user.wallet), inline: true },
        {
          name: "Your Position",
          value: `${formatShares(parseFloat(buyResult.holding.shares))} shares @ $${formatPrice(parseFloat(buyResult.holding.average_cost))} avg`,
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: "Use /stock portfolio to view all holdings" });

    await interaction.editReply({ embeds: [embed] });

    // Check for achievements (non-blocking)
    checkForAchievements({
      actionType: ACTION_TYPES.STOCK_BUY,
      userId,
      username,
      client: interaction.client,
      amount,
      ticker: quote.ticker,
      shares,
    }).catch((err) => console.error("Failed to check achievements:", err));
  } catch (error) {
    console.error("stock buy error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /stock sell subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSell(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const ticker = interaction.options.getString("ticker");
    const sharesToSell = interaction.options.getNumber("shares");

    // Check cooldown
    const cooldown = checkCooldown(userId);
    if (cooldown.onCooldown) {
      await interaction.editReply({
        content: STOCK_MESSAGES.COOLDOWN(cooldown.remainingSeconds),
      });
      return;
    }

    // Validate ticker format
    if (!stockApi.isValidTickerFormat(ticker)) {
      await interaction.editReply({
        content: STOCK_MESSAGES.INVALID_TICKER,
      });
      return;
    }

    // Get or create user
    await economyDb.getOrCreateUser(userId, username);

    // Check current holding
    const holding = await stockDb.getHolding(userId, ticker);
    if (!holding) {
      await interaction.editReply({
        content: STOCK_MESSAGES.NO_HOLDINGS,
      });
      return;
    }

    const currentShares = parseFloat(holding.shares);
    if (currentShares < sharesToSell) {
      await interaction.editReply({
        content: `${STOCK_MESSAGES.INSUFFICIENT_SHARES}\n\nYou own: ${formatShares(currentShares)} shares\nTrying to sell: ${formatShares(sharesToSell)} shares`,
      });
      return;
    }

    // Fetch stock quote
    const quoteResult = await stockApi.getQuote(ticker);
    if (!quoteResult.success) {
      await interaction.editReply({ content: quoteResult.error });
      return;
    }

    const { data: quote } = quoteResult;

    // Set cooldown before executing trade
    tradeCooldowns.set(userId, Date.now());

    // Execute sale
    const sellResult = await stockDb.sellShares(userId, quote.ticker, sharesToSell, quote.currentPrice);

    if (!sellResult.success) {
      const errorMessages = {
        NO_HOLDING: STOCK_MESSAGES.NO_HOLDINGS,
        INSUFFICIENT_SHARES: STOCK_MESSAGES.INSUFFICIENT_SHARES,
        WALLET_UPDATE_FAILED: "Failed to add proceeds to wallet.",
      };
      await interaction.editReply({
        content: errorMessages[sellResult.error] || "Sale failed. Please try again.",
      });
      return;
    }

    // Determine profit/loss color and emoji
    const isProfitable = sellResult.profit >= 0;
    const profitEmoji = isProfitable ? "+" : "";
    const profitColor = isProfitable ? 0x2ecc71 : 0xe74c3c;

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(profitColor)
      .setTitle(`Sold ${quote.ticker}`)
      .setDescription(
        `Successfully sold ${formatShares(sharesToSell)} shares of **${quote.ticker}**`
      )
      .addFields(
        { name: "Shares Sold", value: formatShares(sharesToSell), inline: true },
        { name: "Price per Share", value: `$${formatPrice(quote.currentPrice)}`, inline: true },
        { name: "Proceeds", value: formatCurrency(sellResult.proceeds), inline: true },
        {
          name: "Profit/Loss",
          value: `${profitEmoji}${formatCurrency(Math.floor(sellResult.profit))}`,
          inline: true,
        },
        { name: "New Wallet Balance", value: formatCurrency(sellResult.user.wallet), inline: true }
      )
      .setTimestamp();

    // Add remaining position if any
    if (sellResult.holding) {
      embed.addFields({
        name: "Remaining Position",
        value: `${formatShares(parseFloat(sellResult.holding.shares))} shares`,
        inline: true,
      });
    } else {
      embed.setFooter({ text: "Position closed" });
    }

    await interaction.editReply({ embeds: [embed] });

    // Check for achievements (non-blocking)
    checkForAchievements({
      actionType: ACTION_TYPES.STOCK_SELL,
      userId,
      username,
      client: interaction.client,
      amount: sellResult.proceeds,
      ticker: quote.ticker,
      shares: sharesToSell,
      profit: sellResult.profit,
    }).catch((err) => console.error("Failed to check achievements:", err));
  } catch (error) {
    console.error("stock sell error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /stock portfolio subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handlePortfolio(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    await economyDb.getOrCreateUser(userId, username);

    const portfolio = await stockDb.getPortfolio(userId);

    if (portfolio.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`${username}'s Stock Portfolio`)
        .setDescription(
          "You don't own any stocks yet.\n\nUse `/stock buy <ticker> <amount>` to get started!"
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Build portfolio display
    let totalCostBasis = 0;
    const holdingsText = portfolio
      .map((h) => {
        const shares = parseFloat(h.shares);
        const avgCost = parseFloat(h.average_cost);
        const costBasis = shares * avgCost;
        totalCostBasis += costBasis;

        return `**${h.ticker}**: ${formatShares(shares)} shares @ $${formatPrice(avgCost)} avg (${formatCurrency(Math.floor(costBasis))})`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${username}'s Stock Portfolio`)
      .setDescription(holdingsText)
      .addFields(
        { name: "Total Positions", value: portfolio.length.toString(), inline: true },
        { name: "Total Cost Basis", value: formatCurrency(Math.floor(totalCostBasis)), inline: true }
      )
      .setFooter({ text: "Use /stock quote <ticker> to check current prices" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("stock portfolio error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}

/**
 * Handle /stock quote subcommand
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleQuote(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const ticker = interaction.options.getString("ticker");

    if (!stockApi.isValidTickerFormat(ticker)) {
      await interaction.editReply({
        content: STOCK_MESSAGES.INVALID_TICKER,
      });
      return;
    }

    const quoteResult = await stockApi.getQuote(ticker);
    if (!quoteResult.success) {
      await interaction.editReply({ content: quoteResult.error });
      return;
    }

    const { data: quote } = quoteResult;
    const isPositive = quote.change >= 0;
    const changeEmoji = isPositive ? "+" : "";
    const changeColor = isPositive ? 0x2ecc71 : 0xe74c3c;

    const embed = new EmbedBuilder()
      .setColor(changeColor)
      .setTitle(quote.ticker)
      .setDescription(`Current Price: **$${formatPrice(quote.currentPrice)}**`)
      .addFields(
        {
          name: "Change",
          value: `${changeEmoji}$${formatPrice(quote.change)} (${changeEmoji}${quote.changePercent?.toFixed(2)}%)`,
          inline: true,
        },
        {
          name: "Day Range",
          value: `$${formatPrice(quote.low)} - $${formatPrice(quote.high)}`,
          inline: true,
        },
        { name: "Previous Close", value: `$${formatPrice(quote.previousClose)}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Data from Finnhub" });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("stock quote error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
