// Casino Number Formatting
//
// `formatAmount` previously existed as two byte-identical copies, in rouletteConfig and
// crapsConfig. This is that function, once.
//
// IMPORTANT: economyConfig.formatCurrency is NOT touched or wrapped in any behavioural
// way. It is imported by 24 files across the whole bot, and the casino is only one of
// them. It is re-exported here purely so a renderer needs one import instead of two.

export { formatCurrency } from '../economy/economyConfig.js';

/**
 * Compact amount for dense board text, where `formatCurrency`'s full grouped number and
 * currency emoji would crowd the line out.
 *
 * @example formatAmount(500)    // '500'
 * @example formatAmount(1500)   // '1.5K'
 * @example formatAmount(10000)  // '10K'
 * @example formatAmount(12500)  // '12.5K'
 */
export function formatAmount(amount: number): string {
  if (amount >= 10000) {
    return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(amount);
}

/**
 * A net result with an explicit sign, for result frames and slips.
 *
 * @example formatSigned(1500)  // '+1.5K'
 * @example formatSigned(-500)  // '-500'
 * @example formatSigned(0)     // '0'
 */
export function formatSigned(net: number): string {
  if (net > 0) return `+${formatAmount(net)}`;
  if (net < 0) return `-${formatAmount(Math.abs(net))}`;
  return '0';
}

/**
 * A Discord relative timestamp, which the client renders as a live countdown and
 * localises on its own.
 *
 * @param epochMs - when the thing happens, in epoch milliseconds
 */
export function relativeTime(epochMs: number): string {
  return `<t:${Math.floor(epochMs / 1000)}:R>`;
}

/**
 * Pluralise a count with its noun.
 *
 * @example plural(1, 'spin')  // '1 spin'
 * @example plural(3, 'spin')  // '3 spins'
 */
export function plural(count: number, noun: string, suffix: string = 's'): string {
  return `${count} ${noun}${count === 1 ? '' : suffix}`;
}
