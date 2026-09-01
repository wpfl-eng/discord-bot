// Emoji Artwork Generator
//
// Renders the 104 PNGs the casino uses (53 card faces + 38 roulette pockets + 6 dice
// faces + 2 point pucks + 5 chips) from SVG defined here, so restyling is a code edit
// rather than 104 redraws.
//
// Run: npm run emoji:build    Output: assets/emoji/*.png
//
// sharp is a devDependency and is imported only by this script - the bot never loads it.
//
// DESIGN NOTE: these render at roughly 22px inline next to text, so everything is
// tuned for that size - one dominant glyph, heavy weight, high contrast, no fine
// detail. Anything subtle disappears.

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RANKS, SUITS, type Rank, type Suit } from '../discordCommands/blackjack/blackjackUtils.js';
import { cardEmojiName, pocketEmojiName, CARD_BACK_NAME } from '../emoji/emojiRegistry.js';
import { getColor, WHEEL_POSITIONS } from '../discordCommands/roulette/rouletteConfig.js';
import {
  dieEmojiName,
  PUCK_OFF_NAME,
  PUCK_ON_NAME,
} from '../discordCommands/craps/crapsConfig.js';

// ============ CONSTANTS ============

const SIZE = 128;
const FONT = 'DejaVu Sans, Liberation Sans, Noto Sans, sans-serif';

/** Discord rejects emoji over 256KB */
const MAX_BYTES = 256 * 1024;

/** Below this many non-background pixels the glyph almost certainly failed to render */
const MIN_INK_PIXELS = 150;

const COLORS = {
  cardFace: '#FAFAF7',
  cardEdge: '#B9BEC9',
  cardBack: '#2F3E77',
  cardBackTrim: '#8C9AD4',
  // Four-colour deck. Suit pips collapse into an unreadable blob at ~22px inline, so
  // colour has to carry the suit on its own - the same reason online poker rooms use
  // four-colour decks. Spades and hearts keep their conventional black and red.
  spade: '#1B2027',
  heart: '#D0342C',
  diamond: '#1F6FD0',
  club: '#17834A',
  // Dice read as real dice only if the pips are big, round and high-contrast; anything
  // subtle vanishes at ~22px inline, which is why craps' old Unicode dice were unusable.
  dieFace: '#FAFAF7',
  dieEdge: '#B9BEC9',
  diePip: '#1B2027',
  puckOn: '#D0342C',
  puckOff: '#4A4F57',
  chipLow: '#4A7FD0',
  chipMid: '#1E8E4F',
  chipHigh: '#8A3FC0',
  chipTop: '#C9A227',
  pocketRed: '#D0342C',
  pocketBlack: '#23262D',
  pocketGreen: '#1E8E4F',
  pocketEdge: '#F2F3F5',
  white: '#FFFFFF',
} as const;

const SUIT_GLYPH: Readonly<Record<Suit, string>> = {
  '♠': '&#9824;',
  '♥': '&#9829;',
  '♦': '&#9830;',
  '♣': '&#9827;',
} as const;

const SUIT_INK: Readonly<Record<Suit, string>> = {
  '♠': COLORS.spade,
  '♥': COLORS.heart,
  '♦': COLORS.diamond,
  '♣': COLORS.club,
} as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'assets', 'emoji');

// ============ SVG TEMPLATES ============

/**
 * A single card face. The rank carries the reading at small sizes and colour carries
 * the suit, so the pip only has to confirm what the colour already said.
 */
function cardSvg(rank: Rank, suit: Suit): string {
  const ink: string = SUIT_INK[suit];

  // '10' is the only two-glyph rank and needs to be narrowed to fit the same box.
  const rankSize: number = rank === '10' ? 56 : 72;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="5" y="5" width="118" height="118" rx="20"
        fill="${COLORS.cardFace}" stroke="${COLORS.cardEdge}" stroke-width="5"/>
  <text x="64" y="66" font-family="${FONT}" font-size="${rankSize}" font-weight="700"
        fill="${ink}" text-anchor="middle">${rank}</text>
  <text x="64" y="114" font-family="${FONT}" font-size="46"
        fill="${ink}" text-anchor="middle">${SUIT_GLYPH[suit]}</text>
</svg>`;
}

/**
 * The face-down card. Deliberately the only dark, saturated card so a hole card is
 * unmistakable in a row of faces.
 */
function cardBackSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="5" y="5" width="118" height="118" rx="20"
        fill="${COLORS.cardBack}" stroke="${COLORS.cardEdge}" stroke-width="5"/>
  <rect x="19" y="19" width="90" height="90" rx="12"
        fill="none" stroke="${COLORS.cardBackTrim}" stroke-width="4"/>
  <path d="M34 64 L64 34 L94 64 L64 94 Z"
        fill="none" stroke="${COLORS.cardBackTrim}" stroke-width="6"/>
</svg>`;
}

/**
 * A roulette pocket. Colour does the work here, so the number can stay large and white
 * on a solid field - by far the most legible of the two shapes at inline size.
 */
function pocketSvg(position: string): string {
  const color = getColor(position);
  const fill: string =
    color === 'red'
      ? COLORS.pocketRed
      : color === 'black'
        ? COLORS.pocketBlack
        : COLORS.pocketGreen;

  const numberSize: number = position.length >= 2 ? 58 : 76;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="5" y="5" width="118" height="118" rx="26"
        fill="${fill}" stroke="${COLORS.pocketEdge}" stroke-width="4"/>
  <text x="64" y="${position.length >= 2 ? 86 : 92}" font-family="${FONT}"
        font-size="${numberSize}" font-weight="700"
        fill="${COLORS.white}" text-anchor="middle">${position}</text>
</svg>`;
}

/**
 * A die face. Pip layout is the standard one: a centre pip for odd values, corners
 * filling outward, and the two mid-side pips only on 6.
 */
function dieSvg(value: number): string {
  // Grid positions in a 3x3, as [cx, cy] in the 128px box.
  const L = 34;
  const M = 64;
  const R = 94;

  const LAYOUTS: Record<number, [number, number][]> = {
    1: [[M, M]],
    2: [
      [L, L],
      [R, R],
    ],
    3: [
      [L, L],
      [M, M],
      [R, R],
    ],
    4: [
      [L, L],
      [R, L],
      [L, R],
      [R, R],
    ],
    5: [
      [L, L],
      [R, L],
      [M, M],
      [L, R],
      [R, R],
    ],
    6: [
      [L, L],
      [R, L],
      [L, M],
      [R, M],
      [L, R],
      [R, R],
    ],
  };

  const pips: string = (LAYOUTS[value] ?? [])
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="13" fill="${COLORS.diePip}"/>`)
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="6" y="6" width="116" height="116" rx="26"
        fill="${COLORS.dieFace}" stroke="${COLORS.dieEdge}" stroke-width="5"/>
  ${pips}
</svg>`;
}

/**
 * The craps point puck. ON is the red dealer puck sitting on a number; OFF is the dark
 * side shown during a come-out.
 */
function puckSvg(on: boolean): string {
  const fill: string = on ? COLORS.puckOn : COLORS.puckOff;
  const label: string = on ? 'ON' : 'OFF';
  const size: number = on ? 44 : 34;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <circle cx="64" cy="64" r="58" fill="${fill}" stroke="${COLORS.pocketEdge}" stroke-width="5"/>
  <circle cx="64" cy="64" r="46" fill="none" stroke="${COLORS.white}" stroke-width="3"
          opacity="0.55"/>
  <text x="64" y="${on ? 80 : 76}" font-family="${FONT}" font-size="${size}" font-weight="700"
        fill="${COLORS.white}" text-anchor="middle">${label}</text>
</svg>`;
}

/**
 * A chip denomination. The label is the abbreviated amount so the chip reads at a glance
 * next to a bet line.
 */
function chipSvg(label: string, fill: string): string {
  const size: number = label.length >= 3 ? 40 : 50;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <circle cx="64" cy="64" r="58" fill="${fill}" stroke="${COLORS.white}" stroke-width="6"
          stroke-dasharray="18 12"/>
  <circle cx="64" cy="64" r="42" fill="${fill}" stroke="${COLORS.white}" stroke-width="4"/>
  <text x="64" y="${label.length >= 3 ? 78 : 82}" font-family="${FONT}" font-size="${size}"
        font-weight="700" fill="${COLORS.white}" text-anchor="middle">${label}</text>
</svg>`;
}

// ============ RENDERING ============

interface RenderReport {
  readonly name: string;
  readonly bytes: number;
  readonly ink: number;
}

/**
 * Rasterise one SVG to PNG and verify something actually drew.
 *
 * librsvg silently renders nothing when a font is missing, which would otherwise
 * produce 91 blank tiles and a wasted upload cycle.
 */
async function render(name: string, svg: string): Promise<RenderReport> {
  const buffer: Buffer = Buffer.from(svg);

  const png: Buffer = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer();

  const { data, info } = await sharp(buffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Count pixels that are neither near-white nor near-transparent background.
  let ink = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const v: number = data[i];
    if (v < 110 || v > 245) ink++;
  }

  if (png.byteLength > MAX_BYTES) {
    throw new Error(`${name}: ${png.byteLength} bytes exceeds Discord's 256KB emoji limit`);
  }

  await fs.writeFile(path.join(OUT_DIR, `${name}.png`), png);

  return { name, bytes: png.byteLength, ink };
}

// ============ MAIN ============

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const jobs: { name: string; svg: string }[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      jobs.push({ name: cardEmojiName(rank, suit), svg: cardSvg(rank, suit) });
    }
  }
  jobs.push({ name: CARD_BACK_NAME, svg: cardBackSvg() });

  for (const position of WHEEL_POSITIONS) {
    jobs.push({ name: pocketEmojiName(position), svg: pocketSvg(position) });
  }

  // Craps dice, replacing the Unicode faces that were illegible at inline size.
  for (let value = 1; value <= 6; value++) {
    jobs.push({ name: dieEmojiName(value), svg: dieSvg(value) });
  }

  jobs.push({ name: PUCK_ON_NAME, svg: puckSvg(true) });
  jobs.push({ name: PUCK_OFF_NAME, svg: puckSvg(false) });

  // Chip denominations, shared by every table's chip row.
  const CHIP_ART: { label: string; fill: string }[] = [
    { label: '100', fill: COLORS.chipLow },
    { label: '1K', fill: COLORS.chipMid },
    { label: '10K', fill: COLORS.chipHigh },
    { label: '50K', fill: COLORS.chipTop },
  ];
  for (const chip of CHIP_ART) {
    jobs.push({ name: `chip${chip.label}`, svg: chipSvg(chip.label, chip.fill) });
  }

  console.log(`Rendering ${jobs.length} emoji to ${OUT_DIR} ...`);

  const reports: RenderReport[] = [];
  for (const job of jobs) {
    reports.push(await render(job.name, job.svg));
  }

  const blank: RenderReport[] = reports.filter((r) => r.ink < MIN_INK_PIXELS);
  if (blank.length > 0) {
    console.error(
      `\nFAILED: ${blank.length} tile(s) rendered blank - a required font is probably missing.\n` +
        `Install DejaVu Sans (or Liberation Sans) and re-run.\n` +
        `Blank: ${blank.map((b) => b.name).join(', ')}`
    );
    process.exit(1);
  }

  const total: number = reports.reduce((sum, r) => sum + r.bytes, 0);
  const largest: RenderReport = reports.reduce((a, b) => (a.bytes > b.bytes ? a : b));

  console.log(`\nWrote ${reports.length} PNGs`);
  console.log(`  total   ${(total / 1024).toFixed(1)} KB`);
  console.log(
    `  largest ${largest.name} at ${(largest.bytes / 1024).toFixed(1)} KB (limit 256 KB)`
  );
  console.log(`\nNext: npm run emoji:upload`);
}

main().catch((error: unknown) => {
  console.error('Emoji build failed:', error);
  process.exit(1);
});
