# Wordle Command Implementation Plan

## Overview
Add a Wordle game command with 6 guesses, 2-hour word rotation, economy integration, achievements, and sellable items.

## Requirements Summary
- 6 guesses per user per word cycle (classic Wordle)
- Word resets every 2 hours, BUT keeps same word if no one solved it
- Users cannot get the same word twice (track history)
- 2000 coins for correct guess
- First solver gets bonus: +1000 coins + guaranteed Lucky Letter item
- 3 achievements: First Solve, 5 Solves, 10 Solves
- New Wordle-themed sellable items

---

## File Structure

```
New Files:
  /wordle/
    wordleConfig.js      # Constants and configuration
    wordleWords.js       # Word list (~2000 answer words)
    wordleUtils.js       # Grid rendering, feedback calculation
    wordleDb.js          # Database operations
  /discordCommands/wordle/
    wordle.js            # Main slash command
  /sql/wordle.sql        # Database schema

Modified Files:
  /achievements/achievementConfig.js   # Add WORDLE achievements + action types
  /achievements/achievementService.js  # Add achievement mappings + criteria
  /inventory/inventoryConfig.js        # Add Wordle item definitions
```

---

## Database Schema (`/sql/wordle.sql`)

```sql
-- Global word state (one active word at a time)
CREATE TABLE wordle_words (
    id SERIAL PRIMARY KEY,
    current_word VARCHAR(5) NOT NULL,
    word_number INTEGER NOT NULL DEFAULT 1,
    set_at TIMESTAMP NOT NULL DEFAULT NOW(),
    solved BOOLEAN NOT NULL DEFAULT FALSE,
    first_solver_id VARCHAR(32),
    first_solver_username VARCHAR(64),
    first_solved_at TIMESTAMP,
    solve_count INTEGER NOT NULL DEFAULT 0
);

-- Per-user game state for each word
CREATE TABLE wordle_user_games (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL,
    username VARCHAR(64) NOT NULL,
    word VARCHAR(5) NOT NULL,
    word_number INTEGER NOT NULL,
    guesses JSONB NOT NULL DEFAULT '[]',
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    won BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    UNIQUE (user_id, word)
);

-- User statistics
CREATE TABLE wordle_stats (
    user_id VARCHAR(32) PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    first_solves INTEGER NOT NULL DEFAULT 0,
    last_played_at TIMESTAMP
);
```

---

## Implementation Steps

### Step 1: Create Database Schema
- Create `/sql/wordle.sql` with tables above
- Run schema against database

### Step 2: Create `/wordle/wordleConfig.js`
```javascript
export const WORDLE_CONFIG = {
  MAX_GUESSES: 6,
  WORD_LENGTH: 5,
  ROTATION_HOURS: 2,
  REWARDS: {
    BASE_WIN: 2000,
    FIRST_SOLVER_BONUS: 1000,
  },
  COLORS: {
    PLAYING: 0xf1c40f,  // Yellow
    WON: 0x2ecc71,      // Green
    LOST: 0xe74c3c,     // Red
    INFO: 0x3498db,     // Blue
  },
  EMOJIS: {
    CORRECT: '🟩',
    PRESENT: '🟨',
    ABSENT: '⬛',
    EMPTY: '⬜',
  },
};
```

### Step 3: Create `/wordle/wordleWords.js`
- Curated list of ~2000 common 5-letter answer words
- Larger list of ~12000 valid guesses
- `isValidWord(word)` - validates guess against word list
- `getRandomWord(excludeWords)` - picks random word, avoiding already-used words

### Step 4: Create `/wordle/wordleUtils.js`
- `calculateFeedback(guess, answer)` - returns array of 'correct'/'present'/'absent'
- `renderGuessRow(guess, feedback)` - renders `🟩🟨⬛⬛🟩 A B C D E`
- `renderBoard(guesses, answer)` - renders full 6-row grid
- `isWinningGuess(guess, answer)` - checks if guess matches answer

### Step 5: Create `/wordle/wordleDb.js`
Key functions:
- `getCurrentWord()` - get active word record
- `rotateWordIfNeeded()` - check time + solved, rotate if both true
- `markWordSolved(wordId, userId, username)` - atomic first-solver detection
- `getUserGame(userId, word)` - get user's game for current word
- `createUserGame(userId, username, word)` - start new game
- `addGuess(gameId, guess, guesses)` - record guess
- `completeGame(gameId, won)` - mark game finished
- `updateStats(userId, won, guessCount, wasFirstSolver)` - update user stats
- `getOrCreateStats(userId, username)` - get stats (for achievement checks)

### Step 6: Create `/discordCommands/wordle/wordle.js`

Command structure:
```javascript
export const data = new SlashCommandBuilder()
  .setName("wordle")
  .setDescription("Play Wordle! Guess the 5-letter word.")
  .addStringOption(option =>
    option.setName("guess")
      .setDescription("Your 5-letter guess")
      .setMinLength(5)
      .setMaxLength(5));
```

Flow:
1. `rotateWordIfNeeded()` - ensure current word is valid
2. Get/create user's game for current word
3. If already completed → show "already played" embed with next word time
4. If no guess provided → show current board state
5. Validate guess (5 letters, valid word, not duplicate)
6. Add guess to game
7. Check win/loss:
   - **Win**: Mark word solved, check first solver, award coins + item, check achievements
   - **Loss** (6 guesses): Mark game completed, show answer
8. Update stats

### Step 7: Update Achievement System

**`/achievements/achievementConfig.js`** - Add:
```javascript
// In ACHIEVEMENTS object:
WORDLE_FIRST_SOLVE: {
  name: "Word Wizard",
  description: "Be the first to solve a Wordle puzzle",
  rewardValue: 500,
},
WORDLE_5_SOLVES: {
  name: "Vocabulary Builder",
  description: "Successfully solve 5 Wordle puzzles",
  rewardValue: 750,
},
WORDLE_10_SOLVES: {
  name: "Lexicon Master",
  description: "Successfully solve 10 Wordle puzzles",
  rewardValue: 1000,
},

// In ACTION_TYPES object:
WORDLE_SOLVE: "WORDLE_SOLVE",
WORDLE_FIRST_SOLVE: "WORDLE_FIRST_SOLVE",
```

**`/achievements/achievementService.js`** - Add:
```javascript
// In ACTION_TO_ACHIEVEMENTS:
[ACTION_TYPES.WORDLE_SOLVE]: ["WORDLE_5_SOLVES", "WORDLE_10_SOLVES"],
[ACTION_TYPES.WORDLE_FIRST_SOLVE]: ["WORDLE_FIRST_SOLVE"],

// In checkAchievementCriteria switch:
case "WORDLE_FIRST_SOLVE":
  return metadata.actionType === ACTION_TYPES.WORDLE_FIRST_SOLVE;

case "WORDLE_5_SOLVES": {
  const stats = await wordleDb.getOrCreateStats(metadata.userId, metadata.username);
  return stats.games_won >= 5;
}

case "WORDLE_10_SOLVES": {
  const stats = await wordleDb.getOrCreateStats(metadata.userId, metadata.username);
  return stats.games_won >= 10;
}
```

### Step 8: Update Inventory System

**`/inventory/inventoryConfig.js`** - Add:
```javascript
// In ITEM_DEFINITIONS:
wordle_lucky_letter: {
  category: "wordle",
  displayName: "Lucky Letter",
  emoji: "🔤",
  description: "A golden letter tile from being first to solve a Wordle",
  stackable: true,
  sellable: true,
  baseValue: 500,
},

// In ITEM_CATEGORIES:
wordle: { displayName: "Wordle Collectibles", emoji: "🔤", order: 4 },
```

### Step 9: Deploy Command
```bash
node deploy-commands.js
```

---

## Discord Presentation

**Game Board Embed:**
```
Title: Wordle #42
Color: Yellow (playing) / Green (won) / Red (lost)

🟩🟨⬛⬛🟩 `S` `T` `A` `R` `E`
🟨⬛🟩⬛⬛ `O` `U` `N` `C` `E`
⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬜

Fields:
- Guesses: 2/6
- Status: Unsolved! / Solved by 3
- First Solver: @username (if solved)

Footer: Use /wordle guess:<word> to make a guess
```

**Win Embed:**
```
Title: Wordle #42 - Victory!
Color: Green
[Board with all guesses]
Answer: CRANE
Guesses: 4/6
Reward: 🪙 2,000 (or 🪙 3,000 First Solver Bonus!)
Bonus Item: Lucky Letter (if first solver)
```

---

## Edge Cases Handled

1. **Bot restart**: All state in database, games persist
2. **Concurrent first solvers**: Atomic COALESCE ensures only first gets credit
3. **User replays word**: UNIQUE constraint + completed check
4. **Invalid guesses**: Validated against word list
5. **Duplicate guesses**: Checked against existing guesses array
6. **Word rotation timing**: Only rotates when BOTH time exceeded AND solved
7. **Word exhaustion**: Fallback to random if all ~2000 words used

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| `/achievements/achievementConfig.js:10-16` | Achievement definition pattern |
| `/achievements/achievementConfig.js:21-34` | ACTION_TYPES pattern |
| `/achievements/achievementService.js:22-24` | ACTION_TO_ACHIEVEMENTS mapping |
| `/achievements/achievementService.js:82-91` | Criteria check switch |
| `/inventory/inventoryConfig.js:62-97` | Sellable item pattern |
| `/inventory/inventoryConfig.js:103-107` | Category definition |
| `/economy/economyDb.js:44` | `addToWallet()` for rewards |
| `/inventory/inventoryDb.js:91` | `addItem()` for item rewards |
