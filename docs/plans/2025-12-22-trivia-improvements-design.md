# Trivia System Improvements Design

## Overview

Improvements to the trivia system addressing three core problems:
1. **Static leaderboard** - Same people on top, newcomers can't catch up
2. **Limited variety** - Only NFL questions, all free-form format
3. **Stale questions** - AI-generated questions feel formulaic

## Solution Summary

- Monthly seasons with rolling 30-day leaderboard
- New video games category from Open Trivia DB
- Multiple choice question support with button UI
- Type-driven rendering (format per question, not per category)

---

## 1. Leaderboard System

### Monthly Seasons

Seasons run from the 1st of each month (midnight EST) to the last day (11:59pm EST).

**End-of-Month Process:**
1. Cron job runs at midnight EST on the 1st
2. Snapshot current month's top 3 to `trivia_seasons` table
3. Award coins: 1st = 250,000 | 2nd = 100,000 | 3rd = 50,000
4. Post announcement embed to trivia channel
5. Reset monthly point totals (all-time totals preserved separately)

**New Table: `trivia_seasons`**
```sql
CREATE TABLE trivia_seasons (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL,  -- e.g., "2025-01"
  first_place_user_id VARCHAR(64),
  first_place_username VARCHAR(64),
  first_place_points INTEGER,
  second_place_user_id VARCHAR(64),
  second_place_username VARCHAR(64),
  second_place_points INTEGER,
  third_place_user_id VARCHAR(64),
  third_place_username VARCHAR(64),
  third_place_points INTEGER,
  ended_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(year_month)
);
```

### Rolling 30-Day Leaderboard

Default view shows points earned in last 30 days.

**Query Logic:**
```sql
SELECT
  ta.user_id,
  ta.username,
  SUM(taq.point_value) as points
FROM trivia_answers ta
JOIN trivia_active taq ON ta.question_id = taq.id
WHERE ta.is_correct = TRUE
  AND taq.sent_at >= NOW() - INTERVAL '30 days'
GROUP BY ta.user_id, ta.username
ORDER BY points DESC
LIMIT 10;
```

### Leaderboard Views

| Command | View |
|---------|------|
| `/trivialeaderboard` | Rolling 30-day (default) |
| `/trivialeaderboard view:alltime` | All-time totals |
| `/trivialeaderboard view:month` | Current month only |

---

## 2. Question Type System

### Unified Question Model

All questions conform to this structure regardless of source:

```typescript
interface TriviaQuestion {
  id: string | number;
  question: string;
  answer: string;
  acceptable_answers?: string[];  // For free-form fuzzy matching
  choices?: string[];             // For multiple choice (null if free-form)
  type: "multiple_choice" | "free_form";
  point_value: number;
  category: string;
  metadata?: Record<string, unknown>;
}
```

### Type-Driven UI

The `type` field determines how the question is presented and answered:

| Type | Embed | Answer Method | Validation |
|------|-------|---------------|------------|
| `free_form` | Question + "Use `/trivia answer:` or DM me" | Slash command or DM | Fuzzy match against answer + acceptable_answers |
| `multiple_choice` | Question + A/B/C/D choices + buttons | Click button (or type answer) | Exact match to selected choice |

### Migration: Existing NFL Questions

Add `type: "free_form"` to all 348 existing NFL questions in `nflQuestions.json`:

```json
{
  "id": "nfl_mvp_2010",
  "question": "Who won the NFL MVP award for the 2010 season?",
  "answer": "Tom Brady",
  "acceptable_answers": ["Tom Brady", "Brady"],
  "type": "free_form",
  "point_value": 2,
  "metadata": { "year": 2010, "category": "mvp" }
}
```

---

## 3. Video Games Category

### Source: Open Trivia DB

- API: `https://opentdb.com/api.php`
- Category ID: 15 (Entertainment: Video Games)
- Format: Multiple choice only
- License: Creative Commons Attribution-ShareAlike 4.0

### Fetch Script

Create `scripts/fetchVideoGameQuestions.ts`:

1. Fetch questions in batches of 50 (API max)
2. Use session token to avoid duplicates across batches
3. Respect 5-second rate limit between requests
4. Decode HTML entities (`&quot;` → `"`, etc.)
5. Save to `trivia/videogamesQuestions.json`

**Target Questions:**

| Difficulty | Count | Points |
|------------|-------|--------|
| Medium | 150 | 2 |
| Hard | 350 | 3 |
| **Total** | 500 | |

**Session Token:**
```
# Get session token (prevents duplicate questions)
GET https://opentdb.com/api_token.php?command=request
Response: { "token": "abc123..." }

# Token expires after 6 hours of inactivity or when all questions exhausted
# If exhausted, request a new token
```

**API Calls:**
```
# Medium questions (3 batches of 50)
https://opentdb.com/api.php?amount=50&category=15&type=multiple&difficulty=medium&token={session}

# Hard questions (7 batches of 50)
https://opentdb.com/api.php?amount=50&category=15&type=multiple&difficulty=hard&token={session}

# Rate limit: 5 seconds between requests
```

**Output Format:**
```json
{
  "id": "vg_001",
  "question": "What year was the original \"The Legend of Zelda\" released?",
  "answer": "1986",
  "choices": ["1985", "1986", "1987", "1988"],
  "type": "multiple_choice",
  "point_value": 3,
  "category": "videogames",
  "metadata": { "difficulty": "hard", "source": "opentdb" }
}
```

---

## 4. Multiple Choice UI

### Embed Design

```
┌─────────────────────────────────────────────────┐
│ VIDEO GAMES Trivia                              │
├─────────────────────────────────────────────────┤
│ What year was the original "The Legend of       │
│ Zelda" released for the NES?                    │
│                                                 │
│ **A)** 1985                                     │
│ **B)** 1986                                     │
│ **C)** 1987                                     │
│ **D)** 1988                                     │
├─────────────────────────────────────────────────┤
│ Points: 3  │  Window Closes: <t:...>            │
└─────────────────────────────────────────────────┘
        [ A ]  [ B ]  [ C ]  [ D ]
```

### Button Implementation

**Button Configuration:**
- Style: Primary (blurple) for all choices
- Custom ID format: `trivia_{question_id}_{choice_index}`
- Example: `trivia_42_2` = question 42, choice index 2 (C)

**Interaction Handler:**

```typescript
// In index.ts or separate interactionHandler.ts
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('trivia_')) return;

  const [, questionId, choiceIndex] = interaction.customId.split('_');
  await triviaService.handleButtonAnswer(
    interaction,
    parseInt(questionId),
    parseInt(choiceIndex)
  );
});
```

**Response Flow:**
1. User clicks button
2. Bot responds with `interaction.reply({ ephemeral: true })` - user sees immediately
3. If correct: Public announcement in channel via `channel.send()`
4. If wrong: Track attempt, inform user of remaining guesses
5. After 2 wrong: "No guesses remaining" + reveal answer

**Note:** Button clicks are standalone interactions - no deferReply needed. Each click looks up question state from DB by question_id in custom_id.

### Database Changes

**Modify `trivia_active` table:**

```sql
ALTER TABLE trivia_active
ADD COLUMN type VARCHAR(20) DEFAULT 'free_form',
ADD COLUMN choices TEXT[];  -- PostgreSQL array for A/B/C/D
```

**Store shuffled choices on question creation:**
- Shuffle choices when posting question
- Store in `choices` column
- Button index maps to stored array position

---

## 5. Category Weighting

### Rotation Strategy

When selecting the next question category:

```typescript
const categoryWeights: Record<string, number> = {
  nfl: 0.7,        // 70% chance
  videogames: 0.3  // 30% chance
};
```

This keeps NFL as primary (it's a fantasy football bot) while mixing in variety.

**Selection Algorithm:**
```typescript
function selectWeightedCategory(availableCategories: string[]): string {
  // 1. Filter weights to only categories with unasked questions
  const available = availableCategories.filter(c => c in categoryWeights);

  // 2. If only one category available, use it
  if (available.length === 1) return available[0];

  // 3. Normalize weights for available categories
  const totalWeight = available.reduce((sum, c) => sum + categoryWeights[c], 0);

  // 4. Weighted random selection
  let random = Math.random() * totalWeight;
  for (const category of available) {
    random -= categoryWeights[category];
    if (random <= 0) return category;
  }

  return available[0]; // fallback
}
```

### Future Extensibility

To add new categories:
1. Create `{category}Questions.json` in `/trivia`
2. Set `type` field per question
3. Optionally add to `categoryWeights`
4. Category loader auto-discovers the file

---

## 6. Implementation Tasks

### Database
- [ ] Create `trivia_seasons` table
- [ ] Add `type` column to `trivia_active`
- [ ] Add `choices` column to `trivia_active`
- [ ] Add index on `trivia_active.sent_at` for 30-day queries

### Scripts
- [ ] Create `scripts/fetchVideoGameQuestions.ts`
- [ ] Create migration script to add `type: "free_form"` to NFL questions

### Trivia Service
- [ ] Add `buildMultipleChoiceEmbed()` method
- [ ] Add `handleButtonAnswer()` method
- [ ] Modify `sendQuestion()` to handle both types
- [ ] Modify `processAnswerSubmission()` to validate multiple choice

### Commands
- [ ] Update `/trivialeaderboard` with view options
- [ ] Add button interaction handler to `index.ts`

### Scheduler
- [ ] Add end-of-month cron job for season snapshots
- [ ] Add category weighting to `sendRandomQuestion()`

### Files
- [ ] Migrate `nflQuestions.json` to include `type` field
- [ ] Generate `videogamesQuestions.json` via fetch script

---

## 7. Points Summary

| Category | Type | Difficulty | Points |
|----------|------|------------|--------|
| NFL | Free-form | Variable | 1-3 |
| Video Games | Multiple Choice | Medium | 2 |
| Video Games | Multiple Choice | Hard | 3 |

---

## 8. Rewards Summary

### Per-Question
- Correct answer: Points + 2,500 coins + NFLmon chance + training XP (unchanged)

### Monthly Season
| Place | Coins |
|-------|-------|
| 1st | 250,000 |
| 2nd | 100,000 |
| 3rd | 50,000 |
