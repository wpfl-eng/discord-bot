# /eleaderboard Total Liquidity Design

## Overview

Update the `/eleaderboard` command to show **total liquidity** instead of just cash (wallet + bank). Total liquidity includes:

1. **Cash** - wallet + bank balance
2. **Stocks** - portfolio value at cached market prices
3. **Inventory** - sellable items value

Large numbers will be abbreviated (e.g., 1.5M, 2.3B) for readability.

## Data Model

### New Table: `stock_prices`

```sql
CREATE TABLE IF NOT EXISTS stock_prices (
  ticker VARCHAR(10) PRIMARY KEY,
  price NUMERIC(12, 2) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_prices_updated ON stock_prices(updated_at);
```

### Total Wealth Formula

```
Total Liquidity = Cash + Stocks + Inventory

Where:
  Cash      = wallet + bank
  Stocks    = SUM(shares * COALESCE(cached_price, average_cost))
  Inventory = SUM(quantity * item_value) for sellable items only
```

### Sellable Items (from inventoryConfig.ts)

| Item Type | Base Value |
|-----------|------------|
| `rookie_te` | 75 |
| `rookie_rb` | 150 |
| `rookie_wr` | 225 |
| `rookie_qb` | 375 |
| `wordle_lucky_letter` | 500 |

## Query

```sql
SELECT
  e.user_id,
  e.username,
  (e.wallet + e.bank) AS cash_wealth,
  COALESCE(s.stock_wealth, 0) AS stock_wealth,
  COALESCE(i.inventory_wealth, 0) AS inventory_wealth,
  (e.wallet + e.bank + COALESCE(s.stock_wealth, 0) + COALESCE(i.inventory_wealth, 0)) AS total_wealth
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
  WHERE item_type IN ('rookie_te', 'rookie_rb', 'rookie_wr', 'rookie_qb', 'wordle_lucky_letter')
  GROUP BY user_id
) i ON e.user_id = i.user_id
ORDER BY total_wealth DESC
LIMIT $1
```

### Index Coverage

| Table | Index | Used For |
|-------|-------|----------|
| `economy_users` | `idx_economy_user_id` | Primary lookup |
| `stock_holdings` | `idx_stock_holdings_user` | GROUP BY user_id |
| `stock_holdings` | `idx_stock_holdings_ticker` | JOIN with stock_prices |
| `user_inventory` | `idx_inventory_user` | GROUP BY user_id |
| `stock_prices` | PRIMARY KEY (ticker) | JOIN lookup |

## Implementation

### Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `sql/stock_prices.sql` | **New** | Price cache table |
| `stock/stockDb.ts` | Modify | Add `cachePrice()` |
| `stock/stockApi.ts` | Modify | Call cache on fetch |
| `economy/economyConfig.ts` | Modify | Add `formatLargeNumber()` |
| `economy/economyDb.ts` | Modify | Add 3 leaderboard functions |
| `types/database.ts` | Modify | Add `TotalWealthEntry` |
| `discordCommands/eleaderboard/eleaderboard.ts` | Modify | New display logic |

### New Functions

#### `stock/stockDb.ts`

```typescript
/**
 * Cache a stock price (fire-and-forget from caller)
 */
export async function cachePrice(ticker: string, price: number): Promise<void>
```

#### `economy/economyConfig.ts`

```typescript
/**
 * Formats large numbers with abbreviations (1.5M, 2.3B)
 */
export function formatLargeNumber(amount: number): string
```

#### `economy/economyDb.ts`

```typescript
interface TotalWealthEntry {
  readonly user_id: string;
  readonly username: string;
  readonly cash_wealth: number;
  readonly stock_wealth: number;
  readonly inventory_wealth: number;
  readonly total_wealth: number;
}

export async function getTotalWealthLeaderboard(limit?: number): Promise<TotalWealthEntry[]>
export async function getTotalWealthUserRank(userId: string): Promise<number | null>
export async function getUserTotalWealth(userId: string): Promise<TotalWealthEntry | null>
```

### Price Cache Flow

```
User runs /stock quote AAPL
         |
         v
  stockApi.getQuote('AAPL')
         |
         v
  Finnhub API returns price
         |
         +----------------------+
         v                      v
  Return to caller      cachePrice('AAPL', 150.25)
                               |                    (fire-and-forget)
                               v
                        UPSERT into stock_prices
```

### Implementation Checklist

```
[ ] 1. Create sql/stock_prices.sql
[ ] 2. Run migration on database
[ ] 3. Add cachePrice() to stockDb.ts
[ ] 4. Modify stockApi.ts getQuote() to call cachePrice()
[ ] 5. Add formatLargeNumber() to economyConfig.ts
[ ] 6. Add TotalWealthEntry to types/database.ts
[ ] 7. Add leaderboard functions to economyDb.ts
[ ] 8. Update eleaderboard command
[ ] 9. Test manually (stocks + inventory + cash, cash only, not in top 10, empty)
```

## Display Format

```
Economy Leaderboard

1. PlayerOne - 1.5M
2. PlayerTwo - 1.2M
3. PlayerThree - 980,000
4. PlayerFour - 850,000
5. PlayerFive - 720,000
6. PlayerSeven - 540,000
7. PlayerEight - 430,000
8. PlayerNine - 320,000
9. PlayerTen - 210,000
10. PlayerEleven - 180,000

Your Position: #15 of 47 - 125,000
Cash 25,000 | Stocks 75,000 | Items 25,000
```

### Number Formatting

| Value | Display |
|-------|---------|
| < 1,000,000 | `952,340` (with commas) |
| >= 1,000,000 | `1.5M` |
| >= 1,000,000,000 | `2.3B` |

## Error Handling

### Edge Cases

| Case | Behavior |
|------|----------|
| User has no stocks | `stock_wealth = 0` (COALESCE) |
| User has no inventory | `inventory_wealth = 0` (COALESCE) |
| Stock with no cached price | Falls back to `average_cost` |
| Empty leaderboard | Show "No one has any coins yet!" |
| Database error | Log internally, show generic message |

### Security

- Do NOT expose error messages to users (error disclosure fix)
- Log errors server-side with `[ELEADERBOARD]` prefix
- Show generic "An error occurred" message to users

```typescript
} catch (error: unknown) {
  console.error('[ELEADERBOARD] Error:', error);
  await interaction.editReply({
    content: 'An error occurred while fetching the leaderboard. Please try again.',
  });
}
```

## Deployment

### Order

1. Run SQL migration (`sql/stock_prices.sql`)
2. Deploy code changes

### Rollback

- Low risk - all changes are additive
- If migration not run, cachePrice() fails silently (logged)
- If issues arise, old behavior still works (just shows cash)

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Cached prices over real-time | Speed > accuracy for leaderboard display |
| Separate `stock_prices` table | Normalized - one price per ticker, not per user |
| Fallback to `average_cost` | Graceful degradation for uncached stocks |
| Only sellable items count | "Liquidity" = realizable value |
| Abbreviate at M/B only | Keep smaller numbers readable with commas |
| Breakdown only for user's position | Keep top 10 list clean and scannable |
| Fire-and-forget caching | Don't slow down stock commands |
| Hardcoded SELLABLE_ITEM_TYPES | Pragmatic for Discord bot scale, documented sync requirement |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Stale prices | Acceptable - updated on any /stock command usage |
| Migration not run | Query fails gracefully, generic error shown |
| New sellable item added | Update SELLABLE_ITEM_TYPES constant (documented in code) |
| Large user base (1000+) | Query is indexed, should remain fast |
