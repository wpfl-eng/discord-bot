# /eleaderboard Total Liquidity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update `/eleaderboard` to show total liquidity (cash + stocks + inventory) with large number formatting.

**Architecture:** Add a `stock_prices` cache table populated on stock API fetches. Leaderboard query joins economy_users, stock_holdings, stock_prices, and user_inventory to compute total wealth. Display uses abbreviated formatting (M/B) for large numbers.

**Tech Stack:** TypeScript, PostgreSQL (@vercel/postgres), discord.js v14

**Design Doc:** `docs/plans/2025-12-22-eleaderboard-total-liquidity-design.md`

---

## Task 1: Create SQL Migration File

**Files:**
- Create: `sql/stock_prices.sql`

**Step 1: Create the migration file**

```sql
-- Stock Prices Cache Table
-- Caches latest stock prices for leaderboard calculations
-- Populated by stockApi.getQuote() on successful fetches

CREATE TABLE IF NOT EXISTS stock_prices (
  ticker VARCHAR(10) PRIMARY KEY,
  price NUMERIC(12, 2) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for finding stale prices if needed
CREATE INDEX IF NOT EXISTS idx_stock_prices_updated ON stock_prices(updated_at);
```

**Step 2: Verify file created**

Run: `cat sql/stock_prices.sql`
Expected: Shows the SQL content above

**Step 3: Commit**

```bash
git add sql/stock_prices.sql
git commit -m "Add stock_prices table migration for price caching"
```

---

## Task 2: Add TotalWealthEntry Type

**Files:**
- Modify: `types/database.ts` (add after line 47, after EconomyLeaderboardEntry)

**Step 1: Add the type**

Add after `EconomyLeaderboardEntry` interface:

```typescript
/**
 * Total wealth leaderboard entry including stocks and inventory
 */
export interface TotalWealthEntry {
  readonly user_id: string;
  readonly username: string;
  readonly cash_wealth: number;
  readonly stock_wealth: number;
  readonly inventory_wealth: number;
  readonly total_wealth: number;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add types/database.ts
git commit -m "Add TotalWealthEntry type for total liquidity leaderboard"
```

---

## Task 3: Add cachePrice() Function to stockDb.ts

**Files:**
- Modify: `stock/stockDb.ts` (add after line 319, after getPortfolioStats)

**Step 1: Add the cachePrice function**

Add at end of file (after `getPortfolioStats`):

```typescript
// ============ Price Cache ============

/**
 * Cache a stock price for leaderboard calculations
 * Called fire-and-forget from stockApi.getQuote()
 * @param ticker - Stock ticker symbol
 * @param price - Current price
 */
export async function cachePrice(ticker: string, price: number): Promise<void> {
  const normalizedTicker = ticker.toUpperCase().trim();
  await sql`
    INSERT INTO stock_prices (ticker, price, updated_at)
    VALUES (${normalizedTicker}, ${price}, NOW())
    ON CONFLICT (ticker) DO UPDATE SET
      price = ${price},
      updated_at = NOW()
  `;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add stock/stockDb.ts
git commit -m "Add cachePrice() function to stockDb for price caching"
```

---

## Task 4: Call cachePrice() from stockApi.ts

**Files:**
- Modify: `stock/stockApi.ts` (modify around line 80-94)

**Step 1: Add import for cachePrice**

At line 4, change:
```typescript
import { STOCK_CONFIG, STOCK_MESSAGES } from './stockConfig.js';
```

To:
```typescript
import { STOCK_CONFIG, STOCK_MESSAGES } from './stockConfig.js';
import { cachePrice } from './stockDb.js';
```

**Step 2: Add cachePrice call before return in getQuote()**

Find the success return block (around line 81-94). Before the `return { success: true, ...}` statement, add:

```typescript
    // Cache price for leaderboard calculations (fire-and-forget)
    cachePrice(normalizedTicker, data.c).catch((err: unknown) =>
      console.error(`[STOCK] Failed to cache price for ${normalizedTicker}:`, err)
    );

    return {
      success: true,
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add stock/stockApi.ts
git commit -m "Call cachePrice() on successful stock quote fetches"
```

---

## Task 5: Add formatLargeNumber() to economyConfig.ts

**Files:**
- Modify: `economy/economyConfig.ts` (add after formatCurrency function, around line 310)

**Step 1: Add the formatLargeNumber function**

Add after `formatCurrency` function:

```typescript
/**
 * Formats large numbers with abbreviations for leaderboard display
 * @param amount - The numeric amount to format
 * @returns Formatted string (e.g., "1.5M", "2.3B")
 */
export function formatLargeNumber(amount: number): string {
  if (Number.isNaN(amount)) return `${CURRENCY_EMOJI} 0`;

  if (amount >= 1_000_000_000) {
    return `${CURRENCY_EMOJI} ${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `${CURRENCY_EMOJI} ${(amount / 1_000_000).toFixed(1)}M`;
  }

  return `${CURRENCY_EMOJI} ${Math.floor(amount).toLocaleString()}`;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add economy/economyConfig.ts
git commit -m "Add formatLargeNumber() for abbreviated currency display"
```

---

## Task 6: Add Total Wealth Leaderboard Functions to economyDb.ts

**Files:**
- Modify: `economy/economyDb.ts` (add after getTotalUsers at end of file)

**Step 1: Add import for TotalWealthEntry**

At line 5, change:
```typescript
import type { EconomyUser, TransferResult, EconomyLeaderboardEntry } from '../types/database.js';
```

To:
```typescript
import type { EconomyUser, TransferResult, EconomyLeaderboardEntry, TotalWealthEntry } from '../types/database.js';
```

**Step 2: Update re-export to include TotalWealthEntry**

At line 8, change:
```typescript
export type { EconomyUser, TransferResult, EconomyLeaderboardEntry };
```

To:
```typescript
export type { EconomyUser, TransferResult, EconomyLeaderboardEntry, TotalWealthEntry };
```

**Step 3: Add the three new functions at end of file**

Add after `getTotalUsers` function:

```typescript
// ============ Total Wealth Leaderboard ============

// Sellable item types - keep in sync with inventoryConfig.ts ITEM_DEFINITIONS
// These are items with sellable: true that contribute to total wealth
const SELLABLE_ITEM_TYPES = [
  'rookie_te',
  'rookie_rb',
  'rookie_wr',
  'rookie_qb',
  'wordle_lucky_letter',
] as const;

/**
 * Get the total wealth leaderboard (cash + stocks + inventory)
 * @param limit - Number of users to return
 * @returns Top users sorted by total wealth
 */
export async function getTotalWealthLeaderboard(
  limit: number = 10
): Promise<TotalWealthEntry[]> {
  const safeLimit = Math.min(Math.max(1, limit), 25);
  const sellableTypes = SELLABLE_ITEM_TYPES as readonly string[];

  const result = await sql<TotalWealthEntry>`
    SELECT
      e.user_id,
      e.username,
      (e.wallet + e.bank) AS cash_wealth,
      COALESCE(s.stock_wealth, 0)::numeric AS stock_wealth,
      COALESCE(i.inventory_wealth, 0)::numeric AS inventory_wealth,
      (e.wallet + e.bank + COALESCE(s.stock_wealth, 0) + COALESCE(i.inventory_wealth, 0))::numeric AS total_wealth
    FROM economy_users e
    LEFT JOIN (
      SELECT h.user_id, SUM(h.shares * COALESCE(p.price, h.average_cost)) AS stock_wealth
      FROM stock_holdings h
      LEFT JOIN stock_prices p ON h.ticker = p.ticker
      GROUP BY h.user_id
    ) s ON e.user_id = s.user_id
    LEFT JOIN (
      SELECT user_id, SUM(quantity * COALESCE(item_value, 0)) AS inventory_wealth
      FROM user_inventory
      WHERE item_type = ANY(${sellableTypes})
      GROUP BY user_id
    ) i ON e.user_id = i.user_id
    ORDER BY total_wealth DESC
    LIMIT ${safeLimit}
  `;

  return result.rows.map(row => ({
    user_id: row.user_id,
    username: row.username,
    cash_wealth: Number(row.cash_wealth),
    stock_wealth: Number(row.stock_wealth),
    inventory_wealth: Number(row.inventory_wealth),
    total_wealth: Number(row.total_wealth),
  }));
}

/**
 * Get a user's rank on the total wealth leaderboard
 * @param userId - Discord user ID
 * @returns User's rank (1-based) or null if not found
 */
export async function getTotalWealthUserRank(userId: string): Promise<number | null> {
  const userWealth = await getUserTotalWealth(userId);
  if (!userWealth) return null;

  const result = await sql<{ rank: string }>`
    SELECT COUNT(*) + 1 as rank
    FROM economy_users e
    LEFT JOIN (
      SELECT h.user_id, SUM(h.shares * COALESCE(p.price, h.average_cost)) AS stock_wealth
      FROM stock_holdings h
      LEFT JOIN stock_prices p ON h.ticker = p.ticker
      GROUP BY h.user_id
    ) s ON e.user_id = s.user_id
    LEFT JOIN (
      SELECT user_id, SUM(quantity * COALESCE(item_value, 0)) AS inventory_wealth
      FROM user_inventory
      WHERE item_type = ANY(${SELLABLE_ITEM_TYPES as readonly string[]})
      GROUP BY user_id
    ) i ON e.user_id = i.user_id
    WHERE (e.wallet + e.bank + COALESCE(s.stock_wealth, 0) + COALESCE(i.inventory_wealth, 0)) > ${userWealth.total_wealth}
  `;

  return parseInt(result.rows[0]?.rank ?? '1', 10);
}

/**
 * Get a single user's total wealth breakdown
 * @param userId - Discord user ID
 * @returns User's wealth breakdown or null if not found
 */
export async function getUserTotalWealth(userId: string): Promise<TotalWealthEntry | null> {
  const sellableTypes = SELLABLE_ITEM_TYPES as readonly string[];

  const result = await sql<TotalWealthEntry>`
    SELECT
      e.user_id,
      e.username,
      (e.wallet + e.bank) AS cash_wealth,
      COALESCE(s.stock_wealth, 0)::numeric AS stock_wealth,
      COALESCE(i.inventory_wealth, 0)::numeric AS inventory_wealth,
      (e.wallet + e.bank + COALESCE(s.stock_wealth, 0) + COALESCE(i.inventory_wealth, 0))::numeric AS total_wealth
    FROM economy_users e
    LEFT JOIN (
      SELECT h.user_id, SUM(h.shares * COALESCE(p.price, h.average_cost)) AS stock_wealth
      FROM stock_holdings h
      LEFT JOIN stock_prices p ON h.ticker = p.ticker
      GROUP BY h.user_id
    ) s ON e.user_id = s.user_id
    LEFT JOIN (
      SELECT user_id, SUM(quantity * COALESCE(item_value, 0)) AS inventory_wealth
      FROM user_inventory
      WHERE item_type = ANY(${sellableTypes})
      GROUP BY user_id
    ) i ON e.user_id = i.user_id
    WHERE e.user_id = ${userId}
    LIMIT 1
  `;

  const row = result.rows[0];
  if (!row) return null;

  return {
    user_id: row.user_id,
    username: row.username,
    cash_wealth: Number(row.cash_wealth),
    stock_wealth: Number(row.stock_wealth),
    inventory_wealth: Number(row.inventory_wealth),
    total_wealth: Number(row.total_wealth),
  };
}
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add economy/economyDb.ts
git commit -m "Add total wealth leaderboard functions to economyDb"
```

---

## Task 7: Update eleaderboard Command

**Files:**
- Modify: `discordCommands/eleaderboard/eleaderboard.ts` (full rewrite of execute function)

**Step 1: Update imports**

Replace the imports at the top of the file:

```typescript
import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { formatLargeNumber, CURRENCY_EMOJI } from '../../economy/economyConfig.js';
import type { TotalWealthEntry } from '../../types/database.js';
```

**Step 2: Replace the execute function**

Replace the entire `execute` function with:

```typescript
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;

    // Ensure current user exists in the database
    await economyDb.getOrCreateUser(userId, username);

    // Get total wealth leaderboard
    const leaderboard: TotalWealthEntry[] = await economyDb.getTotalWealthLeaderboard(10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No one has any coins yet! Use `/daily` or `/work` to start earning.',
      });
      return;
    }

    // Get current user's rank
    const userRank: number | null = await economyDb.getTotalWealthUserRank(userId);
    const totalUsers: number = await economyDb.getTotalUsers();

    // Build leaderboard text
    const medals: string[] = ['🥇', '🥈', '🥉'];
    const leaderboardText: string = leaderboard
      .map((entry: TotalWealthEntry, index: number) => {
        const medal: string = medals[index] || `${index + 1}.`;
        const isCurrentUser: boolean = entry.user_id === userId;
        const highlight: string = isCurrentUser ? '**' : '';
        return `${medal} ${highlight}${entry.username}${highlight} - ${formatLargeNumber(entry.total_wealth)}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`${CURRENCY_EMOJI} Economy Leaderboard`)
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: `Your rank: #${userRank} of ${totalUsers}` });

    // If user is not in top 10, show their position with breakdown
    const userInTop10: boolean = leaderboard.some((entry: TotalWealthEntry) => entry.user_id === userId);
    if (!userInTop10 && userRank) {
      const userWealth: TotalWealthEntry | null = await economyDb.getUserTotalWealth(userId);
      if (userWealth) {
        const breakdown = `💵 ${Math.floor(userWealth.cash_wealth).toLocaleString()} | 📈 ${Math.floor(userWealth.stock_wealth).toLocaleString()} | 📦 ${Math.floor(userWealth.inventory_wealth).toLocaleString()}`;
        embed.addFields({
          name: `Your Position: #${userRank}`,
          value: `${formatLargeNumber(userWealth.total_wealth)}\n${breakdown}`,
          inline: false,
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('[ELEADERBOARD] Error:', error);
    await interaction.editReply({
      content: 'An error occurred while fetching the leaderboard. Please try again.',
    });
  }
}
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Run linter**

Run: `npx eslint discordCommands/eleaderboard/eleaderboard.ts`
Expected: No errors (or only warnings)

**Step 5: Commit**

```bash
git add discordCommands/eleaderboard/eleaderboard.ts
git commit -m "Update eleaderboard to show total liquidity with breakdown"
```

---

## Task 8: Final Verification

**Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run linter on all modified files**

Run: `npx eslint stock/stockDb.ts stock/stockApi.ts economy/economyDb.ts economy/economyConfig.ts discordCommands/eleaderboard/eleaderboard.ts types/database.ts`
Expected: No errors (warnings acceptable)

**Step 3: Review all changes**

Run: `git log --oneline -8`
Expected: See 7 new commits for this feature

**Step 4: Create summary commit (optional squash)**

If all looks good, the feature is ready for deployment.

---

## Deployment Notes

### Pre-deployment

1. **Run the SQL migration** on your database:
   ```bash
   # Connect to your Vercel Postgres and run:
   # Contents of sql/stock_prices.sql
   ```

### Post-deployment Testing

1. Run `/eleaderboard` - should show total wealth
2. Run `/stock quote AAPL` - should cache the price
3. Run `/eleaderboard` again - stock values should reflect cached prices
4. Test with user who has:
   - Only cash (wallet + bank)
   - Cash + stocks
   - Cash + inventory
   - Cash + stocks + inventory
5. Test user not in top 10 sees breakdown

### Rollback

If issues occur:
- The old `getLeaderboard()` function still exists
- Revert eleaderboard.ts to use old function
- stock_prices table is additive, doesn't affect existing functionality
