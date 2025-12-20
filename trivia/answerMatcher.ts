/**
 * Answer matching utilities for trivia system
 */

export interface TriviaQuestion {
  answer: string;
  acceptable_answers?: string[];
}

/**
 * Checks if a user's answer matches the correct answer or acceptable variations.
 *
 * @param userAnswer - The answer provided by the user
 * @param question - Question object with answer and acceptable_answers
 * @returns Whether the answer is correct
 */
export function checkAnswer(
  userAnswer: string | null | undefined,
  question: TriviaQuestion | null | undefined
): boolean {
  // Guard against null/undefined input
  if (!userAnswer || typeof userAnswer !== 'string') {
    return false;
  }

  if (!question?.answer) {
    return false;
  }

  const normalized = userAnswer.toLowerCase().trim();
  const acceptables = [
    question.answer.toLowerCase(),
    ...(question.acceptable_answers || []).map((a) => a.toLowerCase()),
  ];

  // Only allow:
  // 1. Exact match, OR
  // 2. User answer contains the FULL acceptable answer
  // (NOT the reverse - prevents single letter matches)
  return acceptables.some(
    (acceptable) => normalized === acceptable || normalized.includes(acceptable)
  );
}
