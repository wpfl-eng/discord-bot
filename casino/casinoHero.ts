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
// bot is perfectly healthy. It is imported lazily and every failure degrades to "no
// image" - the text frame alone is a complete, playable result. This mirrors the
// emoji registry's stance that art is an upgrade, never a dependency.

import { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';

// ============ LAZY SHARP ============

// sharp's namespace type is not itself callable, so the factory signature is named
// explicitly rather than inferred from `typeof import('sharp')`.
type SharpFactory = (input: Buffer) => import('sharp').Sharp;

let sharpModule: SharpFactory | null = null;
let sharpUnavailable = false;

/**
 * Load sharp once, remembering failure so a broken install costs one attempt rather
 * than one per round.
 */
async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModule) return sharpModule;
  if (sharpUnavailable) return null;

  try {
    const loaded = (await import('sharp')) as unknown as {
      default?: SharpFactory;
    };
    sharpModule = (loaded.default ?? (loaded as unknown as SharpFactory)) as SharpFactory;
    return sharpModule;
  } catch (error: unknown) {
    sharpUnavailable = true;
    console.warn('[HERO] sharp unavailable; result frames will be text only:', error);
    return null;
  }
}

/** Whether hero rendering is currently possible. Used by tests and boot logging. */
export function heroAvailable(): boolean {
  return !sharpUnavailable;
}

/** Test seam: forget the cached module so a fresh attempt is made. */
export function __resetHeroForTesting(): void {
  sharpModule = null;
  sharpUnavailable = false;
}

// ============ PALETTE ============

const HERO = {
  width: 640,
  height: 300,
  bg: '#1B2027',
  panel: '#23262D',
  ink: '#FAFAF7',
  muted: '#9AA3AF',
  red: '#D0342C',
  black: '#23262D',
  green: '#1E8E4F',
  gold: '#C9A227',
  dieFace: '#FAFAF7',
  diePip: '#1B2027',
} as const;

const FONT = 'DejaVu Sans, Liberation Sans, Noto Sans, sans-serif';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  const sharp = await loadSharp();
  if (!sharp) return null;

  try {
    const png: Buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();

    const file = new AttachmentBuilder(png, { name: HERO_FILENAME });
    const gallery = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${HERO_FILENAME}`)
        .setDescription(altText.slice(0, 1024))
    );

    return { gallery, file };
  } catch (error: unknown) {
    console.error('[HERO] Failed to render result image; falling back to text:', error);
    return null;
  }
}
