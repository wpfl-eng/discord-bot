# Incremental Database Migration: Drizzle ORM + TypeScript

## Strategy Overview
Migrate database files **one at a time** while keeping the app fully functional. Non-migrated `.js` files continue to work alongside migrated `.ts` files.

**Key enabler**: `tsx` - a TypeScript runner that executes both `.js` and `.ts` files seamlessly without compilation.

---

## Phase 1: Setup (One-Time)

### Step 1.1: Install Dependencies
```bash
npm install drizzle-orm
npm install -D tsx typescript drizzle-kit @types/node
```

### Step 1.2: Update package.json scripts
```json
{
  "scripts": {
    "start": "tsx index.js",
    "dev": "tsx watch index.js",
    "build": "tsc",
    "test": "tsx --test"
  }
}
```
**Note**: `tsx` runs both .js and .ts files. Existing .js files work unchanged.

### Step 1.3: Create tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": false
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```
**Key**: `allowJs: true` and `noEmit: true` - TypeScript checks but doesn't require compiling .js files.

### Step 1.4: Create Drizzle Infrastructure
```
db/
  index.ts          # Drizzle instance (shared)
  schema/
    index.ts        # Re-exports all schemas
```

**db/index.ts:**
```typescript
import { sql } from '@vercel/postgres';
import { drizzle } from 'drizzle-orm/vercel-postgres';
import * as schema from './schema/index.js';

export const db = drizzle({ client: sql, schema });
```

**db/schema/index.ts:** (start empty, add schemas as we migrate)
```typescript
// Export schemas as we create them
// export * from './economy.js';
// export * from './achievements.js';
```

### Step 1.5: Verify Setup Works
Run the app with `tsx index.js` - should work exactly as before since no .ts files are imported yet.

---

## Phase 2: File-by-File Migration Template

For each `*Db.js` file, follow these steps:

### Step 2.1: Create Schema File
Create `db/schema/{feature}.ts` with table definitions:
```typescript
import { pgTable, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

export const achievements = pgTable('achievements', {
  id: integer('id').primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  username: varchar('username', { length: 255 }),
  achievementKey: varchar('achievement_key', { length: 255 }).notNull(),
  achievedAt: timestamp('achieved_at').defaultNow(),
});

export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;
```

### Step 2.2: Add to Schema Index
In `db/schema/index.ts`:
```typescript
export * from './achievements.js';
```

### Step 2.3: Rename and Convert Db File
Rename `{feature}/{feature}Db.js` → `{feature}/{feature}Db.ts`

Convert functions from raw SQL to Drizzle:

**Before (JS):**
```javascript
import { sql } from "@vercel/postgres";

export async function hasAchievement(userId, achievementKey) {
  const result = await sql`
    SELECT 1 FROM achievements
    WHERE user_id = ${userId}
      AND achievement_key = ${achievementKey}
    LIMIT 1
  `;
  return result.rows.length > 0;
}
```

**After (TS):**
```typescript
import { db } from '../db/index.js';
import { achievements } from '../db/schema/achievements.js';
import { eq, and } from 'drizzle-orm';

export async function hasAchievement(userId: string, achievementKey: string): Promise<boolean> {
  const result = await db.select({ id: achievements.id })
    .from(achievements)
    .where(and(
      eq(achievements.userId, userId),
      eq(achievements.achievementKey, achievementKey)
    ))
    .limit(1);
  return result.length > 0;
}
```

### Step 2.4: Update Imports in Command Files
Command files that import the Db file need path updates:
```javascript
// Before
import * as achievementDb from "../../achievements/achievementDb.js";

// After (tsx handles .ts extension automatically)
import * as achievementDb from "../../achievements/achievementDb.js";
// OR explicitly
import * as achievementDb from "../../achievements/achievementDb.ts";
```
**Note**: With tsx, imports to .js work even if the file is .ts. No changes needed in most cases.

### Step 2.5: Test the Migration
1. Run `tsx index.js`
2. Test commands that use this Db file
3. Verify no regressions

---

## Phase 3: Migration Order

Migrate in this order (standalone files first, then files with dependencies):

| Order | File | Lines | Dependencies | Priority |
|-------|------|-------|--------------|----------|
| 1 | `achievements/achievementDb.js` | 79 | None | Easiest start |
| 2 | `trivia/triviaDb.js` | 180 | None | Simple |
| 3 | `redzone/redzoneDb.js` | 272 | None | Simple |
| 4 | `blackjack/blackjackDb.js` | 313 | None | Medium |
| 5 | `wordle/wordleDb.js` | 411 | None | Has JSONB |
| 6 | `economy/economyDb.js` | 417 | None | Core module |
| 7 | `stock/stockDb.js` | 205 | economyDb | After economy |
| 8 | `inventory/inventoryDb.js` | 305 | economyDb | After economy |
| 9 | `training/trainingDb.js` | 437 | None | State machine |
| 10 | `nflmon/nflmonDb.js` | 886 | None | Complex transactions |

---

## Phase 4: Common Drizzle Patterns

### Simple Select
```typescript
const user = await db.select()
  .from(economyUsers)
  .where(eq(economyUsers.userId, id))
  .limit(1);
return user[0] ?? null;
```

### Insert with Upsert (ON CONFLICT)
```typescript
const result = await db.insert(economyUsers)
  .values({ userId, username, createdAt: new Date() })
  .onConflictDoUpdate({
    target: economyUsers.userId,
    set: { username }
  })
  .returning();
return result[0];
```

### Atomic Update with SQL Expression
```typescript
import { sql } from 'drizzle-orm';

const result = await db.update(economyUsers)
  .set({
    wallet: sql`${economyUsers.wallet} + ${amount}`,
    totalEarned: sql`${economyUsers.totalEarned} + ${amount}`
  })
  .where(eq(economyUsers.userId, userId))
  .returning();
return result[0] ?? null;
```

### Conditional Update (WHERE with multiple conditions)
```typescript
const result = await db.update(economyUsers)
  .set({ wallet: sql`${economyUsers.wallet} - ${amount}` })
  .where(and(
    eq(economyUsers.userId, userId),
    gte(economyUsers.wallet, amount)  // Only if sufficient funds
  ))
  .returning();
return result[0] ?? null;
```

### Transaction (for nflmonDb)
```typescript
const result = await db.transaction(async (tx) => {
  const trade = await tx.select()
    .from(nflmonTrades)
    .where(eq(nflmonTrades.id, tradeId))
    .for('update')
    .limit(1);

  if (!trade[0]) throw new Error('NOT_FOUND');

  // ... more operations using tx instead of db

  return trade[0];
});
```

---

## Files to Create/Modify

### New Files (Phase 1)
- `/home/aboorde/codestuff/discord-bot/tsconfig.json`
- `/home/aboorde/codestuff/discord-bot/db/index.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/index.ts`

### Schema Files (create as needed)
- `/home/aboorde/codestuff/discord-bot/db/schema/economy.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/achievements.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/inventory.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/trivia.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/blackjack.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/training.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/redzone.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/stock.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/wordle.ts`
- `/home/aboorde/codestuff/discord-bot/db/schema/nflmon.ts`

### Files to Migrate (JS → TS)
- `/home/aboorde/codestuff/discord-bot/achievements/achievementDb.js`
- `/home/aboorde/codestuff/discord-bot/trivia/triviaDb.js`
- `/home/aboorde/codestuff/discord-bot/redzone/redzoneDb.js`
- `/home/aboorde/codestuff/discord-bot/blackjack/blackjackDb.js`
- `/home/aboorde/codestuff/discord-bot/wordle/wordleDb.js`
- `/home/aboorde/codestuff/discord-bot/economy/economyDb.js`
- `/home/aboorde/codestuff/discord-bot/stock/stockDb.js`
- `/home/aboorde/codestuff/discord-bot/inventory/inventoryDb.js`
- `/home/aboorde/codestuff/discord-bot/training/trainingDb.js`
- `/home/aboorde/codestuff/discord-bot/nflmon/nflmonDb.js`

### Modify (package.json)
- `/home/aboorde/codestuff/discord-bot/package.json` - update scripts for tsx

---

## Why This Works Incrementally

1. **tsx handles mixed codebases**: It runs `.js` and `.ts` files in the same project without configuration
2. **Drizzle and @vercel/postgres coexist**: Both use the same underlying connection; no conflict
3. **Function signatures stay the same**: Commands don't need logic changes, just import paths
4. **Each file is independent**: Migrate one, test, commit, repeat
5. **Easy rollback**: If a migration breaks something, just rename back to .js and revert changes

---

## Checkpoint After Phase 1

After completing Phase 1 setup, run `tsx index.js` and verify:
- [ ] App starts normally
- [ ] Bot connects to Discord
- [ ] Existing commands work (test a few)
- [ ] No TypeScript errors in new files

If all pass, proceed to migrate the first file (achievementDb).
