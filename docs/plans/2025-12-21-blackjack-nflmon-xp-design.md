# Blackjack NFLmon XP Integration Design

**Date:** 2025-12-21
**Status:** Approved

## Overview

Add NFLmon XP rewards to the `/blackjack` command, allowing players to train their NFLmon while playing blackjack.

## Requirements

- Award XP to NFLmon in training when player wins blackjack
- Bonus XP (2x) for natural blackjack (21 on first two cards)
- Display XP results inline in the game result embed
- No XP for pushes, losses, or surrenders

## XP Configuration

| Outcome | XP Source | XP Range |
|---------|-----------|----------|
| Regular win | `blackjack_win` | 3-8 XP |
| Natural blackjack | `blackjack_natural` | 6-16 XP |
| Push | - | No XP |
| Loss | - | No XP |
| Surrender | - | No XP |

## Embed Display

When XP is earned and user has NFLmon in training, add field to result embed:

```
NFLmon Training: +12 XP
  ⭐ Patrick Mahomes Lv.23 (+1 level!)
  🌱 Justin Jefferson Lv.8
```

- Only show if `xpResult.results.length > 0`
- List each NFLmon with level
- Highlight level-ups and evolutions

## Implementation

### Files to Modify

1. **`nflmon/nflmonConfig.ts`**
   - Add `'blackjack_natural'` to `XpSourceId` type
   - Add `blackjack_natural: { min: 6, max: 16 }` to `XP_SOURCES`

2. **`discordCommands/blackjack/blackjack.ts`**
   - Import `nflmonService`
   - Call `addXpToTraining()` in `resolveGame()` after payout logic
   - Add NFLmon Training field to embed

### Code Location

XP award happens in `resolveGame()` function (~line 265), after payout is processed but before building the final embed:

```typescript
// After payout logic
let xpResult: XpResult | null = null;
if (isWin) {
  try {
    const xpSource = isBlackjack ? 'blackjack_natural' : 'blackjack_win';
    xpResult = await nflmonService.addXpToTraining(userId, xpSource);
  } catch (err) {
    console.error('[BLACKJACK] XP award failed:', err);
  }
}
```

### Error Handling

- Wrap XP call in try/catch
- Log errors but don't fail game resolution
- Non-blocking (game completes regardless of XP success)

## Testing

Manual test cases:
1. Win regular hand → 3-8 XP awarded
2. Win with natural blackjack → 6-16 XP awarded
3. Push → No XP
4. Lose → No XP
5. Surrender → No XP
6. Win with no NFLmon in training → No XP field in embed
7. Level-up during win → Shows level-up in embed

## Estimated Scope

~30 lines of code across 2 files
