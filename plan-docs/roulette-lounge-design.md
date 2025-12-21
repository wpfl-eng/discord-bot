# Roulette Lounge Design

**Date:** 2025-12-21
**Status:** Ready for Implementation

## Overview

A dedicated #roulette channel where users can bet coins on American roulette. The wheel spins automatically every 2 minutes when there are active bets, otherwise stays silent.

## Core Requirements

- Full American roulette (0, 00, 1-36) with Vegas standard payouts
- Slash command with autocomplete: `/roulette bet <amount> <type>`
- First bet triggers 2-minute timer; dormant when no bets
- Multiple bets per user per round allowed
- Existing economy limits (10-10,000 per bet)
- NFLmon XP on wins (silent, 3-8 XP range)
- Skip achievements for now (add later)
- Dedicated channel only (env var `ROULETTE_CHANNEL_ID`)
- Hybrid state: in-memory active rounds, database history

---

## File Structure

```
discordCommands/roulette/
├── roulette.ts          # Command handler + autocomplete
├── rouletteGame.ts      # Spin logic, payout calculations
├── rouletteState.ts     # In-memory state, timer management
├── rouletteConfig.ts    # Wheel, bet types, payouts, colors

sql/
└── roulette.sql         # History tables

# Modifications to existing files:
nflmon/nflmonConfig.ts   # Add roulette_win XP source
.env.sample              # Add ROULETTE_CHANNEL_ID
```

---

## State Model

### In-Memory (Active Round)

```typescript
interface RouletteBet {
  userId: string;
  username: string;
  betType: string;      // 'red', 'black', '17', 'first-dozen', etc.
  amount: number;
  placedAt: Date;
}

interface RouletteRound {
  bets: RouletteBet[];
  startedAt: Date;
  timer: NodeJS.Timeout;
  messageId: string;
  channelId: string;
  client: Client;       // For editing message when timer fires
}

// Single active round (or null if dormant)
let activeRound: RouletteRound | null = null;
```

---

## Roulette Configuration

### Wheel Layout

```typescript
export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
export const BLACK_NUMBERS = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];
export const GREEN_NUMBERS = ['0', '00'];

export const WHEEL_POSITIONS = ['0', '00', ...Array.from({length: 36}, (_, i) => String(i + 1))];

export function getColor(num: string): 'red' | 'black' | 'green' {
  if (num === '0' || num === '00') return 'green';
  return RED_NUMBERS.includes(parseInt(num)) ? 'red' : 'black';
}
```

### Vegas Standard Payouts

| Bet Type | Payout | Wins When |
|----------|--------|-----------|
| `red` | 1:1 | Result is red |
| `black` | 1:1 | Result is black |
| `odd` | 1:1 | Result is 1-35 odd (not 0/00) |
| `even` | 1:1 | Result is 2-36 even (not 0/00) |
| `low` | 1:1 | Result is 1-18 |
| `high` | 1:1 | Result is 19-36 |
| `first-dozen` | 2:1 | Result is 1-12 |
| `second-dozen` | 2:1 | Result is 13-24 |
| `third-dozen` | 2:1 | Result is 25-36 |
| `first-column` | 2:1 | Result is 1,4,7,10,13,16,19,22,25,28,31,34 |
| `second-column` | 2:1 | Result is 2,5,8,11,14,17,20,23,26,29,32,35 |
| `third-column` | 2:1 | Result is 3,6,9,12,15,18,21,24,27,30,33,36 |
| `0`, `00`, `1`-`36` | 35:1 | Exact number match |

**Important:** 0 and 00 (green) lose ALL outside bets.

### Payout Calculation

```typescript
// payout is profit multiplier (Vegas standard)
// Bet 100, win on red (1:1): return 200 (100 + 100 profit)
// Bet 100, win on 17 (35:1): return 3600 (100 + 3500 profit)

const totalReturn = bet.amount * (payout + 1);
const profit = bet.amount * payout;
```

---

## Command Structure

```typescript
export const data = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Play roulette in the casino')
  .addSubcommand(sub => sub
    .setName('bet')
    .setDescription('Place a bet on the roulette table')
    .addIntegerOption(opt => opt
      .setName('amount')
      .setDescription('Coins to wager (10-10,000)')
      .setRequired(true)
      .setMinValue(CONFIG.GAMBLE_MIN)
      .setMaxValue(CONFIG.GAMBLE_MAX))
    .addStringOption(opt => opt
      .setName('type')
      .setDescription('What to bet on (red, black, 17, first-dozen, etc.)')
      .setRequired(true)
      .setAutocomplete(true)));
```

### Autocomplete Handler

```typescript
export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const allTypes = [
    'red', 'black', 'odd', 'even', 'low', 'high',
    'first-dozen', 'second-dozen', 'third-dozen',
    'first-column', 'second-column', 'third-column',
    '0', '00', ...Array.from({length: 36}, (_, i) => String(i + 1))
  ];

  const filtered = allTypes
    .filter(t => t.startsWith(focused))
    .slice(0, 25);

  await interaction.respond(filtered.map(t => ({ name: t, value: t })));
}
```

---

## Betting Flow

1. **Channel check** - Not in `ROULETTE_CHANNEL_ID`? Ephemeral: "Head to <#channel> to play!"
2. **Validate bet type** - Unknown? Ephemeral: "Invalid bet type."
3. **Check balance** - `economyDb.getOrCreateUser(userId)`
4. **Deduct coins immediately** - `economyDb.deductFromWallet(userId, amount)`
5. **Add bet to round:**
   - No active round? Create one, post embed, start 2-min timer
   - Active round? Add bet, update existing embed
6. **Confirm bet** - Ephemeral with user's full bet slate for this round

### Ephemeral Confirmation

```
✓ 500 on 🔴 Red

Your bets this round:
• 500 on red
• 100 on 17
Total: 600
```

---

## Timer & Spin Flow

```typescript
// When first bet arrives
function startRound(channelId: string, client: Client, message: Message): void {
  activeRound = {
    bets: [],
    startedAt: new Date(),
    messageId: message.id,
    channelId,
    client,
    timer: setTimeout(() => executeSpinSequence(), 2 * 60 * 1000)
  };
}

async function executeSpinSequence(): Promise<void> {
  // CRITICAL: Capture and clear immediately to prevent race condition
  const round = activeRound;
  activeRound = null;  // New bets start fresh round

  if (!round || round.bets.length === 0) return;

  try {
    const channel = await round.client.channels.fetch(round.channelId);
    const message = await channel.messages.fetch(round.messageId);

    // Step 1: Suspense
    await message.edit({ embeds: [buildSpinningEmbed()] });
    await sleep(2500);

    // Step 2: Generate result
    const resultIndex = Math.floor(Math.random() * 38);
    const resultNumber = WHEEL_POSITIONS[resultIndex];
    const resultColor = getColor(resultNumber);

    // Step 3: Calculate winners & pay out
    const results = await processPayouts(round.bets, resultNumber, resultColor);

    // Step 4: Show results
    await message.edit({ embeds: [buildResultsEmbed(resultNumber, resultColor, results)] });

    // Step 5: Log to database
    await logRoundToDb(resultNumber, resultColor, round.bets, results);

  } catch (err) {
    console.error('Spin sequence failed:', err);
    // Still attempt payouts even if message edit failed
    await processPayouts(round.bets, resultNumber, resultColor);
  }
}
```

---

## Payout Processing

```typescript
async function processPayouts(
  bets: RouletteBet[],
  result: string,
  color: string
): Promise<PayoutResult[]> {
  const results: PayoutResult[] = [];
  const winners = new Set<string>();

  for (const bet of bets) {
    const betDef = BET_TYPES[bet.betType];
    const won = betDef.matches(result, color);

    if (won) {
      const profit = bet.amount * betDef.payout;
      const totalReturn = bet.amount + profit;

      try {
        await economyDb.addToWallet(bet.userId, totalReturn);
        winners.add(bet.userId);
        results.push({ ...bet, won: true, profit, totalReturn });
      } catch (err) {
        console.error(`PAYOUT FAILED: ${bet.userId} owed ${totalReturn}`, err);
        // Log for manual intervention
      }
    } else {
      results.push({ ...bet, won: false, profit: 0, totalReturn: 0 });
    }
  }

  // Award XP once per winner (silent)
  for (const userId of winners) {
    try {
      await nflmonService.addXpToTraining(userId, 'roulette_win');
    } catch (err) {
      console.error(`XP award failed for ${userId}:`, err);
    }
  }

  return results;
}
```

---

## Embed Designs

### Active Round (only shows bets that exist)

```
🎰 ROULETTE
━━━━━━━━━━━━━━━━━
⏱️ Spins <t:1703187600:R>

🔴 Red — @user1 500, @user2 1K
⚫ Black — @user3 250
17 — @user1 100

💰 1,850 on the table
```

**Color:** Blue (`0x3498db`)

### Spinning

```
🎰 ROULETTE
━━━━━━━━━━━━━━━━━

   🎲 Spinning...
```

**Color:** Gold (`0xf1c40f`)

### Results (winners only)

```
🎰 17 BLACK
━━━━━━━━━━━━━━━━━

🏆 @user1 +3,500 (17 @ 35:1)
🏆 @user3 +250 (black)

💸 Paid 3,750 from 1,850 wagered
```

**Color:** Green (`0x2ecc71`)

### Results (no winners)

```
🎰 23 RED
━━━━━━━━━━━━━━━━━

House wins! 💰 Kept 1,850
```

**Color:** Red (`0xe74c3c`)

### Overflow Handling

```typescript
const MAX_PER_GROUP = 8;
if (bettors.length > MAX_PER_GROUP) {
  display = bettors.slice(0, MAX_PER_GROUP).join(', ');
  display += ` +${bettors.length - MAX_PER_GROUP} more`;
}
```

### Amount Formatting

Use abbreviated amounts: `500`, `1K`, `2.5K`, `10K`

---

## Database Schema

```sql
-- Completed rounds history
CREATE TABLE IF NOT EXISTS roulette_rounds (
    id SERIAL PRIMARY KEY,
    result_number VARCHAR(2) NOT NULL,
    result_color VARCHAR(5) NOT NULL,
    total_wagered INTEGER NOT NULL,
    total_paid INTEGER NOT NULL,
    bet_count INTEGER NOT NULL,
    player_count INTEGER NOT NULL,
    spun_at TIMESTAMP DEFAULT NOW()
);

-- Individual bet history
CREATE TABLE IF NOT EXISTS roulette_bets (
    id SERIAL PRIMARY KEY,
    round_id INTEGER REFERENCES roulette_rounds(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    bet_type VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,
    won BOOLEAN NOT NULL,
    returned INTEGER NOT NULL DEFAULT 0,
    placed_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_roulette_rounds_spun_at ON roulette_rounds(spun_at DESC);
CREATE INDEX idx_roulette_bets_user_id ON roulette_bets(user_id);
CREATE INDEX idx_roulette_bets_round_id ON roulette_bets(round_id);
CREATE INDEX idx_roulette_bets_user_bet ON roulette_bets(user_id, bet_type);
```

### Column Semantics

- `returned`: Total coins returned to player (0 if lost, amount+profit if won)
- Net profit calculation: `SUM(returned) - SUM(amount)`

### Example Data

```sql
-- Win 100 on red:  amount=100, won=true, returned=200
-- Lose 100 on red: amount=100, won=false, returned=0
-- Win 100 on 17:   amount=100, won=true, returned=3600
```

---

## NFLmon XP Integration

### Config Addition

```typescript
// In nflmon/nflmonConfig.ts
export const XP_SOURCES = {
  wordle_win: { min: 10, max: 20 },
  wordle_first: { min: 25, max: 35 },
  trivia_correct: { min: 5, max: 15 },
  blackjack_win: { min: 3, max: 8 },
  roulette_win: { min: 3, max: 8 },  // ADD THIS
} as const;
```

### Award Logic

- XP awarded **once per winning player per round** (not per bet)
- Silent - not shown in results embed
- Non-blocking - XP failures don't affect coin payouts

---

## Environment & Deployment

### New Environment Variable

```bash
# .env.sample
ROULETTE_CHANNEL_ID=123456789012345678
```

### Startup Validation

```typescript
const rouletteChannelId = process.env.ROULETTE_CHANNEL_ID;
if (rouletteChannelId) {
  try {
    const channel = await client.channels.fetch(rouletteChannelId);
    console.log(`✓ Roulette channel: #${channel.name}`);
  } catch {
    console.warn(`⚠ ROULETTE_CHANNEL_ID not accessible`);
  }
} else {
  console.warn('⚠ ROULETTE_CHANNEL_ID not set - roulette disabled');
}
```

### Deployment Checklist

1. [ ] Add `ROULETTE_CHANNEL_ID` to production env
2. [ ] Run `sql/roulette.sql` against production DB
3. [ ] Deploy new code
4. [ ] Run `npx tsx deploy-commands.ts`
5. [ ] Test with small bet in #roulette channel

---

## Edge Cases Handled

### Critical

| Edge Case | Solution |
|-----------|----------|
| Bet placed during spin (race condition) | Capture and clear `activeRound` at START of spin |
| Bot restart mid-round | Bets lost (acceptable trade-off for in-memory state) |

### Important

| Edge Case | Solution |
|-----------|----------|
| Channel/message deleted mid-round | Try/catch; still process payouts |
| Individual payout fails | Try/catch per bet; log for manual intervention |
| XP award fails | Separate try/catch; don't block coin payout |
| User rapid-fires bets | Each deduct is atomic; second bet fails if insufficient |

### Nice to Have

| Edge Case | Solution |
|-----------|----------|
| Many bets overflow embed | Truncate with "+N more" after 8 per type |
| Countdown visibility | Discord timestamp `<t:UNIX:R>` auto-updates |
| Invalid channel ID | Validate on startup, log warning |

---

## Future Enhancements (Not in MVP)

- `/roulette stats` - Personal history, biggest wins, favorite bet
- `/roulette leaderboard` - Net profit rankings
- Hot/cold numbers display
- Roulette-specific achievements
- Split/street/corner bets (complex inside bets)
