# Blackjack Vegas Features Design

**Date:** 2025-12-21
**Status:** Approved
**Branch:** bj-bs

## Overview

Add full Vegas-style blackjack features to `/blackjack` command including table selection, split pairs, insurance, even money, dealer peek, and soft 17 rules.

## Goals

- Maximum Vegas accuracy
- Backwards compatible (Classic table = current behavior)
- User-selectable table rules per game

## Feature Summary

| Feature | Table | Complexity |
|---------|-------|------------|
| Table Selection | Both | Low |
| Multi-deck (6) | Vegas | Low |
| Soft 17 (H17) | Vegas | Low |
| Split Pairs | Both | High |
| Insurance | Both | Medium |
| Even Money | Both | Low |
| Dealer Peek | Both | Medium |

## Table Configurations

| Table | Decks | Soft 17 | Default |
|-------|-------|---------|---------|
| Classic | 1 | Stand (S17) | Yes |
| Vegas Strip | 6 | Hit (H17) | No |

## Command Changes

```typescript
.addStringOption((option) =>
  option
    .setName('table')
    .setDescription('Table rules (default: classic)')
    .setRequired(false)
    .addChoices(
      { name: 'Classic (1 deck, S17) - Best odds', value: 'classic' },
      { name: 'Vegas Strip (6 deck, H17)', value: 'vegas' }
    )
)
```

## Files to Modify

| File | Changes |
|------|---------|
| `discordCommands/blackjack/blackjack.ts` | Command, flow, buttons, embeds, state |
| `discordCommands/blackjack/blackjackUtils.ts` | `createDeck()`, `canSplitExactMatch()`, `shouldDealerHit()` |

## State Changes

### Migration

| Old Field | New Field | Notes |
|-----------|-----------|-------|
| `bet` | `mainHandBet` | Main hand bet (increases with double) |
| `doubledDown` | `mainHandDoubled` | Renamed for split clarity |

### New GameState

```typescript
interface GameState {
  // Core (kept)
  deck: Deck;
  playerHand: Hand;
  dealerHand: Hand;
  originalBet: number;
  phase: 'playing' | 'dealer_turn' | 'finished';
  hasHit: boolean;
  canSurrender: boolean;
  surrendered?: boolean;

  // Table (new)
  table: TableConfig;

  // Bets (refactored)
  mainHandBet: number;
  splitHandBet: number;

  // Split (new)
  splitHand: Hand | null;
  playingSplitHand: boolean;
  mainHandDoubled: boolean;
  splitHandDoubled: boolean;
  mainHandResult: 'playing' | 'stood' | 'busted' | null;
  splitHandResult: 'playing' | 'stood' | 'busted' | null;
  wasSplitAces: boolean;

  // Insurance (new)
  insuranceBet: number;
  insurancePromptPending: boolean;
  evenMoneyPromptPending: boolean;
  evenMoneyTaken: boolean;
}

interface TableConfig {
  readonly name: 'classic' | 'vegas';
  readonly displayName: string;
  readonly deckCount: number;
  readonly dealerHitsSoft17: boolean;
}
```

## Button IDs

**Existing:**
- `blackjack_hit`
- `blackjack_stand`
- `blackjack_double`
- `blackjack_surrender`
- `blackjack_replay_${amount}`

**New:**
- `blackjack_split`
- `blackjack_insurance_yes`
- `blackjack_insurance_no`
- `blackjack_even_money_yes`
- `blackjack_even_money_no`

## Button State Logic

| Game State | Buttons Shown |
|------------|---------------|
| Insurance prompt | `Take Insurance` `No Insurance` |
| Even money prompt | `Even Money` `Risk for 3:2` |
| Normal play (can split, can surrender) | `Hit` `Stand` `Double` `Split` `Surrender` |
| Normal play (can't split) | `Hit` `Stand` `Double` `Surrender` |
| After first hit | `Hit` `Stand` |
| Split play (first action on hand) | `Hit` `Stand` `Double` |
| Split play (after hit) | `Hit` `Stand` |
| Game over | All disabled + `Play Again` |

## Timeout Behavior

| State | Default Action |
|-------|----------------|
| Insurance prompt | No Insurance |
| Even money prompt | Risk for 3:2 |
| Normal play | Auto-stand |
| Split play | Auto-stand all remaining hands |

## Feature Details

### Split Rules (Simplified)

- Exact rank match only (8-8, K-K, not K-Q)
- No re-splitting (max 2 hands)
- Double after split allowed
- Split aces get 1 card each, auto-stand
- 21 after split pays 1:1, not 3:2
- Surrender disabled after split

### Insurance

- Offered when dealer shows Ace
- Costs half original bet
- Pays 2:1 if dealer has blackjack
- Lost if dealer doesn't have blackjack
- Not offered if player can't afford

### Even Money

- Offered when player has blackjack vs dealer Ace
- Immediate 1:1 payout (guaranteed)
- Alternative: risk for 3:2 (dealer may also have BJ = push)

### Dealer Peek

- Silent peek when dealer shows 10 or Ace
- Only announced if dealer has blackjack
- Prevents player from losing double/split bets to hidden BJ

### Soft 17 Rule

- Classic (S17): Dealer stands on all 17s
- Vegas (H17): Dealer hits soft 17 (A-6)

## Stats & XP Recording

**Split Stats:** Record two separate game results, both with `wasSplit=true`

**NFLmon XP:** Award once per game based on net outcome (win any hand = XP)

## Split Resolution Display

```
**Hand 1:** 8♠ 5♥ 7♣ *(20)* - WON
**Hand 2:** 8♥ K♦ *(18)* - LOST

Bet: 🪙 100 per hand
Hand 1: +🪙 200 | Hand 2: -🪙 100
Net: +🪙 100
Balance: 🪙 1,500
```

## Implementation Order

### Phase 1: Foundation (Low Risk)

1. Add TableConfig type and TABLES constant
2. Add table option to slash command (default: classic)
3. Update createDeck(deckCount)
4. Add shouldDealerHit() function
5. Update playDealerTurn() to use shouldDealerHit()
6. Store table in GameState
7. Add table name to embed title
8. **TEST:** Classic table identical to current behavior

### Phase 2: Dealer Peek (Medium Risk)

1. Restructure post-deal flow for peek timing
2. Implement silent peek for 10-value upcard
3. Integrate peek with natural blackjack detection
4. **TEST:** Dealer BJ revealed correctly, player not charged extra

### Phase 3: Insurance (Medium Risk)

1. Add insurance state fields
2. Implement insurance prompt UI and collector
3. Implement even money prompt for player BJ
4. Handle timeout defaults (no insurance, risk 3:2)
5. Wire insurance payout (2:1) into resolution
6. Add affordability check for insurance
7. **TEST:** Insurance pays correctly, even money works

### Phase 4a: Split Foundation (Medium Risk)

1. Add canSplitExactMatch() function
2. Add split state fields to GameState
3. Add Split button (when valid and affordable)
4. Implement hand separation on split
5. **TEST:** Split button appears for pairs, creates two hands

### Phase 4b: Split Gameplay (High Risk)

1. Implement hand-switching logic (main → split)
2. Update embed display for active hand indicator
3. Implement double after split
4. Disable surrender after split
5. Handle bust on Hand 1 → switch to Hand 2
6. **TEST:** Can play both hands, double works on split

### Phase 4c: Split Edge Cases (High Risk)

1. Implement split aces (1 card each, auto-stand)
2. Handle both hands bust (skip dealer turn)
3. 21 after split pays 1:1, not 3:2
4. Update resolution for split payouts
5. Record two stats entries for split games
6. Award XP once based on net outcome
7. **TEST:** All split edge cases work correctly

### Phase 5: Polish (Low Risk)

1. Ensure Play Again remembers table choice
2. Handle timeout during split (auto-stand remaining)
3. Final UI polish
4. Deploy commands: `npx tsx deploy-commands.ts`

## Testing Checklist

### Table Selection
- [ ] Classic table plays identical to current
- [ ] Vegas uses 6 decks
- [ ] Vegas dealer hits soft 17
- [ ] Default is Classic when not specified
- [ ] Play Again remembers table

### Dealer Peek
- [ ] Silent peek on dealer 10
- [ ] Silent peek on dealer Ace (after insurance)
- [ ] Player BJ + Dealer BJ = Push
- [ ] Player doesn't lose double/split bet to hidden BJ

### Insurance
- [ ] Offered when dealer shows Ace
- [ ] Not offered if can't afford
- [ ] Pays 2:1 when dealer has BJ
- [ ] Lost when dealer doesn't have BJ
- [ ] Timeout defaults to no insurance

### Even Money
- [ ] Offered when player BJ vs dealer Ace
- [ ] Pays 1:1 immediately
- [ ] Declining + dealer BJ = Push
- [ ] Declining + no dealer BJ = 3:2
- [ ] Timeout defaults to risk 3:2

### Split
- [ ] Only exact rank matches (8-8, K-K, not K-Q)
- [ ] Requires funds to match bet
- [ ] Can't split after hitting
- [ ] Creates two hands correctly
- [ ] Hand 1 plays first, then Hand 2
- [ ] Active hand indicator shows correctly
- [ ] Double after split works
- [ ] Surrender disabled after split
- [ ] Split aces get 1 card, auto-stand
- [ ] 21 after split pays 1:1
- [ ] Both bust skips dealer turn
- [ ] Timeout auto-stands remaining hands
- [ ] Two stats records created
- [ ] XP awarded once on net win

## Existing Utilities (in blackjackUtils.ts)

These functions already exist and can be reused:
- `dealerShowsAce()` - line 197
- `dealerShowsTen()` - line 204
- `shouldDealerPeek()` - line 212
- `calculateInsuranceBet()` - line 221
- `canSplit()` - line 187 (needs replacement with exact match version)
- `getSplitValue()` - line 177
- `isSoft()` - line 112
