# Training Ground - Phase 3 PRD: UX Improvements

## Overview

Comprehensive improvements to the `/train` command focusing on visibility, control, and long-term engagement.

**Key Decisions:**
- Wilt warnings: 2 hours before bust
- Streaks: Cosmetic only (no value bonus)
- Scope: All tiers

---

## Tier 1: High Value, Low Effort

### 1.1 Enhanced Grid Display with Timers

**Problem:** Users can't see when training completes or when ready players will bust.

**Current Display:**
```
🏟️ Your Training Ground
━━━━━━━━━━━━━━━━━━━━━━

🟫 ⬛ ⬛
🏈 💧 ⬛
⭐ 💀 ⬛

📊 Status
Prepared: 1 | Hydrated: 1
Training: 1 | Ready: 1 | Busted: 1
```

**Proposed Display:**
```
🏟️ Your Training Ground
━━━━━━━━━━━━━━━━━━━━━━

🟫 ⬛ ⬛
🏈 💧 ⬛
⭐ 💀 ⬛

⏱️ Active Slots
🏈 Slot 4: QB training (ready in 12m)
⭐ Slot 7: WR ready! (23h 15m until bust)

📊 Status
Prepared: 1 | Hydrated: 1
Training: 1 | Ready: 1 | Busted: 1
```

**Implementation:**

File: `training/trainingUtils.js`

```javascript
/**
 * Format time remaining as human-readable string
 * @param {Date} targetTime
 * @returns {string}
 */
export function formatTimeRemaining(targetTime) {
  const now = new Date();
  const diffMs = targetTime - now;

  if (diffMs <= 0) return "now";

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;

  if (diffHours >= 24) {
    const days = Math.floor(diffHours / 24);
    const hrs = diffHours % 24;
    return `${days}d ${hrs}h`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ${remainingMins}m`;
  }
  return `${diffMins}m`;
}

/**
 * Build active slots detail section
 * @param {Array} slots - Array of slot objects with state, position_key, ready_at, wilts_at
 * @returns {string}
 */
export function buildActiveSlotDetails(slots) {
  const activeSlots = slots.filter(s =>
    s.state === 'training' || s.state === 'ready'
  );

  if (activeSlots.length === 0) return "";

  const lines = activeSlots.map(slot => {
    const pos = TRAINING_CONFIG.POSITIONS[slot.position_key];
    const emoji = pos?.emoji || "❓";
    const slotNum = slot.slot_index + 1;

    if (slot.state === 'training') {
      const timeLeft = formatTimeRemaining(new Date(slot.ready_at));
      return `${emoji} Slot ${slotNum}: ${slot.position_key} training (ready in ${timeLeft})`;
    } else if (slot.state === 'ready') {
      const timeLeft = formatTimeRemaining(new Date(slot.wilts_at));
      return `⭐ Slot ${slotNum}: ${slot.position_key} ready! (${timeLeft} until bust)`;
    }
  });

  return "\n⏱️ **Active Slots**\n" + lines.join("\n");
}
```

File: `discordCommands/train/train.js` - Update `buildViewEmbed()`

Add active slot details to the embed description after the grid.

---

### 1.2 Wilt Warning Notifications

**Problem:** Players bust without advance notice.

**Solution:** DM users when ready players have < 2 hours until bust.

**Database Changes:**

File: `migrations/003_training_phase3.sql`
```sql
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS last_wilt_warning_at TIMESTAMP;
```

File: `training/trainingDb.js`
```javascript
/**
 * Get users needing wilt warning (ready players within 2 hours of bust)
 * Only notify if we haven't already warned for this batch
 */
export async function getUsersNeedingWiltWarning() {
  const result = await sql`
    SELECT
      tg.user_id,
      tg.username,
      COUNT(ts.id) as warning_count,
      MIN(ts.wilts_at) as earliest_wilt
    FROM training_grounds tg
    JOIN training_slots ts ON tg.user_id = ts.user_id
    WHERE tg.notify_ready = true
      AND ts.state = 'ready'
      AND ts.wilts_at <= NOW() + INTERVAL '2 hours'
      AND ts.wilts_at > NOW()
      AND (tg.last_wilt_warning_at IS NULL
           OR tg.last_wilt_warning_at < NOW() - INTERVAL '2 hours')
    GROUP BY tg.user_id, tg.username
  `;
  return result.rows;
}

/**
 * Update last wilt warning timestamp
 */
export async function updateLastWiltWarning(userId) {
  await sql`
    UPDATE training_grounds
    SET last_wilt_warning_at = NOW()
    WHERE user_id = ${userId}
  `;
}
```

File: `training/trainingNotificationService.js`
```javascript
init() {
  // Existing: Check ready players every 2 minutes
  cron.schedule("*/2 * * * *", () => this.checkReadyPlayers());

  // New: Check wilt warnings every 5 minutes
  cron.schedule("*/5 * * * *", () => this.checkWiltWarnings());

  console.log("[TRAINING] Notification service initialized");
}

async checkWiltWarnings() {
  try {
    const users = await trainingDb.getUsersNeedingWiltWarning();

    for (const user of users) {
      await this.sendWiltWarning(user);
    }

    if (users.length > 0) {
      console.log(`[TRAINING] Sent ${users.length} wilt warning(s)`);
    }
  } catch (error) {
    console.error("[TRAINING] Wilt warning check error:", error);
  }
}

async sendWiltWarning(user) {
  try {
    const discordUser = await this.client.users.fetch(user.user_id);
    await discordUser.send({
      embeds: [this.buildWiltWarningEmbed(user.warning_count, user.earliest_wilt)]
    });
    await trainingDb.updateLastWiltWarning(user.user_id);
  } catch (error) {
    // Same error handling as notifyUser
    if (error.code === 50007 || error.code === 10013) {
      console.log(`[TRAINING] Cannot warn user ${user.user_id}`);
    } else {
      console.error(`[TRAINING] Failed to warn ${user.user_id}:`, error);
    }
  }
}

buildWiltWarningEmbed(warningCount, earliestWilt) {
  const timeLeft = formatTimeRemaining(new Date(earliestWilt));

  return new EmbedBuilder()
    .setColor(0xe74c3c) // Red for urgency
    .setTitle("⚠️ Players About to Bust!")
    .setDescription(
      `You have **${warningCount}** player${warningCount > 1 ? 's' : ''} ` +
      `that will bust within 2 hours!\n\n` +
      `⏰ First bust in: **${timeLeft}**\n\n` +
      `Use \`/train manage\` or \`/train graduate\` NOW!`
    )
    .setFooter({ text: "Disable notifications with /train settings" })
    .setTimestamp();
}
```

---

### 1.3 Quick Graduate Command

**Problem:** Users must navigate through manage menu to graduate.

**Solution:** Add `/train graduate` subcommand for immediate graduation.

File: `discordCommands/train/train.js`

Add to SlashCommandBuilder:
```javascript
.addSubcommand((sub) =>
  sub.setName("graduate")
    .setDescription("Immediately graduate all ready players"))
```

Add handler:
```javascript
case "graduate":
  await handleQuickGraduate(interaction);
  break;

/**
 * Handle quick graduate - immediately graduate all ready players
 */
async function handleQuickGraduate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const username = interaction.user.username;

  // Ensure training ground exists
  let ground = await trainingDb.getOrCreateTrainingGround(userId, username);

  // Refresh states first
  await trainingDb.refreshSlotStates(userId);

  // Get ready slots
  const slots = await trainingDb.getSlots(userId);
  const readySlots = slots.filter(s => s.state === "ready");

  if (readySlots.length === 0) {
    await interaction.editReply({
      content: "No players ready to graduate. Use `/train view` to check your facility."
    });
    return;
  }

  // Graduate all ready players (reuse existing handleGraduateAll logic)
  const results = [];

  for (const slot of readySlots) {
    const result = await trainingDb.graduatePlayer(userId, slot.slot_index);
    if (result.success) {
      results.push({
        position: slot.position_key,
        value: result.value
      });
    }
  }

  if (results.length === 0) {
    await interaction.editReply({
      content: "Failed to graduate players. Please try `/train manage`."
    });
    return;
  }

  // Build success embed (same as handleGraduateAll)
  const totalValue = results.reduce((sum, r) => sum + r.value, 0);
  const breakdown = results.map(r => {
    const pos = TRAINING_CONFIG.POSITIONS[r.position];
    return `${pos.emoji} ${pos.displayName}: ${r.value} coins`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🎓 Players Graduated!")
    .setDescription(
      `Successfully graduated **${results.length}** player${results.length > 1 ? 's' : ''}!\n\n` +
      `${breakdown}\n\n` +
      `**Total: ${totalValue} coins**`
    )
    .setFooter({ text: "Sell your rookies with /inventory sell" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
```

---

## Tier 2: Quality of Life

### 2.1 Slot Selection for Drafting

**Problem:** Draft always goes to first available hydrated slot - no user control.

**Solution:** After selecting position, show slot selection menu.

File: `discordCommands/train/train.js`

Modify `handleDraftMenu()` to add slot selection:

```javascript
async function handleDraftMenu(interaction, userId) {
  // ... existing position selection code ...

  // After position is selected, show slot selection
  const hydratedSlots = slots.filter(s => s.state === "hydrated");

  if (hydratedSlots.length === 1) {
    // Only one option - auto-select
    await draftToSlot(interaction, userId, selectedPosition, hydratedSlots[0].slot_index);
    return;
  }

  // Multiple options - show slot selector
  const slotOptions = hydratedSlots.map(slot => ({
    label: `Slot ${slot.slot_index + 1}`,
    value: String(slot.slot_index),
    emoji: "💧"
  }));

  const slotSelect = new StringSelectMenuBuilder()
    .setCustomId("draft_slot_select")
    .setPlaceholder("Select slot to draft into")
    .addOptions(slotOptions);

  const row = new ActionRowBuilder().addComponents(slotSelect);

  await interaction.followUp({
    content: `📍 **Select Slot for ${selectedPosition}**`,
    components: [row],
    ephemeral: true
  });

  // Collect slot selection
  const slotCollector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === userId && i.customId === "draft_slot_select",
    time: 60000,
    max: 1
  });

  slotCollector.on("collect", async i => {
    const slotIndex = parseInt(i.values[0]);
    await draftToSlot(i, userId, selectedPosition, slotIndex);
  });
}
```

---

### 2.2 Individual Slot Actions

**Problem:** All actions are batch-only (setup all, hydrate all, etc.)

**Solution:** Add slot number buttons to manage view.

File: `discordCommands/train/train.js`

Add slot detail handler:

```javascript
/**
 * Handle individual slot management
 */
async function handleSlotDetail(interaction, userId, slotIndex) {
  await trainingDb.refreshSlotStates(userId);
  const slots = await trainingDb.getSlots(userId);
  const slot = slots.find(s => s.slot_index === slotIndex);

  if (!slot) {
    await interaction.reply({
      content: "Slot not found.",
      ephemeral: true
    });
    return;
  }

  const stateInfo = TRAINING_CONFIG.STATES[slot.state.toUpperCase()];
  const position = slot.position_key ? TRAINING_CONFIG.POSITIONS[slot.position_key] : null;

  let description = `**State:** ${stateInfo.emoji} ${stateInfo.description}`;

  if (slot.state === "training" && slot.ready_at) {
    const timeLeft = formatTimeRemaining(new Date(slot.ready_at));
    description += `\n**Ready in:** ${timeLeft}`;
  } else if (slot.state === "ready" && slot.wilts_at) {
    const timeLeft = formatTimeRemaining(new Date(slot.wilts_at));
    description += `\n**Busts in:** ${timeLeft}`;
    description += `\n**Value range:** ${position.graduateValueMin}-${position.graduateValueMax} coins`;
  }

  if (position) {
    description += `\n**Position:** ${position.emoji} ${position.displayName}`;
  }

  const embed = new EmbedBuilder()
    .setColor(getSlotColor(slot.state))
    .setTitle(`📍 Slot ${slotIndex + 1}`)
    .setDescription(description);

  // Build action buttons based on state
  const buttons = [];

  switch (slot.state) {
    case "empty":
      buttons.push(new ButtonBuilder()
        .setCustomId(`slot_setup_${slotIndex}`)
        .setLabel("Setup This Slot")
        .setEmoji("🔧")
        .setStyle(ButtonStyle.Primary));
      break;
    case "prepared":
      buttons.push(new ButtonBuilder()
        .setCustomId(`slot_hydrate_${slotIndex}`)
        .setLabel("Hydrate This Slot")
        .setEmoji("💧")
        .setStyle(ButtonStyle.Primary));
      break;
    case "hydrated":
      buttons.push(new ButtonBuilder()
        .setCustomId(`slot_draft_${slotIndex}`)
        .setLabel("Draft to This Slot")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Primary));
      break;
    case "ready":
      buttons.push(new ButtonBuilder()
        .setCustomId(`slot_graduate_${slotIndex}`)
        .setLabel("Graduate This Player")
        .setEmoji("🎓")
        .setStyle(ButtonStyle.Success));
      break;
    case "busted":
      buttons.push(new ButtonBuilder()
        .setCustomId(`slot_clear_${slotIndex}`)
        .setLabel("Clear This Slot")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger));
      break;
  }

  buttons.push(new ButtonBuilder()
    .setCustomId("back_to_manage")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary));

  const row = new ActionRowBuilder().addComponents(buttons);

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

function getSlotColor(state) {
  const colors = {
    empty: 0x2c3e50,
    prepared: 0x8b4513,
    hydrated: 0x3498db,
    training: 0xf39c12,
    ready: 0x2ecc71,
    busted: 0xe74c3c
  };
  return colors[state] || 0x95a5a6;
}
```

Add slot buttons to manage view (numbered 1-9):

```javascript
// In buildManageComponents()
// Add a row of slot buttons
const slotButtons = [];
for (let i = 0; i < 9; i++) {
  const slot = slots[i];
  const emoji = getSlotEmoji(slot);
  slotButtons.push(new ButtonBuilder()
    .setCustomId(`slot_detail_${i}`)
    .setLabel(`${i + 1}`)
    .setEmoji(emoji)
    .setStyle(ButtonStyle.Secondary));
}

// Split into rows of 5 (Discord limit)
const slotRow1 = new ActionRowBuilder().addComponents(slotButtons.slice(0, 5));
const slotRow2 = new ActionRowBuilder().addComponents(slotButtons.slice(5, 9));
```

---

### 2.3 Training Queue (Future)

**Complexity:** Requires new table and auto-draft logic on hydration.

**Defer to Phase 4** - Document for future implementation.

---

## Tier 3: Engagement Features

### 3.1 Training Streaks (Cosmetic Only)

**Problem:** No sense of progression beyond raw stats.

**Solution:** Track consecutive graduates without bust. Display in stats, no value bonus.

**Database Changes:**

File: `migrations/003_training_phase3.sql`
```sql
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0;

ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS best_streak INTEGER DEFAULT 0;
```

File: `training/trainingDb.js`

```javascript
/**
 * Increment streak on graduation
 */
export async function incrementStreak(userId) {
  const result = await sql`
    UPDATE training_grounds
    SET current_streak = current_streak + 1,
        best_streak = GREATEST(best_streak, current_streak + 1)
    WHERE user_id = ${userId}
    RETURNING current_streak, best_streak
  `;
  return result.rows[0];
}

/**
 * Reset streak on bust (called by refreshSlotStates when wilting)
 */
export async function resetStreak(userId) {
  await sql`
    UPDATE training_grounds
    SET current_streak = 0
    WHERE user_id = ${userId}
  `;
}
```

Modify `refreshSlotStates()` to call `resetStreak()` when a player busts.

Modify `graduatePlayer()` to call `incrementStreak()` on success.

File: `discordCommands/train/train.js` - Update stats embed:

```javascript
// In handleStats()
const streakDisplay = ground.current_streak > 0
  ? `🔥 Current Streak: ${ground.current_streak} (Best: ${ground.best_streak})`
  : `🔥 Best Streak: ${ground.best_streak}`;

// Add to embed fields
.addFields({ name: "\u200B", value: streakDisplay, inline: false })
```

---

### 3.2 Position Mastery

**Problem:** No long-term goals or specialization incentive.

**Solution:** Track graduates per position, display mastery levels.

**Database Changes:**

File: `migrations/003_training_phase3.sql`
```sql
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS te_graduated INTEGER DEFAULT 0;
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS rb_graduated INTEGER DEFAULT 0;
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS wr_graduated INTEGER DEFAULT 0;
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS qb_graduated INTEGER DEFAULT 0;
```

File: `training/trainingDb.js`

```javascript
/**
 * Increment position-specific graduation count
 */
export async function incrementPositionGraduated(userId, positionKey) {
  const column = `${positionKey.toLowerCase()}_graduated`;
  await sql`
    UPDATE training_grounds
    SET ${sql(column)} = ${sql(column)} + 1
    WHERE user_id = ${userId}
  `;
}
```

File: `training/trainingConfig.js`

```javascript
export const MASTERY_LEVELS = {
  NONE: { name: "None", threshold: 0, emoji: "⚪" },
  BRONZE: { name: "Bronze", threshold: 25, emoji: "🥉" },
  SILVER: { name: "Silver", threshold: 50, emoji: "🥈" },
  GOLD: { name: "Gold", threshold: 100, emoji: "🥇" },
  DIAMOND: { name: "Diamond", threshold: 200, emoji: "💎" },
};

export function getMasteryLevel(count) {
  if (count >= 200) return MASTERY_LEVELS.DIAMOND;
  if (count >= 100) return MASTERY_LEVELS.GOLD;
  if (count >= 50) return MASTERY_LEVELS.SILVER;
  if (count >= 25) return MASTERY_LEVELS.BRONZE;
  return MASTERY_LEVELS.NONE;
}
```

File: `discordCommands/train/train.js` - Update stats embed:

```javascript
// In handleStats()
const mastery = [
  { pos: "TE", count: ground.te_graduated },
  { pos: "RB", count: ground.rb_graduated },
  { pos: "WR", count: ground.wr_graduated },
  { pos: "QB", count: ground.qb_graduated },
].map(p => {
  const level = getMasteryLevel(p.count);
  const posConfig = TRAINING_CONFIG.POSITIONS[p.pos];
  return `${posConfig.emoji} ${p.pos}: ${p.count} ${level.emoji}`;
}).join("\n");

// Add mastery section to embed
.addFields({ name: "🏆 Position Mastery", value: mastery, inline: false })
```

---

### 3.3 Training Leaderboard

**Problem:** No competition or social comparison.

**Solution:** Add `/train leaderboard` subcommand.

File: `discordCommands/train/train.js`

Add to SlashCommandBuilder:
```javascript
.addSubcommand((sub) =>
  sub.setName("leaderboard")
    .setDescription("View the top trainers"))
```

File: `training/trainingDb.js`

```javascript
/**
 * Get top trainers by total graduated
 */
export async function getTopTrainers(limit = 10) {
  const result = await sql`
    SELECT
      user_id,
      username,
      total_graduated,
      total_busted,
      best_streak,
      CASE WHEN (total_graduated + total_busted) > 0
        THEN ROUND(total_graduated::numeric / (total_graduated + total_busted) * 100, 1)
        ELSE 0
      END as success_rate
    FROM training_grounds
    WHERE total_graduated > 0
    ORDER BY total_graduated DESC
    LIMIT ${limit}
  `;
  return result.rows;
}
```

File: `discordCommands/train/train.js`

```javascript
async function handleLeaderboard(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const topTrainers = await trainingDb.getTopTrainers(10);

  if (topTrainers.length === 0) {
    await interaction.editReply({
      content: "No trainers on the leaderboard yet. Be the first to graduate a player!"
    });
    return;
  }

  const leaderboard = topTrainers.map((trainer, index) => {
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
    return `${medal} **${trainer.username}** - ${trainer.total_graduated} graduated (${trainer.success_rate}%)`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🏆 Training Leaderboard")
    .setDescription(leaderboard)
    .setFooter({ text: "Graduate more players to climb the ranks!" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
```

---

### 3.4 Lucky Graduation Events

**Problem:** Graduation is predictable, no surprise/delight moments.

**Solution:** 5% chance for "Star Player" with 2x value multiplier.

File: `training/trainingConfig.js`

```javascript
export const LUCKY_CONFIG = {
  STAR_PLAYER_CHANCE: 0.05, // 5%
  STAR_MULTIPLIER: 2,
};
```

File: `training/trainingDb.js` - Modify `graduatePlayer()`:

```javascript
export async function graduatePlayer(userId, slotIndex) {
  // ... existing logic ...

  // Calculate value
  let value = calculateGraduationValue(positionKey);
  let isStar = false;

  // Lucky check
  if (Math.random() < LUCKY_CONFIG.STAR_PLAYER_CHANCE) {
    value = Math.floor(value * LUCKY_CONFIG.STAR_MULTIPLIER);
    isStar = true;
  }

  // ... rest of graduation logic ...

  return { success: true, value, isStar, positionKey };
}
```

File: `discordCommands/train/train.js` - Update graduation embed:

```javascript
// In handleGraduateAll or handleQuickGraduate
if (result.isStar) {
  // Special star player celebration
  starPlayers.push({
    position: result.positionKey,
    value: result.value,
    baseValue: result.value / 2
  });
}

// If any star players, add special section
if (starPlayers.length > 0) {
  const starSection = starPlayers.map(s => {
    const pos = TRAINING_CONFIG.POSITIONS[s.position];
    return `🌟 ${pos.emoji} **STAR ${pos.displayName}!** ${s.baseValue} × 2 = **${s.value}** coins!`;
  }).join("\n");

  embed.addFields({
    name: "🌟 STAR PLAYERS!",
    value: starSection,
    inline: false
  });
}
```

---

## Database Migration Summary

File: `migrations/003_training_phase3.sql`

```sql
-- Wilt warning tracking
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS last_wilt_warning_at TIMESTAMP;

-- Streak tracking
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0;

ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS best_streak INTEGER DEFAULT 0;

-- Position mastery tracking
ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS te_graduated INTEGER DEFAULT 0;

ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS rb_graduated INTEGER DEFAULT 0;

ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS wr_graduated INTEGER DEFAULT 0;

ALTER TABLE training_grounds
ADD COLUMN IF NOT EXISTS qb_graduated INTEGER DEFAULT 0;
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `migrations/003_training_phase3.sql` | New migration file |
| `training/trainingConfig.js` | Add MASTERY_LEVELS, LUCKY_CONFIG |
| `training/trainingUtils.js` | Add formatTimeRemaining(), buildActiveSlotDetails() |
| `training/trainingDb.js` | Add streak/mastery functions, wilt warning queries, modify graduatePlayer() |
| `training/trainingNotificationService.js` | Add wilt warning cron and handler |
| `discordCommands/train/train.js` | Add graduate/leaderboard subcommands, slot selection, individual slot actions, update stats embed |

---

## Implementation Order

### Phase 3a: Tier 1 (Immediate)
1. Add `formatTimeRemaining()` and `buildActiveSlotDetails()` to trainingUtils.js
2. Update view embed to show active slot timers
3. Add wilt warning database functions and migration
4. Add wilt warning check to notification service
5. Add `/train graduate` quick command

### Phase 3b: Tier 2 (Control)
6. Add slot selection after position selection in draft flow
7. Add slot detail view with individual actions
8. Add slot number buttons to manage view

### Phase 3c: Tier 3 (Engagement)
9. Add streak tracking (migration, db functions, stats display)
10. Add position mastery tracking (migration, db functions, stats display)
11. Add `/train leaderboard` command
12. Add lucky star player graduation mechanic

### Deploy
13. Run migration
14. Deploy commands: `node deploy-commands.js`
15. Restart bot

---

## Testing Checklist

### Tier 1
- [ ] `/train view` shows countdown for training slots
- [ ] `/train view` shows wilt countdown for ready slots
- [ ] Wilt warning DM sent when < 2 hours until bust
- [ ] Wilt warning respects notification settings
- [ ] Wilt warning has 2-hour cooldown
- [ ] `/train graduate` works with ready players
- [ ] `/train graduate` shows error when no ready players

### Tier 2
- [ ] Draft shows slot selection when multiple hydrated slots
- [ ] Draft auto-selects when only one hydrated slot
- [ ] Slot detail view shows correct state info
- [ ] Individual slot actions work correctly
- [ ] Back button returns to manage view

### Tier 3
- [ ] Streak increments on graduation
- [ ] Streak resets on bust
- [ ] Best streak persists across sessions
- [ ] Position mastery counts increment correctly
- [ ] Mastery levels display correctly in stats
- [ ] Leaderboard shows top 10 trainers
- [ ] Star player appears ~5% of time
- [ ] Star player value is doubled
