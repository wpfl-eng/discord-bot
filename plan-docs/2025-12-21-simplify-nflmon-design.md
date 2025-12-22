# Simplify `/nflmon` Command

**Date:** 2025-12-21
**Status:** Approved

## Goal

Remove `evolve`, `nickname`, `sell`, and `leaderboard` subcommands to streamline the `/nflmon` command for the core **Collect → Train → Battle** loop.

## Result

**Before:** 10 subcommands + trade group
**After:** 6 subcommands + trade group

### Remaining Commands

| Subcommand | Purpose |
|------------|---------|
| bench | View your NFLmon collection |
| view | See detailed NFLmon stats |
| train | Assign NFLmon to training slot |
| untrain | Remove NFLmon from training |
| stats | View your trainer statistics |
| dex | Browse the NFLmon encyclopedia |
| trade offer | Create a trade offer |
| trade pending | View pending trades |
| trade cancel | Cancel a trade you sent |

## Removals

### 1. Nickname Subcommand

**File:** `discordCommands/nflmon/nflmon.ts`

| What | Lines |
|------|-------|
| Subcommand definition | 262-273 |
| Switch case | 423-425 |
| `handleNickname` function | 703-744 |

**No imports or helpers to remove.**

### 2. Evolve Subcommand

**File:** `discordCommands/nflmon/nflmon.ts`

| What | Lines |
|------|-------|
| Subcommand definition | 275-283 |
| Switch case | 426-428 |
| `handleEvolve` function | 746-801 |
| `buildEvolutionEmbed` helper | 100-115 |
| `EvolutionStage` type import | Line 22 (remove entire line) |

### 3. Sell Subcommand

**File:** `discordCommands/nflmon/nflmon.ts`

| What | Lines |
|------|-------|
| Subcommand definition | 285-293 |
| Switch case | 429-431 |
| `handleSell` function | 803-921 |
| `buildSellConfirmButtons` helper | 83-98 |
| `getSellValue` import | Line 21 (remove from import) |
| `formatCurrency` import | Line 23 (remove entire line) |
| `IN_TRAINING` error message | Line 33 |

### 4. Leaderboard Subcommand

**File:** `discordCommands/nflmon/nflmon.ts`

| What | Lines |
|------|-------|
| Subcommand definition | 298-314 |
| Switch case | 436-438 |
| `handleLeaderboard` function | 949-976 |
| `LeaderboardCategory` type import | Line 17 |
| `LeaderboardEntry` type import | Line 20 |

## What We're Keeping

| Item | Reason |
|------|--------|
| `nflmonDb.setNickname()` | DB function, may reuse later |
| `nflmonDb.evolveNflmon()` | Used by auto-evolution during training |
| `nflmonDb.sellNflmon()` | DB function, may reuse later |
| `nflmonDb.getLeaderboard()` | DB function, keeps data accessible |
| `nflmonService.buildLeaderboardEmbed()` | May reuse later |
| All stats tracking in database | Leaderboard data preserved |
| `displayData.canEvolve`, `displayData.nextStage` | Still shown in `/nflmon view` |
| Nickname field display in other handlers | Users can still see existing nicknames |
| Auto-evolution logic | Still triggers during training XP gains |

## Post-Implementation

After making these changes:

1. Run `npx tsx deploy-commands.ts` to update Discord slash commands
2. Test remaining commands: bench, view, train, untrain, stats, dex, trade
