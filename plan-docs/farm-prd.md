# Training Ground - Football Farming Game PRD

## Overview

A football-themed farming/idle game for the WPFL Discord bot where users develop rookie players through a training facility. Inspired by Dank Memer's farming system but themed around football player development.

**Core Concept**: Users manage a "Training Ground" - a 3x3 grid facility where they draft rookie players, train them through timed development cycles, and graduate them to their inventory for sale or collection.

---

## Design Decisions (User-Confirmed)

| Decision | Choice |
|----------|--------|
| Theme | Training Ground (develop rookie players) |
| Economy | Unified (existing wallet/bank system) |
| MVP Scope | Core loop only |
| Social | Solo focus first, add later |
| "Crops" | Rookie players by position |
| Timers | Quick (5-30 minutes) |
| Harvest | Inventory items (manual sell) |
| Grid | 3x3 (9 training slots) |
| UI | Emoji grid display |
| Positions | QB, RB, WR, TE (skill positions) |
| Wilting | Yes - harvest window or lose player |

---

## MVP Features

### 1. Training Ground View (`/train view`)
Display user's 3x3 training facility with:
- Visual emoji grid showing each slot's state
- Time remaining until players are ready
- Action buttons: Manage, Refresh

**Grid States & Emojis:**
```
⬛ = Empty (untouched)
🟫 = Prepared (equipment set up)
💧 = Hydrated (ready for draft)
🏈 = QB in training
🏃 = RB in training
🎯 = WR in training
🤲 = TE in training
⭐ = Ready to graduate!
💀 = Busted (wilted - player left)
```

**Example Display:**
```
🏟️ AJ's Training Ground
━━━━━━━━━━━━━━━━━━━━━━

  🏈 | ⭐ | 💧
 ----+----+----
  🏃 | ⬛ | 🎯
 ----+----+----
  💧 | 💀 | 🤲

📊 Status:
• 1 player ready to graduate!
• 3 players in training (next ready: 12m)
• 1 player busted (didn't graduate in time)
• 2 slots prepared for drafting
```

### 2. Training Management (`/train manage`)
Actions via button interactions:
- **Setup All / Pick Slots** - Prepare equipment (like tilling)
- **Hydrate All / Pick Slots** - Water/prep facility (like watering)
- **Draft [Position]** - Plant a rookie (select from QB/RB/WR/TE)
- **Graduate All / Pick Slots** - Harvest ready players

### 3. Rookie Types (MVP)

| Position | Emoji | Draft Cost | Train Time | Graduate Value | Wilt Window |
|----------|-------|------------|------------|----------------|-------------|
| TE | 🤲 | 50 coins | 5 min | 75-100 coins | 15 min |
| RB | 🏃 | 100 coins | 10 min | 150-200 coins | 20 min |
| WR | 🎯 | 150 coins | 15 min | 225-300 coins | 25 min |
| QB | 🏈 | 250 coins | 25 min | 375-500 coins | 30 min |

*Values are ranges - some RNG on graduation value*

### 4. Shop Integration (`/shop`)
Add training items to existing shop:
- **Rookie Contracts** (seeds): QB Contract, RB Contract, WR Contract, TE Contract
- **Training Equipment**: Setup Kit (hoe equivalent) - 500 coins, 50 uses
- **Hydration Pack**: Water Cooler (watering can) - 300 coins, 30 uses

### 5. Inventory System (`/inventory`)
New command or extension to show:
- Graduated players by position
- Training supplies (contracts, equipment)
- Sell option: `/inventory sell [item] [quantity]`

### 6. Wilting/Bust Mechanic
- Once a player is "Ready to Graduate" (⭐), user has X minutes (wilt window)
- If not graduated in time, player "Busts" (💀) - leaves for another team
- Busted slots must be cleaned up (graduate the bust for 0 value) before reuse

---

## Database Schema

### New Table: `training_grounds`
```sql
CREATE TABLE training_grounds (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### New Table: `training_slots`
```sql
CREATE TABLE training_slots (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES training_grounds(user_id),
  slot_index INTEGER NOT NULL, -- 0-8 for 3x3 grid
  state TEXT DEFAULT 'empty', -- empty, prepared, hydrated, training, ready, busted
  rookie_type TEXT, -- null, 'QB', 'RB', 'WR', 'TE'
  planted_at TIMESTAMP,
  ready_at TIMESTAMP,
  wilts_at TIMESTAMP,
  UNIQUE(user_id, slot_index)
);
```

### New Table: `user_inventory`
```sql
CREATE TABLE user_inventory (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL, -- 'rookie_qb', 'rookie_rb', 'contract_qb', 'setup_kit', etc.
  item_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  item_value INTEGER, -- for sellable items
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, item_type)
);
```

### New Table: `training_tools`
```sql
CREATE TABLE training_tools (
  user_id TEXT PRIMARY KEY,
  setup_kit_uses INTEGER DEFAULT 0,
  water_cooler_uses INTEGER DEFAULT 0
);
```

---

## File Structure (Modular Design)

```
/discordCommands/
  /train/
    train.js              # Main command router
    trainView.js          # Display training ground
    trainManage.js        # Management actions
    trainConfig.js        # Timers, costs, values

/training/
  trainingDb.js           # Database operations
  trainingConfig.js       # Game configuration (easy to modify)
  trainingUtils.js        # Grid rendering, time formatting
  trainingTypes.js        # Position definitions, states

/inventory/
  inventoryDb.js          # Inventory database operations
  inventoryCommands.js    # /inventory command
```

**trainingConfig.js** (central config for easy tuning):
```javascript
export const TRAINING_CONFIG = {
  GRID_SIZE: 9, // 3x3

  POSITIONS: {
    TE: {
      emoji: '🤲',
      displayName: 'Tight End',
      contractItemType: 'contract_te',
      rookieItemType: 'rookie_te',
      draftCost: 50,
      trainTimeMinutes: 5,
      graduateValueMin: 75,
      graduateValueMax: 100,
      wiltWindowMinutes: 15,
    },
    RB: {
      emoji: '🏃',
      displayName: 'Running Back',
      contractItemType: 'contract_rb',
      rookieItemType: 'rookie_rb',
      draftCost: 100,
      trainTimeMinutes: 10,
      graduateValueMin: 150,
      graduateValueMax: 200,
      wiltWindowMinutes: 20,
    },
    WR: {
      emoji: '🎯',
      displayName: 'Wide Receiver',
      contractItemType: 'contract_wr',
      rookieItemType: 'rookie_wr',
      draftCost: 150,
      trainTimeMinutes: 15,
      graduateValueMin: 225,
      graduateValueMax: 300,
      wiltWindowMinutes: 25,
    },
    QB: {
      emoji: '🏈',
      displayName: 'Quarterback',
      contractItemType: 'contract_qb',
      rookieItemType: 'rookie_qb',
      draftCost: 250,
      trainTimeMinutes: 25,
      graduateValueMin: 375,
      graduateValueMax: 500,
      wiltWindowMinutes: 30,
    },
  },

  TOOLS: {
    SETUP_KIT: {
      itemType: 'tool_setup_kit',
      displayName: 'Setup Kit',
      emoji: '🔧',
      cost: 500,
      usesPerPurchase: 50,
      description: 'Prepares training slots with equipment'
    },
    WATER_COOLER: {
      itemType: 'tool_water_cooler',
      displayName: 'Water Cooler',
      emoji: '💧',
      cost: 300,
      usesPerPurchase: 30,
      description: 'Hydrates prepared slots for drafting'
    },
  },

  STATES: {
    EMPTY: { emoji: '⬛', name: 'empty', description: 'Untouched slot' },
    PREPARED: { emoji: '🟫', name: 'prepared', description: 'Equipment set up' },
    HYDRATED: { emoji: '💧', name: 'hydrated', description: 'Ready for drafting' },
    TRAINING: { emoji: null, name: 'training', description: 'Player in development' },
    READY: { emoji: '⭐', name: 'ready', description: 'Ready to graduate!' },
    BUSTED: { emoji: '💀', name: 'busted', description: 'Player left (missed window)' },
  },

  STARTER_KIT: {
    // Granted to new users on first /train view
    items: [
      { itemType: 'tool_setup_kit', quantity: 10 },
      { itemType: 'tool_water_cooler', quantity: 10 },
      { itemType: 'contract_te', quantity: 2 },
    ]
  },

  NOTIFICATIONS: {
    checkIntervalMinutes: 2,
    cooldownMinutes: 30, // Don't spam same user within 30 min
  }
};
```

**inventoryConfig.js** (item definitions for inventory system):
```javascript
export const ITEM_DEFINITIONS = {
  // Contracts (consumable - used to draft rookies)
  contract_te: {
    category: 'contract',
    displayName: 'TE Contract',
    emoji: '📜🤲',
    description: 'Draft a Tight End rookie',
    stackable: true,
    sellable: false,
  },
  contract_rb: {
    category: 'contract',
    displayName: 'RB Contract',
    emoji: '📜🏃',
    description: 'Draft a Running Back rookie',
    stackable: true,
    sellable: false,
  },
  contract_wr: {
    category: 'contract',
    displayName: 'WR Contract',
    emoji: '📜🎯',
    description: 'Draft a Wide Receiver rookie',
    stackable: true,
    sellable: false,
  },
  contract_qb: {
    category: 'contract',
    displayName: 'QB Contract',
    emoji: '📜🏈',
    description: 'Draft a Quarterback rookie',
    stackable: true,
    sellable: false,
  },

  // Tools (consumable - have limited uses)
  tool_setup_kit: {
    category: 'tool',
    displayName: 'Setup Kit',
    emoji: '🔧',
    description: 'Prepares training slots',
    stackable: true, // quantity = uses remaining
    sellable: false,
  },
  tool_water_cooler: {
    category: 'tool',
    displayName: 'Water Cooler',
    emoji: '💧',
    description: 'Hydrates prepared slots',
    stackable: true,
    sellable: false,
  },

  // Graduated Players (sellable)
  rookie_te: {
    category: 'player',
    displayName: 'Tight End Rookie',
    emoji: '🤲⭐',
    description: 'Graduated Tight End',
    stackable: true,
    sellable: true,
    baseValue: 75, // actual value set on graduation (75-100)
  },
  rookie_rb: {
    category: 'player',
    displayName: 'Running Back Rookie',
    emoji: '🏃⭐',
    description: 'Graduated Running Back',
    stackable: true,
    sellable: true,
    baseValue: 150,
  },
  rookie_wr: {
    category: 'player',
    displayName: 'Wide Receiver Rookie',
    emoji: '🎯⭐',
    description: 'Graduated Wide Receiver',
    stackable: true,
    sellable: true,
    baseValue: 225,
  },
  rookie_qb: {
    category: 'player',
    displayName: 'Quarterback Rookie',
    emoji: '🏈⭐',
    description: 'Graduated Quarterback',
    stackable: true,
    sellable: true,
    baseValue: 375,
  },
};

export const ITEM_CATEGORIES = {
  contract: { displayName: 'Contracts', emoji: '📜' },
  tool: { displayName: 'Training Tools', emoji: '🔧' },
  player: { displayName: 'Graduated Players', emoji: '⭐' },
};
```

---

## Command Specifications

### `/train view`
- Shows training ground grid
- Shows status summary
- Buttons: [Manage] [Refresh]
- If no training ground exists, prompts to create one (free)

### `/train manage`
- Opens management menu
- Buttons: [Setup] [Hydrate] [Draft] [Graduate]
- Each action opens sub-menu for "All" or "Pick Slots"
- Draft opens position selector (QB/RB/WR/TE)

### `/train stats`
- Personal statistics
- Total players graduated
- Total coins earned from training
- Current streak / longest streak

### `/inventory`
- List all items by category
- Options to sell items

### `/shop` (extend existing)
- Add "Training" category
- Rookie contracts, tools

---

## User Flow (MVP)

1. **First Time**: User runs `/train view` → Creates free training ground
2. **Setup**: Buy Setup Kit from `/shop` → `/train manage` → Setup slots
3. **Hydrate**: Buy Water Cooler → Hydrate prepared slots
4. **Draft**: Buy Contracts → Draft rookies into hydrated slots
5. **Wait**: Rookies train for X minutes (visible countdown)
6. **Graduate**: When ready (⭐), graduate to collect to inventory
7. **Sell**: Use `/inventory sell` to convert players to coins
8. **Repeat**: Clean up busted slots, start again

---

## Future Expansion Hooks (Post-MVP)

### Phase 2: Progression
- Multiple training facilities (buy additional plots)
- Tool upgrades (Gatorade Station = auto-hydrate)
- Facility skins/themes
- Achievements/badges

### Phase 3: Advanced Rookies
- Rare player variants (Star prospect, Bust risk)
- Position-specific bonuses
- Combo bonuses (full offense = bonus)
- Pro Bowl / All-Pro tiers

### Phase 4: Social
- Trading players between users
- Weekly graduation leaderboards
- Steal/protect mechanics (like /rob)
- Cooperative league goals

### Phase 5: Integration
- Fantasy football tie-ins (drafted players affect something)
- Season-based events
- Draft day specials

---

## Prerequisites (Must Build First)

Before the Training Ground can function, these foundational systems must be in place:

### 1. Inventory System (NEW - Does Not Exist)
The bot currently has wallet/bank but NO item inventory. This is a **major prerequisite**.

**Required Components:**
- `user_inventory` database table
- `inventoryDb.js` - CRUD operations for items
- `/inventory` command - View items, sell items
- Integration hooks for other commands to grant/consume items

**Database Table:**
```sql
CREATE TABLE user_inventory (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL,       -- 'rookie_qb', 'contract_rb', 'setup_kit', etc.
  item_name TEXT NOT NULL,       -- Display name
  item_category TEXT NOT NULL,   -- 'player', 'contract', 'tool'
  quantity INTEGER DEFAULT 1,
  item_value INTEGER,            -- Base sell value (for players)
  metadata JSONB,                -- Flexible field for future attributes
  acquired_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, item_type)
);
```

**Key Functions Needed:**
```javascript
// inventoryDb.js
addItem(userId, itemType, itemName, category, quantity, value)
removeItem(userId, itemType, quantity)
getInventory(userId)
getItemsByCategory(userId, category)
sellItem(userId, itemType, quantity) // Atomic: remove item + add to wallet
hasItem(userId, itemType, minQuantity)
```

### 2. Settings System (NEW - Does Not Exist)
For notification opt-in and future user preferences.

**Option A - Simple (Training-Specific):**
Add settings directly to `training_grounds` table:
```sql
ALTER TABLE training_grounds ADD COLUMN notify_ready BOOLEAN DEFAULT FALSE;
```

**Option B - General (Recommended for Future):**
Create a general user settings system:
```sql
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**For MVP, recommend Option A** - keeps it simple, can migrate to general settings later.

### 3. Background Notification Service (Extend Existing)
Bot already uses `node-cron` for trivia. Need to add training notifications.

**Implementation:**
- Add to `index.js` or create `services/trainingNotifications.js`
- Cron job runs every 1-2 minutes
- Queries for users with `notify_ready = true` AND players in `ready` state
- Sends DMs, handles failures gracefully
- Tracks "last notified" to avoid spam

**Cron Pseudocode:**
```javascript
cron.schedule('*/2 * * * *', async () => {
  const usersToNotify = await getReadyPlayersWithNotifications();
  for (const user of usersToNotify) {
    try {
      const discordUser = await client.users.fetch(user.user_id);
      await discordUser.send(`🏈 You have ${user.ready_count} players ready to graduate!`);
      await markNotified(user.user_id);
    } catch (err) {
      // User has DMs disabled, log and continue
    }
  }
});
```

### 4. Shop Extension (Modify Existing)
Current shop (`discordCommands/shop/shop.js`) sells padlocks and bank expansions.

**Changes Needed:**
- Add "Training" category to shop
- Add new items: Contracts (QB, RB, WR, TE), Setup Kit, Water Cooler
- Modify purchase handler to use inventory system
- Consider rotating stock for contracts (like Dank Memer's shop)

### 5. Database Migration Script
Create `migrations/001_training_system.sql`:
```sql
-- Training Grounds
CREATE TABLE IF NOT EXISTS training_grounds (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  notify_ready BOOLEAN DEFAULT FALSE,
  total_graduated INTEGER DEFAULT 0,
  total_busted INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Training Slots (9 per user)
CREATE TABLE IF NOT EXISTS training_slots (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES training_grounds(user_id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0 AND slot_index <= 8),
  state TEXT DEFAULT 'empty' CHECK (state IN ('empty', 'prepared', 'hydrated', 'training', 'ready', 'busted')),
  rookie_type TEXT CHECK (rookie_type IN (NULL, 'QB', 'RB', 'WR', 'TE')),
  planted_at TIMESTAMP,
  ready_at TIMESTAMP,
  wilts_at TIMESTAMP,
  UNIQUE(user_id, slot_index)
);

-- Training Tools (usage tracking)
CREATE TABLE IF NOT EXISTS training_tools (
  user_id TEXT PRIMARY KEY,
  setup_kit_uses INTEGER DEFAULT 0,
  water_cooler_uses INTEGER DEFAULT 0
);

-- User Inventory (general-purpose)
CREATE TABLE IF NOT EXISTS user_inventory (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_category TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  item_value INTEGER,
  metadata JSONB,
  acquired_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, item_type)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_training_slots_user ON training_slots(user_id);
CREATE INDEX IF NOT EXISTS idx_training_slots_state ON training_slots(state);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON user_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON user_inventory(user_id, item_category);
```

---

## Implementation Plan (Phased)

### Phase 0: Prerequisites (Build First)
**Must complete before any training features work**

1. **Inventory System** (2-3 commands worth of work)
   - Create `inventory/inventoryDb.js`
   - Create `inventory/inventoryConfig.js` (item definitions)
   - Create `discordCommands/inventory/inventory.js`
   - Test: Can add items, view items, sell items

2. **Database Migration**
   - Create migration script
   - Run against dev/prod databases
   - Verify tables created correctly

3. **Shop Extension**
   - Add training category to `shop.js`
   - Add contract items (use inventory system for purchase)
   - Add tool items
   - Test: Can buy contracts and tools

### Phase 1: Core Training Loop
1. **Training Module**
   - `training/trainingConfig.js`
   - `training/trainingDb.js`
   - `training/trainingUtils.js`

2. **View Command**
   - `/train view` - Display grid and status
   - First-time user onboarding (create ground + starter kit)

3. **Manage Command**
   - `/train manage` - Interactive button menu
   - Setup, Hydrate, Draft, Graduate actions
   - Tool consumption logic
   - Contract consumption logic

### Phase 2: Polish & Notifications
1. **Settings Command**
   - `/train settings` - Toggle notifications

2. **Notification Service**
   - Background cron job
   - DM handling

3. **Stats Command**
   - `/train stats` - Personal statistics

### Phase 3: Deploy & Iterate
1. Run `deploy-commands.js`
2. Test with small group
3. Gather feedback
4. Tune values (times, costs, rewards)

---

## Error Handling & Edge Cases

### User-Facing Errors (Graceful Messages)

| Scenario | Handling | User Message |
|----------|----------|--------------|
| No Setup Kit uses left | Block action | "You're out of Setup Kits! Buy more from `/shop`" |
| No Water Cooler uses left | Block action | "Your Water Cooler is empty! Get a refill from `/shop`" |
| No contracts for position | Block draft | "You don't have any QB Contracts! Buy from `/shop`" |
| Slot not in correct state | Block action | "That slot needs to be prepared first" / "Already has a player" |
| No players ready to graduate | Block harvest | "No players are ready yet! Check back soon." |
| All slots full | Block draft | "Your Training Ground is full! Graduate some players first." |
| Insufficient wallet balance | Block purchase | "Not enough coins! You need X but only have Y" |
| User DMs disabled | Skip notification | Log warning, continue (don't crash) |

### Database Error Handling

**Atomic Operations Pattern** (from existing economyDb.js):
```javascript
// All state-changing operations should be atomic
// Use RETURNING * to verify operation succeeded
// Return null on constraint violations (don't throw)

export async function consumeTool(userId, toolType, amount = 1) {
  const result = await sql`
    UPDATE user_inventory
    SET quantity = quantity - ${amount}
    WHERE user_id = ${userId}
      AND item_type = ${toolType}
      AND quantity >= ${amount}
    RETURNING *
  `;
  // Returns null if insufficient quantity (graceful fail)
  return result.rows[0] || null;
}
```

**Transaction Safety for Multi-Step Operations:**
```javascript
// When drafting a rookie, must:
// 1. Consume contract from inventory
// 2. Update training slot to 'training' state
// 3. Set timestamps

export async function draftRookie(userId, slotIndex, position) {
  // Use transaction to ensure atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Consume contract
    const contractResult = await client.query(`
      UPDATE user_inventory
      SET quantity = quantity - 1
      WHERE user_id = $1 AND item_type = $2 AND quantity >= 1
      RETURNING *
    `, [userId, `contract_${position.toLowerCase()}`]);

    if (!contractResult.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'NO_CONTRACT' };
    }

    // Step 2: Update slot
    const slotResult = await client.query(`
      UPDATE training_slots
      SET state = 'training',
          rookie_type = $3,
          planted_at = NOW(),
          ready_at = NOW() + INTERVAL '${position.trainTimeMinutes} minutes',
          wilts_at = NOW() + INTERVAL '${position.trainTimeMinutes + position.wiltWindowMinutes} minutes'
      WHERE user_id = $1 AND slot_index = $2 AND state = 'hydrated'
      RETURNING *
    `, [userId, slotIndex, position]);

    if (!slotResult.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'SLOT_NOT_READY' };
    }

    await client.query('COMMIT');
    return { success: true, slot: slotResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Draft error:', err);
    return { success: false, error: 'DB_ERROR' };
  } finally {
    client.release();
  }
}
```

### Race Condition Prevention

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Double-click on Graduate | Could duplicate rewards | Atomic UPDATE with state check, disable buttons after click |
| Concurrent drafts same slot | Could consume 2 contracts | Transaction + slot state check |
| Notification spam | User gets DM'd repeatedly | Track `last_notified_at` timestamp, enforce cooldown |
| Button collector expired | User clicks stale button | Handle InteractionExpired error gracefully |

**Button Interaction Pattern:**
```javascript
collector.on('collect', async (buttonInteraction) => {
  // Immediately defer to prevent timeout
  await buttonInteraction.deferUpdate();

  // Re-fetch current state (could have changed)
  const currentSlots = await getTrainingSlots(userId);

  // Validate action is still valid
  if (!isActionValid(currentSlots, action)) {
    await buttonInteraction.followUp({
      content: 'State has changed! Refreshing...',
      ephemeral: true
    });
    // Refresh display
    return;
  }

  // Perform atomic operation
  const result = await performAction(userId, action);

  if (!result.success) {
    await buttonInteraction.followUp({
      content: getErrorMessage(result.error),
      ephemeral: true
    });
    return;
  }

  // Update display
  await updateDisplay(buttonInteraction, userId);
});

collector.on('end', async (collected, reason) => {
  if (reason === 'time') {
    // Disable all buttons on timeout
    await disableButtons(message);
  }
});
```

### Notification Service Error Handling

```javascript
cron.schedule('*/2 * * * *', async () => {
  try {
    const usersToNotify = await getReadyPlayersWithNotifications();

    for (const user of usersToNotify) {
      try {
        const discordUser = await client.users.fetch(user.user_id);
        await discordUser.send({
          embeds: [createReadyNotificationEmbed(user.ready_count)]
        });
        await markNotified(user.user_id);
      } catch (dmError) {
        if (dmError.code === 50007) {
          // Cannot send messages to this user (DMs disabled)
          // Silently skip, don't disable their preference
          console.log(`User ${user.user_id} has DMs disabled, skipping`);
        } else if (dmError.code === 10013) {
          // Unknown User - user left server or deleted account
          // Could optionally clean up their data
          console.log(`Unknown user ${user.user_id}, skipping`);
        } else {
          console.error(`Failed to DM user ${user.user_id}:`, dmError);
        }
      }
    }
  } catch (err) {
    // Don't let cron job crash the bot
    console.error('Notification service error:', err);
  }
});
```

### Onboarding Error Handling

```javascript
export async function createTrainingGround(userId, username) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create training ground
    await client.query(`
      INSERT INTO training_grounds (user_id, username)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId, username]);

    // Create 9 empty slots
    for (let i = 0; i < 9; i++) {
      await client.query(`
        INSERT INTO training_slots (user_id, slot_index, state)
        VALUES ($1, $2, 'empty')
        ON CONFLICT (user_id, slot_index) DO NOTHING
      `, [userId, i]);
    }

    // Grant starter kit items
    for (const item of TRAINING_CONFIG.STARTER_KIT.items) {
      await client.query(`
        INSERT INTO user_inventory (user_id, item_type, item_name, item_category, quantity)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, item_type)
        DO UPDATE SET quantity = user_inventory.quantity + $5
      `, [userId, item.itemType, getItemName(item.itemType), getItemCategory(item.itemType), item.quantity]);
    }

    await client.query('COMMIT');
    return { success: true, isNewUser: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create training ground error:', err);
    return { success: false, error: 'DB_ERROR' };
  } finally {
    client.release();
  }
}
```

### Wilting Check (Background or On-View)

Option 1: **On-View Check** (simpler, recommended for MVP)
```javascript
// When user runs /train view, check for wilted players first
export async function checkAndUpdateWiltedPlayers(userId) {
  await sql`
    UPDATE training_slots
    SET state = 'busted'
    WHERE user_id = ${userId}
      AND state = 'ready'
      AND wilts_at < NOW()
  `;
}
```

Option 2: **Background Cron** (better UX, shows accurate state in notifications)
```javascript
cron.schedule('* * * * *', async () => {
  // Update all wilted players across all users
  await sql`
    UPDATE training_slots
    SET state = 'busted'
    WHERE state = 'ready' AND wilts_at < NOW()
  `;
});
```

**Recommendation:** Use Option 1 for MVP (on-view check), add Option 2 if notifications need accurate wilt state.

---

## Key Files to Modify

| File | Change |
|------|--------|
| `discordCommands/shop/shop.js` | Add training category |
| `economy/economyDb.js` | None (use existing wallet functions) |
| `deploy-commands.js` | Will auto-detect new commands |

## New Files to Create

| File | Purpose |
|------|---------|
| `training/trainingConfig.js` | Central configuration |
| `training/trainingDb.js` | Database operations |
| `training/trainingUtils.js` | Helpers and renderers |
| `discordCommands/train/train.js` | Main command |
| `discordCommands/inventory/inventory.js` | Inventory command |

---

## Final Decisions (Confirmed)

| Question | Decision |
|----------|----------|
| Starting resources | Free Starter Kit (10 setup uses, 10 hydrate uses, 2 TE contracts) |
| Combo bonuses | No - keep simple for MVP |
| Facility naming | No - keep simple for MVP |
| Notifications | Yes - opt-in DM reminders (requires settings) |

---

## Notification System (MVP)

### `/train settings`
Simple toggle for DM notifications:
- **notify_ready**: DM when any player is ready to graduate (default: OFF)

### Implementation
- Add `training_settings` table or column to `training_grounds`
- Background job (node-cron, already in project) checks for ready players
- Sends DM to users with notifications enabled
- Respects Discord DM settings (graceful failure if DMs disabled)

### Database Addition
```sql
ALTER TABLE training_grounds ADD COLUMN notify_ready BOOLEAN DEFAULT FALSE;
```

---

## New User Onboarding

When a user first runs `/train view`:
1. Create their training ground record
2. Grant starter kit to inventory:
   - 1x Setup Kit (10 uses)
   - 1x Water Cooler (10 uses)
   - 2x TE Contract (cheapest position to learn with)
3. Display welcome message with quick-start instructions
4. Show their empty 3x3 grid ready to use

---

## Success Metrics

- Daily active trainers
- Average sessions per user per day
- Coins flowing through training economy
- Completion rate (graduates vs busts)
- Time to first graduation (onboarding success)
