/**
 * Checks if a user's answer matches the correct answer or acceptable variations.
 * @param {string} userAnswer - The answer provided by the user
 * @param {object} question - Question object with answer and acceptable_answers
 * @returns {boolean} - Whether the answer is correct
 */
export function checkAnswer(userAnswer, question) {
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
