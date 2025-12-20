# NFLmon System - Implementation Plan

## Overview
A Pokemon-style collectible system featuring real NFL players that integrates with existing economy and game systems.

### User Decisions
- **Theme**: Real NFL players (current active ~50+ players)
- **Stats**: 4 simplified abstract stats (Speed, Power, Agility, Awareness)
- **Evolution**: Career stages (Rookie → Pro → All-Pro → Hall of Famer)
- **Rarity**: Accessible (8-10% legendary drop rate)
- **Images**: External URLs stored per player
- **Scope**: Collection only for now (battles can be added later)
- **Training**: NFLmon in training slots receive XP; slots purchasable in shop

---

## File Structure

```
discord-bot/
├── nflmon/
│   ├── nflmonConfig.js      # Rarities, stats, XP formulas, shop packs
│   ├── nflmonDb.js          # CRUD operations for bench/trades
│   ├── nflmonService.js     # Core logic: rolling, XP, evolution
│   └── nflmonPlayers.json   # 50+ player definitions
├── discordCommands/
│   └── nflmon/
│       └── nflmon.js        # Main command with subcommands
├── migrations/
│   └── 005_nflmon.sql       # Database tables
```

---

## Database Schema

### `nflmon_bench` - User's collected NFLmon
```sql
CREATE TABLE nflmon_bench (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  player_id VARCHAR(50) NOT NULL,
  nickname VARCHAR(50),
  level INTEGER DEFAULT 1,
  current_xp INTEGER DEFAULT 0,
  evolution_stage VARCHAR(20) DEFAULT 'rookie',  -- rookie/pro/all_pro/hall_of_famer
  rarity VARCHAR(20) NOT NULL,                    -- common/uncommon/rare/epic/legendary
  iv_speed INTEGER, iv_power INTEGER, iv_agility INTEGER, iv_awareness INTEGER,
  acquired_source VARCHAR(50) NOT NULL,           -- wordle/trivia/shop/trade/daily
  acquired_from_user VARCHAR(20),
  is_favorite BOOLEAN DEFAULT FALSE,
  training_slot INTEGER CHECK (training_slot >= 1 AND training_slot <= 5),  -- NULL = not training
  acquired_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_nflmon_training ON nflmon_bench(user_id) WHERE training_slot IS NOT NULL;
```

### `nflmon_trades` - Trade escrow system
```sql
CREATE TABLE nflmon_trades (
  id SERIAL PRIMARY KEY,
  from_user_id VARCHAR(20) NOT NULL,
  to_user_id VARCHAR(20) NOT NULL,
  from_nflmon_id INTEGER REFERENCES nflmon_bench(id),
  to_nflmon_id INTEGER REFERENCES nflmon_bench(id),
  coins_offered INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',  -- pending/accepted/rejected/cancelled/expired
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);
```

### `nflmon_stats` - User statistics
```sql
CREATE TABLE nflmon_stats (
  user_id VARCHAR(20) PRIMARY KEY,
  username VARCHAR(100),
  total_caught INTEGER DEFAULT 0,
  total_evolved INTEGER DEFAULT 0,
  legendary_count INTEGER DEFAULT 0,
  highest_level_reached INTEGER DEFAULT 0,
  max_training_slots INTEGER DEFAULT 1 CHECK (max_training_slots >= 1 AND max_training_slots <= 5)
);
```

---

## Core Systems

### 1. Rarity System
| Rarity | Drop Weight | Sell Value | Stat Multiplier |
|--------|-------------|------------|-----------------|
| Common | 50% | 50 coins | 1.0x |
| Uncommon | 25% | 100 coins | 1.1x |
| Rare | 12% | 250 coins | 1.2x |
| Epic | 5% | 500 coins | 1.35x |
| Legendary | 8% | 1000 coins | 1.5x |

### 2. Evolution Stages
| Stage | Level Range | Emoji | Requirements |
|-------|-------------|-------|--------------|
| Rookie | 1-20 | 🌱 | Starting stage |
| Pro | 21-40 | ⭐ | Level 21+ |
| All-Pro | 41-60 | 🌟 | Level 41+ |
| Hall of Famer | 61-100 | 👑 | Level 61+, Rare+ rarity |

### 3. Stats System
Base stats by position + IVs (0-15 each, random at acquisition) + level scaling + rarity multiplier

**Final Stat Formula:**
```javascript
finalStat = Math.floor((baseStat + IV) * (1 + level * 0.01) * rarityMultiplier)
```
Example: QB SPD base=60, IV=10, Level=50, Rare (1.2x) → `(60+10) * 1.5 * 1.2 = 126`

**Position Base Stats:**
- QB: SPD 60, PWR 50, AGI 65, AWR 80
- RB: SPD 80, PWR 70, AGI 75, AWR 55
- WR: SPD 85, PWR 50, AGI 80, AWR 60
- TE: SPD 65, PWR 75, AGI 60, AWR 65

### 4. XP & Leveling
- Level cap: 100
- XP to reach level: `XP_for_level = level² × 100`
- XP stops accumulating at level 100

**Level Calculation Functions:**
```javascript
getLevelFromXp(xp) => Math.min(100, Math.floor(Math.sqrt(xp / 100)) + 1)
getXpForLevel(level) => level * level * 100
```

**XP Sources** (for training NFLmon):
- wordle_win: 10-20 XP
- wordle_first: 25-35 XP
- trivia_correct: 5-15 XP
- blackjack_win: 3-8 XP

### 5. Acquisition Sources
| Source | Drop Chance | Notes |
|--------|-------------|-------|
| Wordle win | 15% | Random player |
| Wordle first solve | 100% | Random player |
| Trivia correct | 10% | Random player |
| Shop packs | 100% | varies by pack |

> **Note**: Rarity is determined by the player's `rarityPool` (guaranteed), not by weighted roll. Source integration will be wired up in Phase 5.

### 6. Training Slots System
NFLmon assigned to training slots receive XP from user activities.

**Mechanics:**
- Users start with **1 training slot**
- Can purchase up to **5 total slots** from shop
- Each slot can hold 1 NFLmon
- **All NFLmon in training receive FULL XP** (not split) - incentivizes buying more slots
- Assign via `/nflmon train <id> [slot]`, remove via `/nflmon untrain <id>`

**XP Distribution:**
When user wins wordle/trivia/blackjack/etc:
1. Query all NFLmon where `training_slot IS NOT NULL`
2. Each gets the full XP amount for that activity
3. Handle level-ups for each independently

**Shop Item:**
- "Training Slot Expansion" - 3000 coins
- Increases `max_training_slots` by 1
- Max 5 slots total (4 additional purchases)

---

## Commands

```
/nflmon bench [rarity] [page] - View your collection (10 per page, shows training status)
/nflmon view <id>             - Detailed view with stats
/nflmon train <id> [slot]     - Assign NFLmon to training slot (receives XP)
/nflmon untrain <id>          - Remove NFLmon from training
/nflmon nickname <id> [name]  - Set/clear nickname
/nflmon evolve <id>           - Evolve if conditions met
/nflmon sell <id>             - Sell for coins (button confirmation)
/nflmon trade @user <offer> [request] [coins] - Create trade
/nflmon trades                - View pending trades
/nflmon dex [search]          - Encyclopedia
/nflmon stats                 - Your statistics (includes training slots info)
/nflmon leaderboard [cat]     - Rankings (total/legendary/level/evolved)
```

### Command Visibility
| Command | Visibility | Reason |
|---------|------------|--------|
| bench | Ephemeral | Personal collection |
| view | Ephemeral | Personal info |
| train/untrain | Ephemeral | Action confirmation |
| evolve | **Public** | Achievement moment |
| sell | Ephemeral | Personal transaction |
| stats | Ephemeral | Personal stats |
| leaderboard | Public | Community feature |
| dex | Ephemeral | Reference lookup |

### Embed Colors (by rarity)
```javascript
const NFLMON_COLORS = {
  COMMON: 0x95a5a6,     // Gray
  UNCOMMON: 0x2ecc71,   // Green
  RARE: 0x3498db,       // Blue
  EPIC: 0x9b59b6,       // Purple
  LEGENDARY: 0xffd700   // Gold
};
```

---

## Integration Points

### Wordle (`discordCommands/wordle/wordle.js`)
- On win: 15% chance to drop NFLmon + XP to all training NFLmon
- On first solve: 100% drop with +2 rarity boost

### Trivia (`trivia/triviaService.js`)
- On correct answer: 10% drop chance + XP to all training NFLmon

### Blackjack/Slots/Redzone
- On win: XP to all training NFLmon (amount varies by game)

### Shop (`discordCommands/shop/shop.js`)
**NFLmon Packs:**
- Starter Pack: 500 coins, 1 NFLmon, -1 rarity boost
- Pro Pack: 1500 coins, 3 NFLmon, 0 boost
- Elite Pack: 5000 coins, 5 NFLmon, +2 boost

**Training Slots:**
- Training Slot Expansion: 3000 coins, +1 max slot (up to 5 total)

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Create `nflmon/` directory structure
- [ ] Implement `nflmonConfig.js` (rarities, stats, formulas)
- [ ] Create `migrations/005_nflmon.sql` and run migration
- [ ] Seed `nflmonPlayers.json` with initial 25 players

### Phase 2: Database Layer
- [ ] Implement `nflmonDb.js` following `inventory/inventoryDb.js` pattern
  - CRUD for bench, trades, stats
  - Atomic sell/transfer operations
  - Sell uses `economy/economyDb.js` → `addToWallet(userId, sellValue)` for coin integration

### Phase 3: Service Layer
- [ ] Implement `nflmonService.js`
  - `rollForNflmon(userId, username, source)` - core drop mechanic
  - `addXpToTraining(userId, source)` - XP to all training NFLmon
  - `evolve(userId, nflmonId)` - evolution logic
  - `getDisplayData(benchRecord)` - stat calculations
  - Training slot management (set, remove, purchase)

### Phase 4: Commands
- [ ] Create `discordCommands/nflmon/nflmon.js`
- [ ] Implement all subcommands
- [ ] Run `node deploy-commands.js`

### Phase 5: Game Integration
- [ ] Update wordle.js for drops and XP
- [ ] Update triviaService.js for drops and XP
- [ ] Add NFLmon packs to shop

### Phase 6: Trading & Polish
- [ ] Implement trade offer/accept/reject flow
- [ ] Complete `/nflmon dex` encyclopedia
- [ ] Expand player data to 50+ players

---

## Critical Files to Modify

| File | Action |
|------|--------|
| `nflmon/nflmonConfig.js` | CREATE - All constants and formulas |
| `nflmon/nflmonDb.js` | CREATE - Database operations |
| `nflmon/nflmonService.js` | CREATE - Core business logic |
| `nflmon/nflmonPlayers.json` | CREATE - Player data |
| `migrations/005_nflmon.sql` | CREATE - Database schema |
| `discordCommands/nflmon/nflmon.js` | CREATE - Main command |
| `discordCommands/wordle/wordle.js` | MODIFY - Add NFLmon drops (~line 324) |
| `trivia/triviaService.js` | MODIFY - Add NFLmon drops |
| `discordCommands/shop/shop.js` | MODIFY - Add pack category |

---

## Player Data Strategy

`nflmonPlayers.json` structure:
```json
{
  "mahomes_patrick": {
    "id": "mahomes_patrick",
    "name": "Patrick Mahomes",
    "team": "KC",
    "position": "QB",
    "number": 15,
    "imageUrl": "https://...",
    "rarityPool": "legendary"
  }
}
```

**Rarity Assignment** (player's `rarityPool` = guaranteed drop rarity):
- Legendary (~40): MVP candidates, generational talents → always drop as legendary
- Epic (~60): All-Pro caliber, franchise players → always drop as epic
- Rare (~100): Pro Bowl caliber → always drop as rare
- Uncommon (~150): Quality starters → always drop as uncommon
- Common (~150+): Backups, rotation players → always drop as common

> When a player drops, their `rarityPool` determines the rarity. The rarity weight table (50% common, etc.) is NOT used for drops - it only indicates population distribution.

---

## Key Service Function Signatures

```javascript
// nflmonService.js
rollForNflmon(userId, username, source, rarityBoostOverride?) → Promise<NFLmon|null>
addXpToTraining(userId, source) → Promise<Array<{nflmon, xpGained, levelsGained}>>
evolve(userId, nflmonId) → Promise<{success, nflmon?, newStage?, error?}>
getDisplayData(benchRecord) → {stats, ivTotal, canEvolve, displayName, ...}

// nflmonDb.js
getBench(userId, options?) → Promise<NFLmon[]>
getTrainingNflmon(userId) → Promise<NFLmon[]>
addNflmon(data) → Promise<NFLmon>
addXp(nflmonId, amount) → Promise<{nflmon, levelsGained}>
setTrainingSlot(userId, nflmonId, slot) → Promise<NFLmon|null>
removeFromTraining(userId, nflmonId) → Promise<NFLmon|null>
sellNflmon(userId, nflmonId) → Promise<{success, value?, error?}>
transferNflmon(nflmonId, fromUserId, toUserId) → Promise<NFLmon|null>
purchaseTrainingSlot(userId) → Promise<{success, newMax?, error?}>
```
