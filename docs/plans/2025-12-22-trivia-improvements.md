# Trivia Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add monthly seasons with rolling 30-day leaderboard, video games category with multiple choice UI, and type-driven question rendering.

**Architecture:** Extend existing trivia system with new `type` field on questions to drive UI rendering. Multiple choice questions show Discord buttons; free-form questions use existing DM/slash flow. Leaderboards computed from trivia_answers joined with trivia_active for time-windowed views.

**Tech Stack:** TypeScript, Discord.js v14 (buttons), PostgreSQL, node-cron, Open Trivia DB API

**Design Doc:** `docs/plans/2025-12-22-trivia-improvements-design.md`

---

## Task 1: Database Schema - Create trivia_seasons Table

**Files:**
- Create: `scripts/migrations/create-trivia-seasons.sql`

**Step 1: Write the migration SQL**

```sql
-- scripts/migrations/create-trivia-seasons.sql
-- Monthly trivia season winners and rewards tracking

CREATE TABLE IF NOT EXISTS trivia_seasons (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL,
  first_place_user_id VARCHAR(64),
  first_place_username VARCHAR(64),
  first_place_points INTEGER DEFAULT 0,
  second_place_user_id VARCHAR(64),
  second_place_username VARCHAR(64),
  second_place_points INTEGER DEFAULT 0,
  third_place_user_id VARCHAR(64),
  third_place_username VARCHAR(64),
  third_place_points INTEGER DEFAULT 0,
  rewards_paid BOOLEAN DEFAULT FALSE,
  ended_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(year_month)
);

-- Index for quick lookups by month
CREATE INDEX IF NOT EXISTS idx_trivia_seasons_year_month ON trivia_seasons(year_month);
```

**Step 2: Run the migration**

Run: `psql $DATABASE_URL -f scripts/migrations/create-trivia-seasons.sql`
Expected: CREATE TABLE, CREATE INDEX

**Step 3: Commit**

```bash
git add scripts/migrations/create-trivia-seasons.sql
git commit -m "feat(trivia): add trivia_seasons table for monthly competitions"
```

---

## Task 2: Database Schema - Add type and choices to trivia_active

**Files:**
- Create: `scripts/migrations/add-trivia-active-columns.sql`

**Step 1: Write the migration SQL**

```sql
-- scripts/migrations/add-trivia-active-columns.sql
-- Add question type and multiple choice support

-- Add type column (free_form or multiple_choice)
ALTER TABLE trivia_active
ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'free_form';

-- Add choices column for multiple choice questions (stores shuffled A/B/C/D)
ALTER TABLE trivia_active
ADD COLUMN IF NOT EXISTS choices TEXT[];

-- Add index on sent_at for efficient 30-day queries
CREATE INDEX IF NOT EXISTS idx_trivia_active_sent_at ON trivia_active(sent_at);
```

**Step 2: Run the migration**

Run: `psql $DATABASE_URL -f scripts/migrations/add-trivia-active-columns.sql`
Expected: ALTER TABLE (x2), CREATE INDEX

**Step 3: Commit**

```bash
git add scripts/migrations/add-trivia-active-columns.sql
git commit -m "feat(trivia): add type and choices columns to trivia_active"
```

---

## Task 3: Update TypeScript Interfaces

**Files:**
- Modify: `trivia/categoryLoader.ts` (TriviaQuestion interface)
- Modify: `trivia/triviaDb.ts` (TriviaActiveQuestion, SaveActiveQuestionData interfaces)

**Step 1: Update categoryLoader.ts TriviaQuestion interface**

In `trivia/categoryLoader.ts`, find the TriviaQuestion interface (around line 14) and update:

```typescript
export interface TriviaQuestion {
  readonly id: string | number;
  readonly question: string;
  readonly answer: string;
  readonly acceptable_answers?: readonly string[];
  readonly choices?: readonly string[];  // For multiple choice (A/B/C/D options)
  readonly type: 'multiple_choice' | 'free_form';
  readonly point_value?: number;
  readonly metadata?: Record<string, unknown>;
}
```

**Step 2: Update triviaDb.ts TriviaActiveQuestion interface**

In `trivia/triviaDb.ts`, find TriviaActiveQuestion (around line 16) and update:

```typescript
export interface TriviaActiveQuestion {
  readonly id: number;
  readonly category: TriviaCategory;
  readonly question_id: string | null;
  readonly question: string;
  readonly answer: string;
  readonly acceptable_answers: string[] | null;
  readonly choices: string[] | null;  // ADD THIS
  readonly type: 'multiple_choice' | 'free_form';  // ADD THIS
  readonly point_value: number;
  readonly source_data: string | null;
  readonly channel_id: string;
  readonly window_closes_at: Date;
  readonly is_closed: boolean;
  readonly sent_at: Date;
}
```

**Step 3: Update SaveActiveQuestionData interface**

In `trivia/triviaDb.ts`, find SaveActiveQuestionData (around line 59) and update:

```typescript
export interface SaveActiveQuestionData {
  readonly category: TriviaCategory;
  readonly questionId: string | null;
  readonly question: string;
  readonly answer: string;
  readonly acceptableAnswers: string | null;
  readonly choices: string[] | null;  // ADD THIS
  readonly type: 'multiple_choice' | 'free_form';  // ADD THIS
  readonly pointValue: number;
  readonly sourceData: string | null;
  readonly channelId: string;
  readonly windowClosesAt: Date;
}
```

**Step 4: Update saveActiveQuestion function**

In `trivia/triviaDb.ts`, find saveActiveQuestion (around line 130) and update the INSERT:

```typescript
export async function saveActiveQuestion(
  data: SaveActiveQuestionData
): Promise<TriviaActiveQuestion> {
  const windowClosesAt = data.windowClosesAt instanceof Date
    ? data.windowClosesAt.toISOString()
    : data.windowClosesAt;

  // Format choices as PostgreSQL array literal if present
  const choicesArray = data.choices?.length
    ? `{${data.choices.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`
    : null;

  const result = await sql<TriviaActiveQuestion>`
    INSERT INTO trivia_active
      (category, question_id, question, answer, acceptable_answers, choices, type, point_value, source_data, channel_id, window_closes_at)
    VALUES
      (${data.category}, ${data.questionId}, ${data.question}, ${data.answer}, ${data.acceptableAnswers}, ${choicesArray}, ${data.type}, ${data.pointValue}, ${data.sourceData}, ${data.channelId}, ${windowClosesAt})
    RETURNING *
  `;
  return result.rows[0];
}
```

**Step 5: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to these changes)

**Step 6: Commit**

```bash
git add trivia/categoryLoader.ts trivia/triviaDb.ts
git commit -m "feat(trivia): update interfaces for type and choices fields"
```

---

## Task 4: Migrate NFL Questions - Add type Field

**Files:**
- Create: `scripts/migrateNflQuestions.ts`
- Modify: `trivia/nflQuestions.json`

**Step 1: Create migration script**

```typescript
// scripts/migrateNflQuestions.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OldQuestion {
  id: string;
  question: string;
  answer: string;
  acceptable_answers?: string[];
  point_value?: number;
  metadata?: Record<string, unknown>;
}

interface NewQuestion extends OldQuestion {
  type: 'free_form';
}

const filePath = path.join(__dirname, '../trivia/nflQuestions.json');

const content = fs.readFileSync(filePath, 'utf-8');
const questions: OldQuestion[] = JSON.parse(content);

const migratedQuestions: NewQuestion[] = questions.map(q => ({
  ...q,
  type: 'free_form' as const,
}));

fs.writeFileSync(filePath, JSON.stringify(migratedQuestions, null, 2) + '\n');

console.log(`Migrated ${migratedQuestions.length} NFL questions to include type field`);
```

**Step 2: Run migration**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsx scripts/migrateNflQuestions.ts`
Expected: "Migrated 348 NFL questions to include type field"

**Step 3: Verify migration**

Run: `head -20 /home/aboorde/codestuff/db-trivia-improvements/trivia/nflQuestions.json`
Expected: First question should have `"type": "free_form"`

**Step 4: Commit**

```bash
git add scripts/migrateNflQuestions.ts trivia/nflQuestions.json
git commit -m "feat(trivia): migrate NFL questions to include type field"
```

---

## Task 5: Create Video Games Fetch Script

**Files:**
- Create: `scripts/fetchVideoGameQuestions.ts`

**Step 1: Write the fetch script**

```typescript
// scripts/fetchVideoGameQuestions.ts
// Fetches video game trivia questions from Open Trivia DB and saves to JSON

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decode } from 'html-entities';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
interface OpenTDBResponse {
  response_code: number;
  results: OpenTDBQuestion[];
}

interface OpenTDBQuestion {
  category: string;
  type: string;
  difficulty: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

interface TriviaQuestion {
  id: string;
  question: string;
  answer: string;
  choices: string[];
  type: 'multiple_choice';
  point_value: number;
  category: string;
  metadata: {
    difficulty: string;
    source: string;
  };
}

// Config
const CONFIG = {
  CATEGORY_ID: 15, // Video Games
  BATCH_SIZE: 50,
  RATE_LIMIT_MS: 5500, // 5.5 seconds to be safe
  TARGET_MEDIUM: 150,
  TARGET_HARD: 350,
  POINTS_MEDIUM: 2,
  POINTS_HARD: 3,
};

// Utility: Sleep
const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// Utility: Shuffle array
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Get session token
async function getSessionToken(): Promise<string> {
  const response = await fetch('https://opentdb.com/api_token.php?command=request');
  const data = await response.json() as { response_code: number; token: string };

  if (data.response_code !== 0) {
    throw new Error(`Failed to get session token: code ${data.response_code}`);
  }

  console.log('Got session token');
  return data.token;
}

// Fetch a batch of questions
async function fetchBatch(
  token: string,
  difficulty: 'medium' | 'hard',
  amount: number
): Promise<OpenTDBQuestion[]> {
  const url = `https://opentdb.com/api.php?amount=${amount}&category=${CONFIG.CATEGORY_ID}&type=multiple&difficulty=${difficulty}&token=${token}`;

  const response = await fetch(url);
  const data = await response.json() as OpenTDBResponse;

  if (data.response_code === 4) {
    console.log(`Token exhausted for ${difficulty}, all available questions fetched`);
    return [];
  }

  if (data.response_code !== 0) {
    console.warn(`API returned code ${data.response_code} for ${difficulty}`);
    return [];
  }

  return data.results;
}

// Convert API question to our format
function convertQuestion(
  q: OpenTDBQuestion,
  index: number,
  difficulty: 'medium' | 'hard'
): TriviaQuestion {
  const allChoices = shuffle([q.correct_answer, ...q.incorrect_answers]);

  return {
    id: `vg_${difficulty}_${index}`,
    question: decode(q.question),
    answer: decode(q.correct_answer),
    choices: allChoices.map(c => decode(c)),
    type: 'multiple_choice',
    point_value: difficulty === 'hard' ? CONFIG.POINTS_HARD : CONFIG.POINTS_MEDIUM,
    category: 'videogames',
    metadata: {
      difficulty,
      source: 'opentdb',
    },
  };
}

// Main
async function main(): Promise<void> {
  console.log('Fetching video game questions from Open Trivia DB...');
  console.log(`Target: ${CONFIG.TARGET_MEDIUM} medium, ${CONFIG.TARGET_HARD} hard`);

  const token = await getSessionToken();
  await sleep(CONFIG.RATE_LIMIT_MS);

  const allQuestions: TriviaQuestion[] = [];

  // Fetch medium questions
  console.log('\nFetching medium difficulty...');
  let mediumCount = 0;
  while (mediumCount < CONFIG.TARGET_MEDIUM) {
    const needed = Math.min(CONFIG.BATCH_SIZE, CONFIG.TARGET_MEDIUM - mediumCount);
    const batch = await fetchBatch(token, 'medium', needed);

    if (batch.length === 0) break;

    batch.forEach((q, i) => {
      allQuestions.push(convertQuestion(q, mediumCount + i, 'medium'));
    });

    mediumCount += batch.length;
    console.log(`  Fetched ${mediumCount}/${CONFIG.TARGET_MEDIUM} medium`);

    if (mediumCount < CONFIG.TARGET_MEDIUM) {
      await sleep(CONFIG.RATE_LIMIT_MS);
    }
  }

  // Fetch hard questions
  console.log('\nFetching hard difficulty...');
  let hardCount = 0;
  while (hardCount < CONFIG.TARGET_HARD) {
    const needed = Math.min(CONFIG.BATCH_SIZE, CONFIG.TARGET_HARD - hardCount);
    const batch = await fetchBatch(token, 'hard', needed);

    if (batch.length === 0) break;

    batch.forEach((q, i) => {
      allQuestions.push(convertQuestion(q, hardCount + i, 'hard'));
    });

    hardCount += batch.length;
    console.log(`  Fetched ${hardCount}/${CONFIG.TARGET_HARD} hard`);

    if (hardCount < CONFIG.TARGET_HARD) {
      await sleep(CONFIG.RATE_LIMIT_MS);
    }
  }

  // Save to file
  const outputPath = path.join(__dirname, '../trivia/videogamesQuestions.json');
  fs.writeFileSync(outputPath, JSON.stringify(allQuestions, null, 2) + '\n');

  console.log(`\nDone! Saved ${allQuestions.length} questions to trivia/videogamesQuestions.json`);
  console.log(`  Medium: ${mediumCount} (${CONFIG.POINTS_MEDIUM} pts each)`);
  console.log(`  Hard: ${hardCount} (${CONFIG.POINTS_HARD} pts each)`);
}

main().catch(console.error);
```

**Step 2: Install html-entities dependency**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npm install html-entities`
Expected: added 1 package

**Step 3: Commit script (before running)**

```bash
git add scripts/fetchVideoGameQuestions.ts package.json package-lock.json
git commit -m "feat(trivia): add video game questions fetch script"
```

---

## Task 6: Fetch Video Game Questions

**Files:**
- Create: `trivia/videogamesQuestions.json` (generated)

**Step 1: Run the fetch script**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsx scripts/fetchVideoGameQuestions.ts`
Expected: Takes ~1-2 minutes (rate limited). Should output ~500 questions.

**Step 2: Verify output**

Run: `wc -l /home/aboorde/codestuff/db-trivia-improvements/trivia/videogamesQuestions.json && head -30 /home/aboorde/codestuff/db-trivia-improvements/trivia/videogamesQuestions.json`
Expected: JSON file with video game questions having type: "multiple_choice" and choices array

**Step 3: Commit questions**

```bash
git add trivia/videogamesQuestions.json
git commit -m "feat(trivia): add 500 video game questions from Open Trivia DB"
```

---

## Task 7: Update TriviaService - sendQuestion for Type Support

**Files:**
- Modify: `trivia/triviaService.ts`

**Step 1: Update sendQuestion to pass type and choices**

In `trivia/triviaService.ts`, find the `sendQuestion` method (around line 194). Update the `saveActiveQuestion` call (around line 255-267):

```typescript
const activeQuestion = await triviaDb.saveActiveQuestion({
  category,
  questionId: selectedQuestion.id != null ? String(selectedQuestion.id) : null,
  question: selectedQuestion.question,
  answer: selectedQuestion.answer,
  acceptableAnswers,
  choices: selectedQuestion.choices ? [...selectedQuestion.choices] : null,
  type: selectedQuestion.type,
  pointValue: selectedQuestion.point_value || 1,
  sourceData: selectedQuestion.metadata
    ? JSON.stringify(selectedQuestion.metadata)
    : null,
  channelId,
  windowClosesAt,
});
```

**Step 2: Update buildQuestionEmbed call to pass type**

In the same method, update the embed building (around line 270):

```typescript
// Build and send embed
const embed = this.buildQuestionEmbed(selectedQuestion, category, windowClosesAt);

// Add buttons for multiple choice questions
if (selectedQuestion.type === 'multiple_choice' && selectedQuestion.choices) {
  const row = this.buildChoiceButtons(activeQuestion.id, selectedQuestion.choices);
  await (channel as TextChannel).send({ embeds: [embed], components: [row] });
} else {
  await (channel as TextChannel).send({ embeds: [embed] });
}
```

**Step 3: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: Errors about missing buildChoiceButtons method (we'll add it next)

**Step 4: Commit partial progress**

```bash
git add trivia/triviaService.ts
git commit -m "wip(trivia): update sendQuestion for type and choices support"
```

---

## Task 8: Add Multiple Choice Embed and Buttons

**Files:**
- Modify: `trivia/triviaService.ts`

**Step 1: Add imports at top of file**

In `trivia/triviaService.ts`, update the discord.js import (line 2):

```typescript
import {
  Client,
  EmbedBuilder,
  Message,
  TextChannel,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction
} from 'discord.js';
```

**Step 2: Add buildChoiceButtons method**

Add this method to the TriviaService class (after buildResultsEmbed, around line 640):

```typescript
/**
 * Build button row for multiple choice questions
 * @param questionId - Active question ID (for button custom_id)
 * @param choices - Array of choice strings [A, B, C, D]
 * @returns ActionRow with buttons
 */
buildChoiceButtons(questionId: number, choices: readonly string[]): ActionRowBuilder<ButtonBuilder> {
  const labels = ['A', 'B', 'C', 'D'];

  const buttons = choices.slice(0, 4).map((_, index) =>
    new ButtonBuilder()
      .setCustomId(`trivia_${questionId}_${index}`)
      .setLabel(labels[index])
      .setStyle(ButtonStyle.Primary)
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}
```

**Step 3: Update buildQuestionEmbed for multiple choice**

Replace the existing `buildQuestionEmbed` method (around line 580):

```typescript
/**
 * Build question embed
 * @param question - Question data
 * @param category - Category name
 * @param windowClosesAt - When the window closes
 * @returns Notification embed
 */
buildQuestionEmbed(question: categoryLoader.TriviaQuestion, category: TriviaCategory, windowClosesAt: Date): EmbedBuilder {
  const color = categoryLoader.getCategoryColor(category);
  const title = `${category.toUpperCase()} Trivia`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setTimestamp();

  // Build description based on question type
  if (question.type === 'multiple_choice' && question.choices) {
    const choiceLabels = ['A', 'B', 'C', 'D'];
    const choicesText = question.choices
      .slice(0, 4)
      .map((choice, i) => `**${choiceLabels[i]})** ${choice}`)
      .join('\n');

    embed.setDescription(`${question.question}\n\n${choicesText}`);
    embed.addFields({
      name: 'How to Answer',
      value: 'Click a button below or use `/trivia answer:A`',
      inline: false,
    });
  } else {
    embed.setDescription(question.question);
    embed.addFields({
      name: 'How to Answer',
      value: 'Use `/trivia answer:your answer` or DM me directly',
      inline: false,
    });
  }

  embed.addFields({
    name: 'Points',
    value: `${question.point_value || 1}`,
    inline: true,
  });
  embed.addFields({
    name: 'Window Closes',
    value: `<t:${Math.floor(windowClosesAt.getTime() / 1000)}:R>`,
    inline: true,
  });

  return embed;
}
```

**Step 4: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No new errors

**Step 5: Commit**

```bash
git add trivia/triviaService.ts
git commit -m "feat(trivia): add multiple choice embed and button support"
```

---

## Task 9: Add Button Interaction Handler

**Files:**
- Modify: `trivia/triviaService.ts`
- Modify: `index.ts`

**Step 1: Add handleButtonAnswer method to TriviaService**

Add this method to TriviaService class (after handleSlashAnswer, around line 520):

```typescript
/**
 * Handle a button click for multiple choice answer
 * @param interaction - Discord button interaction
 */
async handleButtonAnswer(interaction: ButtonInteraction): Promise<void> {
  // Parse custom_id: trivia_{questionId}_{choiceIndex}
  const parts = interaction.customId.split('_');
  if (parts.length !== 3 || parts[0] !== 'trivia') {
    return;
  }

  const questionId = parseInt(parts[1], 10);
  const choiceIndex = parseInt(parts[2], 10);

  if (isNaN(questionId) || isNaN(choiceIndex)) {
    await interaction.reply({ content: 'Invalid button data.', ephemeral: true });
    return;
  }

  // Get the active question
  const activeQuestion = await triviaDb.getAnyActiveQuestion() as ActiveQuestion | null;

  if (!activeQuestion || activeQuestion.id !== questionId) {
    await interaction.reply({ content: 'This question is no longer active!', ephemeral: true });
    return;
  }

  // Check if window is still open
  if (activeQuestion.is_closed || new Date() > new Date(activeQuestion.window_closes_at)) {
    await interaction.reply({ content: 'The answer window has closed for this question!', ephemeral: true });
    return;
  }

  // Get the selected answer from choices
  const choices = activeQuestion.choices;
  if (!choices || choiceIndex >= choices.length) {
    await interaction.reply({ content: 'Invalid choice.', ephemeral: true });
    return;
  }

  const selectedAnswer = choices[choiceIndex];

  // Process using shared logic
  const result = await this.processAnswerSubmission(
    interaction.user.id,
    interaction.user.username,
    selectedAnswer,
    activeQuestion
  );

  // Send ephemeral reply
  await interaction.reply({ content: result.message, ephemeral: true });

  // Handle announcements
  if (result.isCorrect) {
    await this.announceCorrectAnswer(activeQuestion, interaction.user.username);
  } else if (result.isExhausted) {
    await this.announceExhaustedGuesses(activeQuestion, interaction.user.username);
  }
}
```

**Step 2: Add button handler to index.ts**

Find the interactionCreate handler in `index.ts`. Add button handling. Look for existing interaction handling (likely in an `interactionCreate` event). Add:

```typescript
// Handle button interactions for trivia
if (interaction.isButton() && interaction.customId.startsWith('trivia_')) {
  const triviaService = client.triviaService;
  if (triviaService) {
    await triviaService.handleButtonAnswer(interaction);
  }
  return;
}
```

**Step 3: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add trivia/triviaService.ts index.ts
git commit -m "feat(trivia): add button interaction handler for multiple choice"
```

---

## Task 10: Add Leaderboard Database Functions

**Files:**
- Modify: `trivia/triviaDb.ts`

**Step 1: Add getRolling30DayLeaderboard function**

Add to `trivia/triviaDb.ts` after `getLeaderboard` (around line 315):

```typescript
/**
 * Get leaderboard for the last 30 days
 * @param limit - Number of users to return
 * @returns Leaderboard entries from last 30 days
 */
export async function getRolling30DayLeaderboard(limit: number = 10): Promise<{ user_id: string; username: string; points: number }[]> {
  const result = await sql<{ user_id: string; username: string; points: number }>`
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
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Get leaderboard for the current month
 * @param limit - Number of users to return
 * @returns Leaderboard entries from current month
 */
export async function getCurrentMonthLeaderboard(limit: number = 10): Promise<{ user_id: string; username: string; points: number }[]> {
  const result = await sql<{ user_id: string; username: string; points: number }>`
    SELECT
      ta.user_id,
      ta.username,
      SUM(taq.point_value) as points
    FROM trivia_answers ta
    JOIN trivia_active taq ON ta.question_id = taq.id
    WHERE ta.is_correct = TRUE
      AND taq.sent_at >= DATE_TRUNC('month', NOW())
    GROUP BY ta.user_id, ta.username
    ORDER BY points DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Save monthly season results
 */
export async function saveSeasonResults(
  yearMonth: string,
  winners: { userId: string; username: string; points: number }[]
): Promise<void> {
  const [first, second, third] = winners;

  await sql`
    INSERT INTO trivia_seasons (
      year_month,
      first_place_user_id, first_place_username, first_place_points,
      second_place_user_id, second_place_username, second_place_points,
      third_place_user_id, third_place_username, third_place_points
    ) VALUES (
      ${yearMonth},
      ${first?.userId ?? null}, ${first?.username ?? null}, ${first?.points ?? 0},
      ${second?.userId ?? null}, ${second?.username ?? null}, ${second?.points ?? 0},
      ${third?.userId ?? null}, ${third?.username ?? null}, ${third?.points ?? 0}
    )
    ON CONFLICT (year_month) DO UPDATE SET
      first_place_user_id = EXCLUDED.first_place_user_id,
      first_place_username = EXCLUDED.first_place_username,
      first_place_points = EXCLUDED.first_place_points,
      second_place_user_id = EXCLUDED.second_place_user_id,
      second_place_username = EXCLUDED.second_place_username,
      second_place_points = EXCLUDED.second_place_points,
      third_place_user_id = EXCLUDED.third_place_user_id,
      third_place_username = EXCLUDED.third_place_username,
      third_place_points = EXCLUDED.third_place_points,
      ended_at = NOW()
  `;
}

/**
 * Mark season rewards as paid
 */
export async function markSeasonRewardsPaid(yearMonth: string): Promise<void> {
  await sql`
    UPDATE trivia_seasons
    SET rewards_paid = TRUE
    WHERE year_month = ${yearMonth}
  `;
}

/**
 * Get season results
 */
export async function getSeasonResults(yearMonth: string): Promise<{
  first_place_user_id: string | null;
  first_place_username: string | null;
  first_place_points: number;
  second_place_user_id: string | null;
  second_place_username: string | null;
  second_place_points: number;
  third_place_user_id: string | null;
  third_place_username: string | null;
  third_place_points: number;
  rewards_paid: boolean;
} | null> {
  const result = await sql`
    SELECT * FROM trivia_seasons WHERE year_month = ${yearMonth}
  `;
  return result.rows[0] ?? null;
}
```

**Step 2: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add trivia/triviaDb.ts
git commit -m "feat(trivia): add leaderboard database functions for 30-day and monthly views"
```

---

## Task 11: Update Leaderboard Command with Views

**Files:**
- Modify: `discordCommands/trivialeaderboard/trivialeaderboard.ts`

**Step 1: Update command with view option**

Replace the entire file:

```typescript
import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as triviaDb from '../../trivia/triviaDb.js';

export const data = new SlashCommandBuilder()
  .setName('trivialeaderboard')
  .setDescription('View the trivia leaderboard')
  .addStringOption((option) =>
    option
      .setName('view')
      .setDescription('Which leaderboard to show')
      .setRequired(false)
      .addChoices(
        { name: 'Last 30 Days (Default)', value: '30day' },
        { name: 'Current Month', value: 'month' },
        { name: 'All Time', value: 'alltime' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const view = interaction.options.getString('view') || '30day';

  try {
    let leaderboard: { user_id?: string; username: string; points?: number; total_points?: number }[];
    let title: string;
    let footer: string;

    switch (view) {
      case 'month':
        leaderboard = await triviaDb.getCurrentMonthLeaderboard(10);
        title = 'Trivia Leaderboard - Current Month';
        footer = 'Points earned this month';
        break;
      case 'alltime':
        leaderboard = await triviaDb.getLeaderboard(10);
        title = 'Trivia Leaderboard - All Time';
        footer = 'Total points earned';
        break;
      case '30day':
      default:
        leaderboard = await triviaDb.getRolling30DayLeaderboard(10);
        title = 'Trivia Leaderboard - Last 30 Days';
        footer = 'Points earned in last 30 days';
        break;
    }

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No trivia scores yet! Be the first to answer a question.',
      });
      return;
    }

    const medals: string[] = ['🥇', '🥈', '🥉'];

    const leaderboardText: string = leaderboard
      .map((entry, index: number) => {
        const medal: string = medals[index] || `${index + 1}.`;
        const points = entry.points ?? entry.total_points ?? 0;
        return `${medal} **${entry.username}** - ${points} pts`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(title)
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: footer });

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('trivialeaderboard command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `Error fetching leaderboard: ${message}`,
    });
  }
}
```

**Step 2: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add discordCommands/trivialeaderboard/trivialeaderboard.ts
git commit -m "feat(trivia): add 30-day, monthly, and all-time leaderboard views"
```

---

## Task 12: Add Category Weighting to TriviaService

**Files:**
- Modify: `trivia/triviaService.ts`

**Step 1: Add category weights constant**

Near the top of `trivia/triviaService.ts` (after imports, around line 10), add:

```typescript
// Category weights for random selection
const CATEGORY_WEIGHTS: Record<string, number> = {
  nfl: 0.7,
  videogames: 0.3,
};
```

**Step 2: Add weighted selection helper**

Add this helper function before the class definition (around line 70):

```typescript
/**
 * Select a category using weighted random selection
 * Only considers categories that have available questions
 */
function selectWeightedCategory(availableCategories: string[]): string {
  // Filter to categories with defined weights
  const weighted = availableCategories.filter(c => c in CATEGORY_WEIGHTS);

  // If no weighted categories available, pick random from all
  if (weighted.length === 0) {
    return availableCategories[Math.floor(Math.random() * availableCategories.length)];
  }

  // If only one category, use it
  if (weighted.length === 1) {
    return weighted[0];
  }

  // Calculate total weight for available categories
  const totalWeight = weighted.reduce((sum, c) => sum + CATEGORY_WEIGHTS[c], 0);

  // Weighted random selection
  let random = Math.random() * totalWeight;
  for (const category of weighted) {
    random -= CATEGORY_WEIGHTS[category];
    if (random <= 0) return category;
  }

  return weighted[0]; // fallback
}
```

**Step 3: Update sendRandomQuestion to use weighted selection**

In `sendRandomQuestion` method (around line 185), replace the random category selection:

Find:
```typescript
// Pick random category with available questions
const randomCategory = availableCategories[Math.floor(Math.random() * availableCategories.length)];
```

Replace with:
```typescript
// Pick weighted random category
const randomCategory = selectWeightedCategory(availableCategories);
```

**Step 4: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add trivia/triviaService.ts
git commit -m "feat(trivia): add weighted category selection (70% NFL, 30% video games)"
```

---

## Task 13: Add End-of-Month Season Cron Job

**Files:**
- Modify: `trivia/triviaService.ts`

**Step 1: Add season end handler method**

Add this method to the TriviaService class (after closeCurrentQuestion, around line 145):

```typescript
/**
 * Handle end of month - snapshot winners, pay rewards, announce
 * Should be called at midnight on the 1st of each month
 */
async handleSeasonEnd(): Promise<void> {
  // Get last month's year-month string (e.g., "2025-01")
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yearMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

  console.log(`[TRIVIA] Processing season end for ${yearMonth}`);

  // Check if already processed
  const existing = await triviaDb.getSeasonResults(yearMonth);
  if (existing?.rewards_paid) {
    console.log(`[TRIVIA] Season ${yearMonth} already processed`);
    return;
  }

  // Get the leaderboard for last month
  // We need to query for the specific month, not "current month"
  const leaderboard = await this.getMonthLeaderboard(lastMonth);

  if (leaderboard.length === 0) {
    console.log(`[TRIVIA] No participants in ${yearMonth}`);
    return;
  }

  // Save season results
  const winners = leaderboard.slice(0, 3).map(entry => ({
    userId: entry.user_id,
    username: entry.username,
    points: entry.points,
  }));

  await triviaDb.saveSeasonResults(yearMonth, winners);

  // Pay rewards
  const rewards = [250000, 100000, 50000];
  for (let i = 0; i < Math.min(winners.length, 3); i++) {
    if (winners[i].userId) {
      try {
        await economyDb.getOrCreateUser(winners[i].userId, winners[i].username);
        await economyDb.addToWallet(winners[i].userId, rewards[i]);
        console.log(`[TRIVIA] Paid ${rewards[i]} to ${winners[i].username} (${i + 1}${['st', 'nd', 'rd'][i]} place)`);
      } catch (error) {
        console.error(`[TRIVIA] Failed to pay ${winners[i].username}:`, error);
      }
    }
  }

  // Mark as paid
  await triviaDb.markSeasonRewardsPaid(yearMonth);

  // Announce in channel
  await this.announceSeasonResults(yearMonth, winners, rewards);

  console.log(`[TRIVIA] Season ${yearMonth} completed`);
}

/**
 * Get leaderboard for a specific month
 */
private async getMonthLeaderboard(month: Date): Promise<{ user_id: string; username: string; points: number }[]> {
  const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const endOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);

  // This requires a custom query - add to triviaDb
  return await triviaDb.getLeaderboardForDateRange(startOfMonth, endOfMonth, 10);
}

/**
 * Announce season results in trivia channel
 */
private async announceSeasonResults(
  yearMonth: string,
  winners: { userId: string; username: string; points: number }[],
  rewards: number[]
): Promise<void> {
  const channelId = process.env.TRIVIA_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const medals = ['🥇', '🥈', '🥉'];
    const [year, monthNum] = yearMonth.split('-');
    const monthName = new Date(parseInt(year), parseInt(monthNum) - 1).toLocaleString('en-US', { month: 'long' });

    let description = `**${monthName} ${year} Trivia Season has ended!**\n\n`;

    winners.forEach((winner, i) => {
      description += `${medals[i]} **${winner.username}** - ${winner.points} pts → 🪙 ${rewards[i].toLocaleString()}\n`;
    });

    description += '\nA new season has begun! Good luck!';

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('🏆 Trivia Season Results')
      .setDescription(description)
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (error) {
    console.error('[TRIVIA] Error announcing season results:', error);
  }
}
```

**Step 2: Add getLeaderboardForDateRange to triviaDb.ts**

Add to `trivia/triviaDb.ts`:

```typescript
/**
 * Get leaderboard for a specific date range
 */
export async function getLeaderboardForDateRange(
  startDate: Date,
  endDate: Date,
  limit: number = 10
): Promise<{ user_id: string; username: string; points: number }[]> {
  const result = await sql<{ user_id: string; username: string; points: number }>`
    SELECT
      ta.user_id,
      ta.username,
      SUM(taq.point_value) as points
    FROM trivia_answers ta
    JOIN trivia_active taq ON ta.question_id = taq.id
    WHERE ta.is_correct = TRUE
      AND taq.sent_at >= ${startDate.toISOString()}
      AND taq.sent_at <= ${endDate.toISOString()}
    GROUP BY ta.user_id, ta.username
    ORDER BY points DESC
    LIMIT ${limit}
  `;
  return result.rows;
}
```

**Step 3: Add cron job in init()**

In the `init()` method of TriviaService (around line 84), add after the existing cron schedules:

```typescript
// End-of-month season processing - runs at midnight on the 1st
cron.schedule(
  '0 0 1 * *',
  async () => {
    await this.handleSeasonEnd();
  },
  { timezone: 'America/New_York' }
);

console.log('[TRIVIA] Season end scheduler initialized (midnight on 1st of month)');
```

**Step 4: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add trivia/triviaService.ts trivia/triviaDb.ts
git commit -m "feat(trivia): add end-of-month season cron job with rewards"
```

---

## Task 14: Update Category Colors

**Files:**
- Modify: `trivia/categoryLoader.ts`

**Step 1: Add videogames color**

In `trivia/categoryLoader.ts`, find `categoryColors` (around line 35) and add videogames:

```typescript
const categoryColors: Record<string, number> = {
  nfl: 0x013369,      // NFL navy blue
  wpfl: 0x00ff88,     // WPFL bright green
  videogames: 0x9146ff, // Twitch purple (gaming)
  default: 0x5865f2,  // Discord blurple
};
```

**Step 2: Commit**

```bash
git add trivia/categoryLoader.ts
git commit -m "feat(trivia): add videogames category color"
```

---

## Task 15: Run Full Test Suite and Fix Any Issues

**Step 1: Run tests**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npm test`
Expected: Same pass/fail as before (pre-existing failures only)

**Step 2: Run TypeScript check**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npx tsc --noEmit`
Expected: No errors

**Step 3: Run linter**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && npm run lint`
Expected: No new errors

---

## Task 16: Final Integration Commit

**Step 1: Review all changes**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && git log --oneline feature/trivia-improvements ^main`
Expected: List of all commits made

**Step 2: Verify branch is ready**

Run: `cd /home/aboorde/codestuff/db-trivia-improvements && git status`
Expected: Clean working tree

---

## Post-Implementation Checklist

After implementation, before merging:

1. [ ] Run database migrations on production
2. [ ] Run `scripts/fetchVideoGameQuestions.ts` to generate questions
3. [ ] Deploy updated code
4. [ ] Run `npx tsx deploy-commands.ts` to update slash commands
5. [ ] Test `/trivialeaderboard` with all three views
6. [ ] Test `/triviaquestion` with videogames category
7. [ ] Test button clicking for multiple choice
8. [ ] Verify NFL questions still work as free-form
