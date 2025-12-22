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
