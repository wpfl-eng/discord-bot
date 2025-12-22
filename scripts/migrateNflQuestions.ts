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
