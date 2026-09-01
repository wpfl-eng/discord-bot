/**
 * General utility functions
 */

export interface ResponseObject {
  text: string;
}

export type NFLWeek =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18;

/**
 * Produce an immediate response with some text.
 */
export const produceImmediateResponse = (response: string): ResponseObject => {
  return produceResponseObjectForText(response);
};

/**
 * Produce a simple text response object.
 */
export const produceResponseObjectForText = (text: string): ResponseObject => {
  return { text };
};

/**
 * Round a number to 2 decimal places.
 * Returns 0 for NaN input.
 */
export const formatNumber = (floatNumber: number): number => {
  if (Number.isNaN(floatNumber)) return 0;
  return Math.round(floatNumber * 100) / 100;
};

/**
 * The season an NFL date belongs to, which is what ESPN's `seasonId` wants.
 *
 * A season is named for the calendar year it starts in and runs into February
 * of the next one, so January and February belong to the previous season --
 * exactly the weeks that carry the fantasy playoffs and the championship. The
 * NFL league year turns over in March.
 */
export const getCurrentNFLSeason = (referenceDate: Date = new Date()): number => {
  const year: number = referenceDate.getFullYear();
  // Months are zero-based: 2 is March.
  return referenceDate.getMonth() < 2 ? year - 1 : year;
};

/**
 * Calculate the current NFL week dynamically.
 * NFL season starts on the Thursday after Labor Day (first Monday of September).
 *
 * @param referenceDate - Date to calculate week for (defaults to now)
 * @returns Current NFL week (1-18)
 */
export const getCurrentNFLWeek = (referenceDate: Date = new Date()): NFLWeek => {
  const year = referenceDate.getFullYear();

  // Find first Monday of September (Labor Day)
  const september = new Date(year, 8, 1); // September 1
  let laborDay = new Date(september);
  while (laborDay.getDay() !== 1) {
    // Find Monday
    laborDay = new Date(year, 8, laborDay.getDate() + 1);
  }

  // Season starts Thursday after Labor Day
  const seasonStart = new Date(laborDay);
  seasonStart.setDate(laborDay.getDate() + 3); // Thursday

  // Regular season ends after week 18 (18 weeks from start)
  const seasonEnd = new Date(seasonStart);
  seasonEnd.setDate(seasonStart.getDate() + 18 * 7);

  if (referenceDate < seasonStart) return 1;
  if (referenceDate > seasonEnd) return 18;

  const daysSinceStart = Math.floor(
    (referenceDate.getTime() - seasonStart.getTime()) / (24 * 60 * 60 * 1000)
  );

  return Math.min(Math.floor(daysSinceStart / 7) + 1, 18) as NFLWeek;
};
