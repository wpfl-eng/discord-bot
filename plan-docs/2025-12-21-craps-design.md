# Craps Discord Game - Design Document

**Date:** 2025-12-21
**Status:** Draft
**Author:** Claude + AJ

---

## 1. Overview

### What We're Building
A multiplayer craps game for the `#craps` Discord channel. The table activates on-demand when a player places a bet, runs continuously while there's action, and goes cold when all bets resolve and no new bets arrive.

### Why Craps
- **Social:** The loudest table in the casino - shared fate creates community
- **Strategic:** Multiple bet types with different risk/reward profiles
- **Exciting:** Multi-roll sessions build tension; hot streaks are legendary
- **Missing:** We have cards (blackjack, video poker), wheel (roulette), machine (slots) - no dice game

### Design Principles
1. **Authentic rules** - Real craps mechanics, correctly implemented
2. **Theater matters** - Public announcements, shooter callouts, streak tracking
3. **Clean resolution** - All bets resolve before table goes cold, no orphans
4. **Extensible** - Architecture supports adding bets in phases

---

## 2. Game Rules

### Craps Fundamentals

**Come-Out Roll:**
- Roll 7 or 11 → "Natural" - Pass Line wins immediately
- Roll 2, 3, or 12 → "Craps" - Pass Line loses immediately
- Roll 4, 5, 6, 8, 9, or 10 → That number becomes "the Point"

**Point Phase:**
- Shooter keeps rolling until:
  - Point is hit → Pass Line wins
  - 7 is rolled → "Seven-Out" - Pass Line loses, session ends

### Our Adaptations
- **No physical shooter:** Bot rolls dice, but we announce a "shooter" (first bettor) for flavor
- **Session-based:** Each come-out through resolution is one session
- **Place bets return:** When point hits (not seven-out), Place bets are returned, not lost

---

## 3. Bet Types (MVP)

### 3.1 Pass Line
| Attribute | Value |
|-----------|-------|
| Payout | 1:1 |
| House Edge | 1.41% |
| When to Place | Come-out phase only |
| Wins | 7 or 11 on come-out, OR point hit |
| Loses | 2, 3, or 12 on come-out, OR seven-out |

### 3.2 Don't Pass
| Attribute | Value |
|-----------|-------|
| Payout | 1:1 |
| House Edge | 1.36% |
| When to Place | Come-out phase only |
| Wins | 2 or 3 on come-out, OR seven-out |
| Loses | 7 or 11 on come-out, OR point hit |
| Special | **12 on come-out = PUSH** (bet returned) |

### 3.3 Field
| Attribute | Value |
|-----------|-------|
| Payout | 1:1 (2:1 on 2, 3:1 on 12) |
| House Edge | 5.56% |
| When to Place | Any betting phase |
| Wins | 2, 3, 4, 9, 10, 11, 12 |
| Loses | 5, 6, 7, 8 |
| Behavior | One-roll bet, resolves immediately |

### 3.4 Place 6 / Place 8
| Attribute | Value |
|-----------|-------|
| Payout | 7:6 |
| House Edge | 1.52% |
| When to Place | Point phase only |
| Wins | When the number is rolled |
| Loses | Seven-out (roll of 7) |
| Special | **Wins and STAYS** - can win multiple times per session |
| On Point Hit | **RETURNED** (push) - not lost |

---

## 4. State Machine

### 4.1 States

```
┌─────────┐
│  IDLE   │  Table is cold. No active session. Waiting for first bet.
└─────────┘

┌─────────┐
│ BETTING │  Accepting bets. Timer counting down. Point may or may not be set.
└─────────┘

┌─────────┐
│ ROLLING │  Dice in the air. No bets accepted. Brief animation (2-3s).
└─────────┘

┌─────────┐
│ RESOLVED│  Payouts processed. Transitioning to next state.
└─────────┘
```

### 4.2 State Data

```typescript
interface CrapsTableState {
  status: 'idle' | 'betting' | 'rolling' | 'resolved';
  point: number | null;           // null = come-out phase, number = point phase
  shooter: {                       // Flavor only - first bettor of session
    userId: string;
    username: string;
  } | null;
  rollHistory: Roll[];            // All rolls this session
  bets: CrapsBet[];               // All active bets
  sessionStats: {
    rollCount: number;
    startedAt: Date;
    totalWagered: number;
  };
  tableMessage: Message | null;   // The live-updating embed
  bettingTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
}

interface Roll {
  die1: number;  // 1-6
  die2: number;  // 1-6
  total: number; // 2-12
  timestamp: Date;
}

interface CrapsBet {
  odal visually: string;
  odal: string;
  username: string;
  odal: BetType;
  amount: number;
  placedAt: Date;
  status: 'active' | 'won' | 'lost' | 'push';
  payout?: number;
}

type BetType = 'pass_line' | 'dont_pass' | 'field' | 'place_6' | 'place_8';
```

### 4.3 Transitions

```
IDLE ──[/craps bet]──► BETTING (come-out, 45s timer)
                           │
                           │ timer expires
                           ▼
                       ROLLING
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
     Natural 7/11      Craps 2/3/12     Point 4-10
         │                 │                 │
         ▼                 ▼                 ▼
     RESOLVED          RESOLVED          BETTING (point phase, 15s)
         │                 │                 │
         │                 │                 │ timer expires
         │                 │                 ▼
         │                 │             ROLLING
         │                 │                 │
         │                 │    ┌────────────┼────────────┐
         │                 │    │            │            │
         │                 │   7 out     Point hit    Other
         │                 │    │            │            │
         │                 │    ▼            ▼            │
         │                 │ RESOLVED    RESOLVED         │
         │                 │    │            │            │
         └────────┬────────┴────┴────────────┘            │
                  │                                       │
                  ▼                                       │
           Grace Period (15s)                             │
                  │                                       │
      ┌───────────┴───────────┐                          │
      │                       │                          │
   no bets                new bet                        │
      │                       │                          │
      ▼                       ▼                          │
    IDLE               BETTING (come-out)                │
                                                         │
                  ◄───────────────[loop]─────────────────┘
```

---

## 5. Theater Elements

### 5.1 Public Bet Announcements
Every bet placement posts a public message (not ephemeral):

```
🎲 @AJ throws $1,000 on the PASS LINE!
```

```
🎲 @Nixon slides $500 on DON'T PASS... betting against the table! 👀
```

```
🎲 @Adler drops $300 on PLACE 6
```

```
🎲 @Simpson puts $100 on the FIELD - one roll, let's go!
```

### 5.2 Shooter Announcement
First bettor of a session becomes the "shooter" (cosmetic only):

```
🎲 @AJ has the dice!
```

On come-out roll:
```
🎲 @AJ rolls the come-out...

⚃ ⚄

NINE! The point is 9!
```

### 5.3 Hot Streak Counter
Track consecutive rolls without seven-out during point phase:

| Rolls | Announcement |
|-------|--------------|
| 5 | 🔥 Table is heating up! 5 rolls! |
| 8 | 🔥🔥 HOT TABLE! 8 rolls and counting! |
| 12 | 🔥🔥🔥 MONSTER ROLL! 12 rolls! |
| 15+ | 🔥🔥🔥🔥 LEGENDARY! @Shooter is on FIRE! |

### 5.4 Table Open Announcement
When table transitions from IDLE to BETTING:

```
🎲━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎲
         THE CRAPS TABLE IS NOW OPEN!
   @AJ started the action. Who else is in?

   Use /craps bet <amount> <type> to join!

   🎯 Rolling in 45 seconds...
🎲━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎲
```

### 5.5 Session End Announcements

**Seven-Out:**
```
💀 SEVEN OUT! 💀

The table lasted 8 rolls.

📊 Session Results:
@AJ: -$1,500 (Pass Line, Place 6)
@Nixon: +$800 (Don't Pass, Field)
@Adler: -$300 (Place 8)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏳ Table cooling down... /craps bet to keep it hot!
```

**Point Hit:**
```
🎉 POINT HIT! 🎉

@AJ hit the 9!

📊 Session Results:
@AJ: +$1,000 (Pass Line)
@Nixon: -$500 (Don't Pass)
@Adler: $0 (Place 8 returned)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏳ Table cooling down... /craps bet to keep it hot!
```

---

## 6. Session Lifecycle

### 6.1 Complete Flow

```
1. TABLE IS IDLE (cold)
   └─► User runs: /craps bet 1000 pass_line

2. TABLE OPENS
   └─► Post "Table is now open!" announcement
   └─► Post table embed (updating)
   └─► Start 45s betting timer
   └─► Mark user as "shooter"

3. BETTING PHASE (come-out)
   └─► Accept: pass_line, dont_pass, field
   └─► Reject: place_6, place_8 (point not set)
   └─► Each bet extends timer by 5s (max 60s)
   └─► Update table embed with each bet

4. TIMER EXPIRES
   └─► Lock betting
   └─► Post roll animation

5. COME-OUT RESULT
   ├─► 7 or 11 (Natural): Pass wins → RESOLVE → Grace
   ├─► 2, 3, 12 (Craps): Pass loses (12=push on Don't) → RESOLVE → Grace
   └─► 4,5,6,8,9,10: Set point → POINT PHASE

6. POINT PHASE
   └─► Accept: field, place_6, place_8
   └─► Reject: pass_line, dont_pass (already set)
   └─► 15s betting windows between rolls

7. POINT PHASE ROLL
   ├─► Roll = 7: SEVEN OUT - all bets resolve → Grace
   ├─► Roll = Point: POINT HIT - line bets resolve, places return → Grace
   ├─► Roll = 6: Place 6 pays, stays active, continue
   ├─► Roll = 8: Place 8 pays, stays active, continue
   └─► Roll = other: Field resolves if active, continue

8. GRACE PERIOD (15s)
   ├─► New bet arrives → Back to step 2 (new session)
   └─► No bets → TABLE GOES IDLE
```

### 6.2 Timing Configuration

```typescript
const TIMING = {
  COMEOUT_BETTING_SECONDS: 45,    // Initial come-out betting window
  POINT_BETTING_SECONDS: 15,      // Betting window between point rolls
  BET_EXTENDS_TIMER_BY: 5,        // Each new bet adds this much time
  MAX_BETTING_SECONDS: 60,        // Cap on betting window
  ROLL_ANIMATION_MS: 2500,        // Dice rolling display time
  RESULT_DISPLAY_MS: 3000,        // Show result before next phase
  GRACE_PERIOD_SECONDS: 15,       // Time before table goes cold
} as const;
```

---

## 7. Bet Resolution Matrix

### 7.1 Come-Out Roll Resolutions

| Roll | Pass Line | Don't Pass | Field |
|------|-----------|------------|-------|
| 2 | LOSE | WIN | WIN (2:1) |
| 3 | LOSE | WIN | WIN |
| 4 | Point set | Point set | WIN |
| 5 | Point set | Point set | LOSE |
| 6 | Point set | Point set | LOSE |
| 7 | WIN | LOSE | LOSE |
| 8 | Point set | Point set | LOSE |
| 9 | Point set | Point set | WIN |
| 10 | Point set | Point set | WIN |
| 11 | WIN | LOSE | WIN |
| 12 | LOSE | **PUSH** | WIN (3:1) |

### 7.2 Point Phase Roll Resolutions

| Roll | Pass Line | Don't Pass | Field | Place 6 | Place 8 |
|------|-----------|------------|-------|---------|---------|
| 2 | - | - | WIN (2:1) | - | - |
| 3 | - | - | WIN | - | - |
| 4 | WIN if point=4 | LOSE if point=4 | WIN | - | - |
| 5 | WIN if point=5 | LOSE if point=5 | LOSE | - | - |
| 6 | WIN if point=6 | LOSE if point=6 | LOSE | **WIN (stays)** | - |
| 7 | **LOSE** | **WIN** | LOSE | **LOSE** | **LOSE** |
| 8 | WIN if point=8 | LOSE if point=8 | LOSE | - | **WIN (stays)** |
| 9 | WIN if point=9 | LOSE if point=9 | WIN | - | - |
| 10 | WIN if point=10 | LOSE if point=10 | WIN | - | - |
| 11 | - | - | WIN | - | - |
| 12 | - | - | WIN (3:1) | - | - |

### 7.3 Session End Resolution

| Event | Pass Line | Don't Pass | Place 6/8 |
|-------|-----------|------------|-----------|
| Seven-Out | LOSE | WIN | LOSE |
| Point Hit | WIN | LOSE | **RETURN** (push) |
| Natural (come-out) | WIN | LOSE | N/A |
| Craps (come-out) | LOSE | WIN/PUSH | N/A |

**Guarantee:** Every active bet has a defined outcome for every possible game state. No orphaned bets.

---

## 8. Edge Cases

### 8.1 Bet Validation

| Scenario | Response |
|----------|----------|
| Pass Line during point phase | "Pass Line bets can only be placed during come-out" |
| Place bet during come-out | "Place bets require a point to be established" |
| Bet during ROLLING state | "Dice are in the air! Wait for the next betting window" |
| Insufficient funds | "You need $X but only have $Y in your wallet" |
| Exceeds max bet | "Maximum bet is $X" |
| Exceeds total exposure | "You have $X on the table. Max exposure is $Y" |

### 8.2 System Recovery

| Scenario | Resolution |
|----------|------------|
| Bot restart mid-session | Refund all active bets, post apology message, table goes IDLE |
| Channel deleted | Cleanup orphaned session data on next startup |
| Message edit fails | Log error, continue game logic, post new message if needed |
| Database write fails | Retry with backoff; if persistent, refund bet from memory |

### 8.3 Multiple Bets Same Type

| Scenario | Behavior |
|----------|----------|
| User places second Pass Line | Reject: "You already have a Pass Line bet" |
| User places second Field | Allow: Field is one-roll, each is independent |
| User places second Place 6 | Aggregate: Add to existing Place 6 amount |

### 8.4 Payout Calculation

```typescript
function calculatePayout(bet: CrapsBet, roll: Roll, point: number | null): PayoutResult {
  switch (bet.type) {
    case 'pass_line':
      if (point === null) {
        // Come-out
        if ([7, 11].includes(roll.total)) return { outcome: 'win', payout: bet.amount * 2 };
        if ([2, 3, 12].includes(roll.total)) return { outcome: 'lose', payout: 0 };
      } else {
        // Point phase
        if (roll.total === point) return { outcome: 'win', payout: bet.amount * 2 };
        if (roll.total === 7) return { outcome: 'lose', payout: 0 };
      }
      return { outcome: 'pending', payout: 0 };

    case 'dont_pass':
      if (point === null) {
        if ([2, 3].includes(roll.total)) return { outcome: 'win', payout: bet.amount * 2 };
        if (roll.total === 12) return { outcome: 'push', payout: bet.amount };
        if ([7, 11].includes(roll.total)) return { outcome: 'lose', payout: 0 };
      } else {
        if (roll.total === 7) return { outcome: 'win', payout: bet.amount * 2 };
        if (roll.total === point) return { outcome: 'lose', payout: 0 };
      }
      return { outcome: 'pending', payout: 0 };

    case 'field':
      if (roll.total === 2) return { outcome: 'win', payout: bet.amount * 3 }; // 2:1
      if (roll.total === 12) return { outcome: 'win', payout: bet.amount * 4 }; // 3:1
      if ([3, 4, 9, 10, 11].includes(roll.total)) return { outcome: 'win', payout: bet.amount * 2 };
      return { outcome: 'lose', payout: 0 };

    case 'place_6':
    case 'place_8':
      const target = bet.type === 'place_6' ? 6 : 8;
      if (roll.total === target) {
        // 7:6 payout - bet stays active
        const winAmount = Math.floor(bet.amount * 7 / 6);
        return { outcome: 'win_and_stay', payout: winAmount };
      }
      if (roll.total === 7) return { outcome: 'lose', payout: 0 };
      if (point !== null && roll.total === point && roll.total !== target) {
        // Point hit but not our number - return bet
        return { outcome: 'push', payout: bet.amount };
      }
      return { outcome: 'pending', payout: 0 };
  }
}
```

---

## 9. Data Model

### 9.1 Database Schema

```sql
-- Active session snapshots (for crash recovery)
CREATE TABLE craps_sessions (
  id SERIAL PRIMARY KEY,
  channel_id VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  point INTEGER,
  shooter_user_id VARCHAR(32),
  shooter_username VARCHAR(64),
  roll_history JSONB DEFAULT '[]',
  started_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bet snapshots (for crash recovery)
CREATE TABLE craps_active_bets (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES craps_sessions(id),
  user_id VARCHAR(32) NOT NULL,
  username VARCHAR(64) NOT NULL,
  bet_type VARCHAR(16) NOT NULL,
  amount INTEGER NOT NULL,
  placed_at TIMESTAMP DEFAULT NOW()
);

-- Completed session history
CREATE TABLE craps_history (
  id SERIAL PRIMARY KEY,
  channel_id VARCHAR(32) NOT NULL,
  shooter_user_id VARCHAR(32),
  shooter_username VARCHAR(64),
  point INTEGER,
  roll_count INTEGER NOT NULL,
  outcome VARCHAR(16) NOT NULL, -- 'natural', 'craps', 'point_hit', 'seven_out'
  total_wagered INTEGER NOT NULL,
  total_paid INTEGER NOT NULL,
  roll_history JSONB NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP DEFAULT NOW()
);

-- Player statistics
CREATE TABLE craps_stats (
  user_id VARCHAR(32) PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  sessions_played INTEGER DEFAULT 0,
  total_wagered BIGINT DEFAULT 0,
  total_won BIGINT DEFAULT 0,
  total_lost BIGINT DEFAULT 0,
  pass_line_wins INTEGER DEFAULT 0,
  pass_line_losses INTEGER DEFAULT 0,
  dont_pass_wins INTEGER DEFAULT 0,
  seven_outs_witnessed INTEGER DEFAULT 0,
  points_hit_witnessed INTEGER DEFAULT 0,
  longest_roll_witnessed INTEGER DEFAULT 0,
  biggest_single_win INTEGER DEFAULT 0,
  biggest_session_win INTEGER DEFAULT 0,
  biggest_session_loss INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 9.2 TypeScript Interfaces

```typescript
// Config
interface BetTypeConfig {
  id: BetType;
  name: string;
  description: string;
  payout: [number, number]; // [win, wager] e.g., [7, 6] for 7:6
  houseEdge: number;
  phase: 'comeout' | 'point' | 'any';
  type: 'one-roll' | 'multi-roll';
  winsOn: number[];
  losesOn: number[];
  staysOnWin: boolean;
}

// State
interface CrapsTableState {
  status: TableStatus;
  point: number | null;
  shooter: ShooterInfo | null;
  rollHistory: Roll[];
  bets: CrapsBet[];
  sessionStats: SessionStats;
  tableMessage: Message | null;
  bettingTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
  channelId: string;
}

type TableStatus = 'idle' | 'betting' | 'rolling' | 'resolved';

interface ShooterInfo {
  userId: string;
  username: string;
}

interface Roll {
  die1: number;
  die2: number;
  total: number;
  timestamp: Date;
}

interface CrapsBet {
  id: string;
  odal visually: string;
  odal: string;
  username: string;
  type: BetType;
  amount: number;
  placedAt: Date;
  status: BetStatus;
  payout?: number;
}

type BetStatus = 'active' | 'won' | 'lost' | 'push';

interface SessionStats {
  rollCount: number;
  startedAt: Date;
  totalWagered: number;
  hotStreak: number; // consecutive point-phase rolls
}

// Results
interface PayoutResult {
  outcome: 'win' | 'lose' | 'push' | 'win_and_stay' | 'pending';
  payout: number;
}

interface SessionResult {
  odal visually: string;
  odal: string;
  username: string;
  netResult: number;
  breakdown: {
    betType: BetType;
    amount: number;
    outcome: 'won' | 'lost' | 'push';
    payout: number;
  }[];
}
```

---

## 10. File Structure

```
/discordCommands/craps/
├── craps.ts              # Main command handler
│                         # - /craps bet <amount> <type>
│                         # - /craps status
│                         # - /craps leave (take down place bets)
│
├── crapsConfig.ts        # Constants and bet type definitions
│                         # - TIMING constants
│                         # - BET_TYPES object
│                         # - LIMITS (min, max, exposure)
│
├── crapsState.ts         # Table state machine
│                         # - In-memory state
│                         # - Timer management
│                         # - State transitions
│                         # - Bet collection
│
├── crapsEngine.ts        # Game logic
│                         # - rollDice()
│                         # - resolveBets()
│                         # - calculatePayout()
│                         # - determineSessionOutcome()
│
└── crapsEmbed.ts         # Discord embed builders
                          # - buildTableEmbed()
                          # - buildRollEmbed()
                          # - buildResultsEmbed()
                          # - buildAnnouncementEmbed()

/discordCommands/crapsstats/
└── crapsstats.ts         # Player statistics command

/discordCommands/crapsleaderboard/
└── crapsleaderboard.ts   # Leaderboard command

/craps/
└── crapsDb.ts            # Database operations
                          # - Session CRUD
                          # - Stats tracking
                          # - History logging
                          # - Crash recovery
```

---

## 11. Commands

### 11.1 /craps bet

```typescript
.addSubcommand(sub => sub
  .setName('bet')
  .setDescription('Place a bet on the craps table')
  .addIntegerOption(opt => opt
    .setName('amount')
    .setDescription('Amount to wager')
    .setRequired(true)
    .setMinValue(CONFIG.CRAPS_MIN)
    .setMaxValue(CONFIG.CRAPS_MAX))
  .addStringOption(opt => opt
    .setName('type')
    .setDescription('Type of bet')
    .setRequired(true)
    .addChoices(
      { name: 'Pass Line', value: 'pass_line' },
      { name: "Don't Pass", value: 'dont_pass' },
      { name: 'Field', value: 'field' },
      { name: 'Place 6', value: 'place_6' },
      { name: 'Place 8', value: 'place_8' }
    )))
```

### 11.2 /craps status

Show current table state without placing a bet.

### 11.3 /craps history

Show last N rolls and session outcomes.

### 11.4 /crapsstats

Personal statistics with optional user mention.

### 11.5 /crapsleaderboard

Top players by net winnings, sessions, biggest wins.

---

## 12. Embed Designs

### 12.1 Table Embed (Betting Phase - Come-out)

```
🎲 CRAPS TABLE                    ⏱️ Rolling in 23s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 @AJ has the dice!

PASS LINE │ $2,750
          │ @AJ $1,000 • @Nixon $750 • @Adler $1,000

DON'T PASS │ $500
           │ @Simpson $500

FIELD │ $200
      │ @Ellis $200

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Total Action: $3,450
```

### 12.2 Table Embed (Point Phase)

```
🎲 CRAPS TABLE                    📍 POINT IS 8
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 @AJ shooting                   ⏱️ Rolling in 12s
🔥 5 rolls!

Last Roll: ⚃ ⚁ = 6

PASS LINE │ $2,750 → waiting for 8
          │ @AJ $1,000 • @Nixon $750 • @Adler $1,000

DON'T PASS │ $500 → waiting for 7
           │ @Simpson $500

PLACE 6 │ $600
        │ @Nixon $300 • @Ellis $300

PLACE 8 │ $900
        │ @AJ $400 • @Adler $500

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 Rolls: 4 → 6 → 9 → 6 → 10
💰 Total Action: $4,750
```

### 12.3 Roll Result Embed

```
🎲 THE DICE ARE OUT!

       ⚄ ⚂

       SEVEN!

💀 SEVEN OUT! 💀
```

### 12.4 Session Results Embed

```
📊 SESSION RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@AJ
  ❌ Pass Line: -$1,000
  ❌ Place 8: -$400
  Net: -$1,400

@Nixon
  ❌ Pass Line: -$750
  ✅ Place 6 (×2): +$700
  Net: -$50

@Simpson
  ✅ Don't Pass: +$500
  Net: +$500

@Adler
  ❌ Pass Line: -$1,000
  ❌ Place 8: -$500
  Net: -$1,500

@Ellis
  ✅ Place 6 (×2): +$700
  Net: +$700

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Session: 8 rolls | $4,750 wagered
⏳ Table cooling... /craps bet to continue!
```

---

## 13. Extension Points

### Phase 2: More Place Bets
```typescript
// Just add to BET_TYPES config:
place_4: { payout: [9, 5], phase: 'point', ... },
place_5: { payout: [7, 5], phase: 'point', ... },
place_9: { payout: [7, 5], phase: 'point', ... },
place_10: { payout: [9, 5], phase: 'point', ... },
```

### Phase 3: Come / Don't Come
```typescript
// Add comePoint to CrapsBet interface:
interface CrapsBet {
  ...
  comePoint?: number; // For come bets that establish their own point
}
// Resolution logic checks bet's comePoint instead of table point
```

### Phase 4: Odds Bets
```typescript
// Attach to existing line bets:
interface CrapsBet {
  ...
  oddsBet?: number; // Amount behind the line
}
// 0% house edge, true odds payout
```

### Phase 5: Proposition Bets
```typescript
// One-roll bets:
any_7: { payout: [4, 1], phase: 'any', type: 'one-roll', winsOn: [7] },
any_craps: { payout: [7, 1], phase: 'any', type: 'one-roll', winsOn: [2, 3, 12] },
hard_6: { payout: [9, 1], phase: 'point', type: 'multi-roll', winsOn: [6], losesOn: [7], requiresHard: true },
```

### Phase 6: Press / Take Down
```typescript
// After place bet wins, offer buttons:
// [Press (Double)] [Take Down] [Let It Ride]
// Adds mid-session decisions
```

---

## 14. Testing Scenarios

### 14.1 Happy Paths
- [ ] Place Pass Line on cold table → table activates, come-out phase
- [ ] Natural 7 on come-out → Pass wins, session ends, grace period
- [ ] Point established (8), rolled 8 → Pass wins, session ends
- [ ] Point established (6), rolled 7 → Seven out, Pass loses, all places lose
- [ ] Place 6 during point, rolled 6 twice → Pays twice, stays active
- [ ] New bet during grace period → New session starts

### 14.2 Edge Cases
- [ ] Place bet attempted during come-out → Rejected with message
- [ ] Pass Line attempted during point phase → Rejected with message
- [ ] Don't Pass with 12 on come-out → PUSH (bet returned)
- [ ] Multiple Field bets by same user → All tracked independently
- [ ] Second Pass Line by same user → Rejected (already have one)
- [ ] Bot restart mid-session → All bets refunded

### 14.3 Resolution Verification
- [ ] Session ends → No active bets remain
- [ ] All payouts sum correctly
- [ ] Stats updated accurately
- [ ] History logged

---

## 15. Implementation Order

1. **crapsConfig.ts** - Constants, bet types, timing
2. **crapsDb.ts** - Schema, basic CRUD, stats
3. **crapsEngine.ts** - rollDice, resolveBets, calculatePayout
4. **crapsState.ts** - State machine, timers
5. **crapsEmbed.ts** - Embed builders
6. **craps.ts** - Command handler, integration
7. **Theater elements** - Public announcements, shooter, streaks
8. **crapsstats.ts** - Stats command
9. **crapsleaderboard.ts** - Leaderboard command
10. **Testing & polish**

---

## 16. Decisions (Finalized)

| Question | Decision |
|----------|----------|
| Channel restriction | **Yes** - `#craps` only via `CRAPS_CHANNEL_ID` env var |
| Max exposure | **50,000** per user per session |
| Spectator count | **No** - only show active bets |
| Dice animation | **Yes** - Unicode dice faces ⚀⚁⚂⚃⚄⚅ |
| Achievements | **Skip** for MVP |

---

## 17. Economy Service Integration

### 17.1 Required Imports

```typescript
import * as economyDb from '../../economy/economyDb.js';
import { CONFIG, formatCurrency } from '../../economy/economyConfig.js';
import type { EconomyUser } from '../../types/database.js';
```

### 17.2 Bet Placement Flow

```typescript
// 1. Get or create user
const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

// 2. Check wallet balance
if (userData.wallet < amount) {
  // Reject: insufficient funds
}

// 3. Check total exposure (50k max)
const currentExposure = getUserTotalBets(userId); // sum of active bets
if (currentExposure + amount > 50000) {
  // Reject: "You have $X on the table. Max exposure is $50,000"
}

// 4. Deduct from wallet ATOMICALLY (like roulette pattern)
const deductResult = await economyDb.deductFromWallet(userId, amount);
if (!deductResult) {
  // Race condition - wallet changed, reject bet
}

// 5. Add bet to state
addBetToSession(bet);
```

### 17.3 Payout Flow

```typescript
// For wins: add total return (original bet + profit)
await economyDb.addToWallet(userId, totalReturn);

// For pushes: return original bet
await economyDb.addToWallet(userId, originalBet);

// For losses: nothing - already deducted when bet was placed
```

### 17.4 Config Additions

Add to `economy/economyConfig.ts`:

```typescript
// In EconomyConfig interface:
readonly CRAPS_MIN: number;
readonly CRAPS_MAX: number;
readonly CRAPS_MAX_EXPOSURE: number;

// In CONFIG object:
CRAPS_MIN: 10,
CRAPS_MAX: 10000,
CRAPS_MAX_EXPOSURE: 50000,
```

---

## 18. Environment Variables

Add to `.env.sample`:

```bash
# Craps
CRAPS_CHANNEL_ID=
```

### Channel Restriction Pattern

```typescript
// In crapsState.ts or crapsConfig.ts:
export function getCrapsChannelId(): string | undefined {
  return process.env.CRAPS_CHANNEL_ID;
}

// In craps.ts command handler:
const crapsChannelId = getCrapsChannelId();
if (!crapsChannelId) {
  await interaction.editReply({ content: 'Craps is not configured. Contact an admin.' });
  return;
}

if (interaction.channelId !== crapsChannelId) {
  await interaction.editReply({ content: `Head to <#${crapsChannelId}> to play craps!` });
  return;
}
```

---

## 19. Dice Display

### 19.1 Unicode Dice Faces

```typescript
const DICE_EMOJI: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅',
};

function getDieEmoji(value: number): string {
  return DICE_EMOJI[value] || '?';
}

function formatDiceRoll(die1: number, die2: number): string {
  return `${getDieEmoji(die1)} ${getDieEmoji(die2)}`;
}

// Example: formatDiceRoll(4, 5) → "⚃ ⚄"
```

### 19.2 Roll Animation Sequence

```typescript
async function animateRoll(message: Message, finalDie1: number, finalDie2: number): Promise<void> {
  // Step 1: Rolling message
  await message.edit({ embeds: [buildRollingEmbed()] });

  // Step 2: Suspense delay
  await sleep(2000);

  // Step 3: Show result
  const total = finalDie1 + finalDie2;
  await message.edit({
    embeds: [buildResultEmbed(finalDie1, finalDie2, total)]
  });
}
```

### 19.3 Result Display Examples

```
⚃ ⚄

ELEVEN! Natural!
```

```
⚂ ⚃

SEVEN OUT! 💀
```

```
⚄ ⚂

EIGHT! Place 8 pays!
```

---

## 20. Max Exposure Enforcement

### 20.1 Per-User Limit

```typescript
const MAX_EXPOSURE = 50000;

function getUserExposure(userId: string): number {
  const userBets = state.bets.filter(b => b.odal visually === odal && b.status === 'active');
  return userBets.reduce((sum, b) => sum + b.amount, 0);
}

function canPlaceBet(userId: string, amount: number): { allowed: boolean; reason?: string } {
  const current = getUserExposure(userId);

  if (current + amount > MAX_EXPOSURE) {
    return {
      allowed: false,
      reason: `You have ${formatCurrency(current)} on the table. Max exposure is ${formatCurrency(MAX_EXPOSURE)}.`
    };
  }

  return { allowed: true };
}
```

### 20.2 Enforcement Points

1. **Before deducting wallet** - Check exposure limit
2. **Aggregate place bets** - Adding to existing place bet counts toward limit
3. **Field bets count** - Even one-roll bets count toward exposure until resolved

---

## 21. Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add `CRAPS_CHANNEL_ID` to `.env.sample` and `.env`
- [ ] Add craps config to `economyConfig.ts`
- [ ] Create `crapsConfig.ts` - bet types, timing, payouts
- [ ] Create `crapsDb.ts` - schema migration, CRUD operations

### Phase 2: Game Engine
- [ ] Create `crapsEngine.ts` - rollDice, resolveBets, calculatePayout
- [ ] Create `crapsState.ts` - state machine, timers, bet management
- [ ] Unit test resolution logic

### Phase 3: Discord Integration
- [ ] Create `crapsEmbed.ts` - embed builders
- [ ] Create `craps.ts` - command handler with subcommands
- [ ] Add to command loader in `index.ts`
- [ ] Run `npx tsx deploy-commands.ts`

### Phase 4: Theater & Polish
- [ ] Public bet announcements
- [ ] Shooter announcement
- [ ] Hot streak counter
- [ ] Session results summary
- [ ] Dice animation

### Phase 5: Stats & Leaderboard
- [ ] Create `crapsstats.ts`
- [ ] Create `crapsleaderboard.ts`

### Phase 6: Testing
- [ ] Come-out naturals (7, 11)
- [ ] Come-out craps (2, 3, 12)
- [ ] Point establishment and hit
- [ ] Seven-out
- [ ] Place bets winning multiple times
- [ ] Grace period → cold
- [ ] Max exposure enforcement
- [ ] Channel restriction

---

*Document complete. Ready for implementation.*
