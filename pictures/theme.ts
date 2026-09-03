/**
 * One look for every picture: the casino palette on the hero frames' dark
 * ground, so a chart and a roulette result read as one bot.
 */

import { CASINO_COLORS, GROUND, SVG_FONT } from '../casino/casinoTheme.js';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export const THEME = {
  background: GROUND.bg,
  ink: GROUND.ink,
  muted: GROUND.muted,
  stripe: GROUND.panel,
  grid: '#2E333B',
  accent: hex(CASINO_COLORS.gold),
  font: SVG_FONT,
  /**
   * Average glyph advance as a fraction of the font size, DejaVu Sans
   * measured by eye. Every width estimated from a character count uses it.
   */
  glyph: 0.56,
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
