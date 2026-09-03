/**
 * One look for every picture: the casino palette on the hero frames' dark
 * ground, so a chart and a roulette result read as one bot.
 */

import { CASINO_COLORS } from '../casino/casinoTheme.js';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export const THEME = {
  background: '#1B2027',
  ink: '#FAFAF7',
  muted: '#9AA3AF',
  grid: '#2E333B',
  stripe: '#23262D',
  accent: hex(CASINO_COLORS.gold),
  /** The families the pi and the dev box both have, in fontconfig's order of preference. */
  font: 'DejaVu Sans, Liberation Sans, Noto Sans, sans-serif',
  /** Series colours, in the order series appear. */
  series: [
    CASINO_COLORS.gold,
    CASINO_COLORS.blue,
    CASINO_COLORS.green,
    CASINO_COLORS.red,
    CASINO_COLORS.purple,
    CASINO_COLORS.orange,
  ].map(hex),
} as const;
