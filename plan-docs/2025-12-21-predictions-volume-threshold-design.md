# Predictions Volume Threshold Design

**Date:** 2025-12-21
**Status:** Approved

## Problem

When selecting a category in `/predictions`, the markets shown are low-volume/obscure despite being sorted by volume. This happens because the "highest volume within a niche tag" can still be relatively inactive compared to overall Polymarket activity.

## Solution

Add a $100K minimum volume threshold. Markets below this threshold are filtered out. If a category has no qualifying markets, show a clear message.

## Implementation

### 1. Configuration (`polymarket/polymarketConfig.ts`)

Add to CONFIG:
```typescript
MIN_MARKET_VOLUME: 100_000,
```

### 2. Filtering Logic (`polymarket/polymarketClient.ts`)

Update `getMarketsByTag()`:
- Fetch 3x the requested limit to compensate for filtering
- Filter results by `volume >= CONFIG.MIN_MARKET_VOLUME`
- Return only the requested limit

### 3. Empty State UI (`discordCommands/predictions/predictions.ts`)

Update `createMarketsEmbed()` empty message:
```
No high-volume markets in this category right now.

*Markets must have $100K+ volume to appear here.*
```

## What This Does NOT Change

- `getPopularMarkets()` - Trending already shows highest-volume overall
- Button handling - Already works correctly for empty state
- Database or bet logic

## Edge Cases

- Zero qualifying markets: Shows message with Back button
- 1-4 qualifying markets: Shows what's available
- Trending category: Unaffected (uses `getPopularMarkets()`)
