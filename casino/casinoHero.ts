// Casino Hero Frames
//
// A rendered image for the once-a-round moment worth looking at: the pocket the ball
// landed in, the dice as they came to rest, the hand that settled a big round.
//
// WHY ONLY ONCE A ROUND
//
// Every hero costs an SVG rasterisation plus an attachment upload. That is affordable
// when it happens once per resolution and completely unaffordable on a board that
// repaints on every chip click, which is why live boards stay pure text and only the
// result frame gets art.
//
// WHY IT MUST NEVER THROW
//
// `sharp` ships native binaries, so it can fail to load on a host where the rest of the
// bot is perfectly healthy. helpers/svg imports it lazily and every failure degrades to
// "no image" - the text frame alone is a complete, playable result. This mirrors the
// emoji registry's stance that art is an upgrade, never a dependency.

import { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { escapeXml, sharpAvailable, svgToPng } from '../helpers/svg.js';
import { GROUND, SVG_FONT as FONT } from './casinoTheme.js';

/** Whether hero rendering is currently possible. Used by tests and boot logging. */
export function heroAvailable(): boolean {
  return sharpAvailable();
}

// ============ PALETTE ============

const HERO = {
  width: 640,
  height: 300,
  ...GROUND,
  red: '#D0342C',
  black: '#23262D',
  green: '#1E8E4F',
  gold: '#C9A227',
  dieFace: '#FAFAF7',
  diePip: '#1B2027',
} as const;

// ============ SVG BUILDERS ============

/**
 * The roulette result: the pocket, at a size that reads as an event rather than a line
 * of text.
 */
export function rouletteHeroSvg(
  position: string,
  color: 'red' | 'black' | 'green',
  caption: string
): string {
  const fill: string = color === 'red' ? HERO.red : color === 'green' ? HERO.green : HERO.black;
  const size: number = position.length >= 2 ? 130 : 160;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HERO.width}" height="${HERO.height}">
  <rect width="${HERO.width}" height="${HERO.height}" fill="${HERO.bg}"/>
  <circle cx="160" cy="150" r="110" fill="${fill}" stroke="${HERO.ink}" stroke-width="6"/>
  <text x="160" y="${position.length >= 2 ? 200 : 210}" font-family="${FONT}"
        font-size="${size}" font-weight="700" fill="${HERO.ink}"
        text-anchor="middle">${escapeXml(position)}</text>
  <text x="310" y="130" font-family="${FONT}" font-size="46" font-weight="700"
        fill="${HERO.ink}">${escapeXml(color.toUpperCase())}</text>
  <text x="310" y="184" font-family="${FONT}" font-size="30"
        fill="${HERO.muted}">${escapeXml(caption)}</text>
</svg>`;
}

/** Pip layout for a die face, as [cx, cy] offsets within a 160px tile. */
function heroPips(value: number, originX: number, originY: number): string {
  const L = originX + 38;
  const M = originX + 80;
  const R = originX + 122;
  const T = originY + 38;
  const C = originY + 80;
  const B = originY + 122;

  const LAYOUTS: Record<number, [number, number][]> = {
    1: [[M, C]],
    2: [
      [L, T],
      [R, B],
    ],
    3: [
      [L, T],
      [M, C],
      [R, B],
    ],
    4: [
      [L, T],
      [R, T],
      [L, B],
      [R, B],
    ],
    5: [
      [L, T],
      [R, T],
      [M, C],
      [L, B],
      [R, B],
    ],
    6: [
      [L, T],
      [R, T],
      [L, C],
      [R, C],
      [L, B],
      [R, B],
    ],
  };

  return (LAYOUTS[value] ?? [])
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="16" fill="${HERO.diePip}"/>`)
    .join('\n  ');
}

/** The craps result: both dice as they landed, with the total and what it means. */
export function crapsHeroSvg(die1: number, die2: number, caption: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HERO.width}" height="${HERO.height}">
  <rect width="${HERO.width}" height="${HERO.height}" fill="${HERO.bg}"/>
  <rect x="50" y="70" width="160" height="160" rx="30" fill="${HERO.dieFace}"/>
  ${heroPips(die1, 50, 70)}
  <rect x="240" y="70" width="160" height="160" rx="30" fill="${HERO.dieFace}"/>
  ${heroPips(die2, 240, 70)}
  <text x="520" y="140" font-family="${FONT}" font-size="96" font-weight="700"
        fill="${HERO.ink}" text-anchor="middle">${die1 + die2}</text>
  <text x="520" y="192" font-family="${FONT}" font-size="26"
        fill="${HERO.gold}" text-anchor="middle">${escapeXml(caption)}</text>
</svg>`;
}

/** The blackjack settle: the dealer's final total against the table's result. */
export function blackjackHeroSvg(dealerTotal: string, headline: string, caption: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HERO.width}" height="${HERO.height}">
  <rect width="${HERO.width}" height="${HERO.height}" fill="${HERO.bg}"/>
  <rect x="40" y="60" width="180" height="180" rx="24" fill="${HERO.panel}"
        stroke="${HERO.gold}" stroke-width="4"/>
  <text x="130" y="120" font-family="${FONT}" font-size="24"
        fill="${HERO.muted}" text-anchor="middle">DEALER</text>
  <text x="130" y="195" font-family="${FONT}" font-size="76" font-weight="700"
        fill="${HERO.ink}" text-anchor="middle">${escapeXml(dealerTotal)}</text>
  <text x="260" y="130" font-family="${FONT}" font-size="44" font-weight="700"
        fill="${HERO.ink}">${escapeXml(headline)}</text>
  <text x="260" y="184" font-family="${FONT}" font-size="28"
        fill="${HERO.muted}">${escapeXml(caption)}</text>
</svg>`;
}

// ============ RENDER ============

/** Filename the MediaGallery item points at. */
const HERO_FILENAME = 'hero.png';

export interface Hero {
  readonly gallery: MediaGalleryBuilder;
  readonly file: AttachmentBuilder;
}

/**
 * Rasterise a hero SVG into an attachment plus the gallery that displays it.
 *
 * @param svg - one of the *HeroSvg builders above
 * @param altText - description for screen readers
 * @returns null when sharp is unavailable or rendering failed, in which case the caller
 *          simply sends its text frame unchanged
 */
export async function renderHero(svg: string, altText: string): Promise<Hero | null> {
  const png: Buffer | null = await svgToPng(svg);
  if (png === null) return null;

  const file = new AttachmentBuilder(png, { name: HERO_FILENAME });
  const gallery = new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder()
      .setURL(`attachment://${HERO_FILENAME}`)
      .setDescription(altText.slice(0, 1024))
  );

  return { gallery, file };
}
