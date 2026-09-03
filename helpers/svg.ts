/**
 * What every rendered picture shares: escaping for the text an SVG carries,
 * and sharp, loaded once and remembered when it cannot load.
 *
 * sharp ships native binaries, so it can fail to load on a host where the
 * rest of the bot is healthy. Every caller degrades to "no image" -- the
 * casino's result frames stay text, and /ask answers in text -- so a broken
 * install costs one attempt, logged once, rather than one per picture.
 */

import { logError } from '../errors/errorHandler.js';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// sharp's namespace type is not itself callable, so the factory signature is
// named explicitly rather than inferred from `typeof import('sharp')`.
type SharpFactory = (input: Buffer, options?: { density?: number }) => import('sharp').Sharp;

let sharpModule: SharpFactory | null = null;
let sharpUnavailable = false;

async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModule !== null) return sharpModule;
  if (sharpUnavailable) return null;
  try {
    const loaded = (await import('sharp')) as unknown as { default?: SharpFactory };
    sharpModule = loaded.default ?? (loaded as unknown as SharpFactory);
    return sharpModule;
  } catch (error: unknown) {
    sharpUnavailable = true;
    logError('svg', 'sharp unavailable; every rendered picture degrades to text', error);
    return null;
  }
}

/** False once sharp has failed to load; true until it has been tried. */
export function sharpAvailable(): boolean {
  return !sharpUnavailable;
}

/**
 * Rasterise an SVG to a PNG.
 *
 * @param density - pixels per inch the SVG is read at; 72 is 1:1, 144 draws at 2x
 * @returns null when sharp is unavailable or the SVG does not parse; the
 *          caller sends its text unchanged
 */
export async function svgToPng(svg: string, density: number = 72): Promise<Buffer | null> {
  const sharp: SharpFactory | null = await loadSharp();
  if (sharp === null) return null;
  try {
    return await sharp(Buffer.from(svg), { density }).png().toBuffer();
  } catch (error: unknown) {
    logError('svg', 'Could not rasterise an SVG', error);
    return null;
  }
}
