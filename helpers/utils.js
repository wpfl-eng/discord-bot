/**
 * Produce an immediate response with some text.
 */
export const produceImmediateResponse = (response) => {
  return produceResponseObjectForText(response);
};

/**
 * Produce a simple text response object.
 */
export const produceResponseObjectForText = (text) => {
  return {
    text: text,
  };
};

export const formatNumber = (floatNumber) => {
  return Math.round(floatNumber * 100) / 100;
};

export const getCurrentNFLWeek = () => {
  const startDate = new Date("2023-09-07"); // Assuming the NFL season starts on this date
  const endDate = new Date("2023-12-31"); // Assuming the NFL regular season ends on this date

  const today = new Date();

  if (today < startDate) {
    return 1;
  }

  if (today > endDate) {
    return 18;
  }

  const oneDayInMillis = 24 * 60 * 60 * 1000;
  const daysSinceStart = Math.floor((today - startDate) / oneDayInMillis);

  return Math.min(Math.floor(daysSinceStart / 7) + 1, 18); // As the NFL season has 18 weeks
};
