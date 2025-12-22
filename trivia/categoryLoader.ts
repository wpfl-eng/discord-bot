// Dynamic Trivia Category Loader
// Discovers categories from *Questions.json files in the trivia directory

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ Type Definitions ============

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

export interface CategoryInfo {
  readonly name: string;
  readonly questionCount: number;
  readonly filePath: string;
}

// ============ Module State ============

// Cache for loaded questions (category name -> questions array)
const questionCache = new Map<string, TriviaQuestion[]>();

// Color map for category embeds
const categoryColors: Record<string, number> = {
  nfl: 0x013369,      // NFL navy blue
  wpfl: 0x00ff88,     // WPFL bright green
  videogames: 0x9146ff, // Twitch purple (gaming)
  default: 0x5865f2,  // Discord blurple
};

// ============ Core Functions ============

/**
 * Get the trivia directory path
 */
function getTriviaDir(): string {
  return __dirname;
}

/**
 * Discover all available categories by scanning for *Questions.json files
 * Filters out categories with 0 questions
 */
export async function getAvailableCategories(): Promise<CategoryInfo[]> {
  const triviaDir = getTriviaDir();
  const categories: CategoryInfo[] = [];

  try {
    const files = await fs.readdir(triviaDir);

    for (const file of files) {
      // Match files like nflQuestions.json, wpflQuestions.json, etc.
      const match = file.match(/^(.+)Questions\.json$/i);
      if (!match) continue;

      const categoryName = match[1].toLowerCase();
      const filePath = path.join(triviaDir, file);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const questions = JSON.parse(content) as TriviaQuestion[];

        // Only include categories with questions
        if (Array.isArray(questions) && questions.length > 0) {
          categories.push({
            name: categoryName,
            questionCount: questions.length,
            filePath,
          });

          // Pre-populate cache
          questionCache.set(categoryName, questions);
        }
      } catch (parseError) {
        console.warn(`[CATEGORY_LOADER] Failed to parse ${file}:`, parseError);
      }
    }
  } catch (dirError) {
    console.error('[CATEGORY_LOADER] Failed to read trivia directory:', dirError);
  }

  return categories;
}

/**
 * Get all category names (simple string array)
 */
export async function getAllCategoryNames(): Promise<string[]> {
  const categories = await getAvailableCategories();
  return categories.map(c => c.name);
}

/**
 * Get questions for a specific category
 * Returns empty array if category not found
 */
export async function getQuestionsForCategory(category: string): Promise<TriviaQuestion[]> {
  const normalizedCategory = category.toLowerCase();

  // Check cache first
  if (questionCache.has(normalizedCategory)) {
    return questionCache.get(normalizedCategory)!;
  }

  // Try to load from file
  const triviaDir = getTriviaDir();
  const filePath = path.join(triviaDir, `${normalizedCategory}Questions.json`);

  try {
    // Check if file exists using sync (fast check)
    if (fsSync.existsSync(filePath)) {
      const content = await fs.readFile(filePath, 'utf-8');
      const questions = JSON.parse(content) as TriviaQuestion[];

      if (Array.isArray(questions)) {
        questionCache.set(normalizedCategory, questions);
        return questions;
      }
    }
  } catch (error) {
    console.error(`[CATEGORY_LOADER] Failed to load ${category} questions:`, error);
  }

  return [];
}

/**
 * Get the embed color for a category (sync - just a lookup)
 */
export function getCategoryColor(category: string): number {
  const normalizedCategory = category.toLowerCase();
  return categoryColors[normalizedCategory] ?? categoryColors.default;
}

/**
 * Register a custom color for a category
 */
export function setCategoryColor(category: string, color: number): void {
  categoryColors[category.toLowerCase()] = color;
}

/**
 * Clear the question cache (useful for hot-reloading questions)
 */
export function clearCache(): void {
  questionCache.clear();
}

/**
 * Check if a category exists and has questions
 */
export async function categoryExists(category: string): Promise<boolean> {
  const questions = await getQuestionsForCategory(category);
  return questions.length > 0;
}
