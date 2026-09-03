/**
 * The picture renderer: a Vega-Lite spec to SVG through Vega, and SVG to PNG
 * through sharp (design §11).
 *
 * Both engines are imported lazily and a failure to load is remembered, so a
 * host that cannot draw pays one attempt and then refuses every picture with
 * the text fallback -- the stance casinoHero takes with sharp. Vega is pure
 * JavaScript; sharp ships native binaries. Neither is loaded at import time,
 * so a test of the spec builders never pays for them.
 *
 * Vega renders without node-canvas and estimates text widths, so every spec
 * fixes its own size and padding rather than letting Vega autosize from those
 * estimates (verified on the pi: a title anchored by estimate clipped).
 */

import type { TopLevelSpec } from 'vega-lite';
import { ASK } from '../ask/askConfig.js';
import { logError } from '../errors/errorHandler.js';

type VegaModule = typeof import('vega');
type VegaLiteModule = typeof import('vega-lite');
/** Vega-Lite does not export its compile options; derived from the function instead. */
type CompileOptions = NonNullable<Parameters<VegaLiteModule['compile']>[1]>;
type Logger = NonNullable<CompileOptions['logger']>;
type SharpFactory = (input: Buffer, options?: { density?: number }) => import('sharp').Sharp;

interface Engines {
  readonly vega: VegaModule;
  readonly vegaLite: VegaLiteModule;
}

let engines: Engines | null = null;
let sharpModule: SharpFactory | null = null;
let unavailable = false;

async function loadEngines(): Promise<Engines> {
  if (engines !== null) return engines;
  if (unavailable) throw new Error('Pictures are unavailable on this host.');
  try {
    // One after the other, not Promise.all: the two share vega-util, and
    // Jest's ESM linker cannot link one module graph from two concurrent
    // dynamic imports ("./accessor.js can not be resolved on module ... that
    // is not linked"). Sequential costs nothing outside the tests.
    const vega: VegaModule = await import('vega');
    const vegaLite: VegaLiteModule = await import('vega-lite');
    engines = { vega, vegaLite };
    return engines;
  } catch (error: unknown) {
    unavailable = true;
    logError('ask', 'Vega unavailable; pictures will be refused', error);
    throw new Error('Pictures are unavailable on this host.');
  }
}

async function loadSharp(): Promise<SharpFactory> {
  if (sharpModule !== null) return sharpModule;
  if (unavailable) throw new Error('Pictures are unavailable on this host.');
  try {
    const loaded = (await import('sharp')) as unknown as { default?: SharpFactory };
    sharpModule = (loaded.default ?? (loaded as unknown as SharpFactory)) as SharpFactory;
    return sharpModule;
  } catch (error: unknown) {
    unavailable = true;
    logError('ask', 'sharp unavailable; pictures will be refused', error);
    throw new Error('Pictures are unavailable on this host.');
  }
}

/** False once either engine has failed to load. Refusals read this. */
export function picturesAvailable(): boolean {
  return !unavailable;
}

/** Test seam: forget the loaded engines so a fresh attempt is made. */
export function __resetPicturesForTesting(): void {
  engines = null;
  sharpModule = null;
  unavailable = false;
}

/**
 * Compile a Vega-Lite spec and render it to an SVG string. Vega-Lite's
 * warnings go to `warn` when given, so a test can hold a spec to none; the
 * default is the console, which is where a spec defect belongs.
 *
 * Throws when the engines cannot load or the spec is invalid. The tools
 * turn that into a refusal.
 */
export async function renderSvg(
  spec: TopLevelSpec,
  warn?: (message: string) => void
): Promise<string> {
  const { vega, vegaLite } = await loadEngines();
  const compiled = vegaLite.compile(spec, warn === undefined ? {} : { logger: logger(warn) }).spec;
  const view = new vega.View(vega.parse(compiled), { renderer: 'none' });
  return view.toSVG();
}

/**
 * A Vega-Lite logger that forwards warnings and errors to one callback.
 * Vega-Lite's default logger prints straight to the console.
 */
function logger(warn: (message: string) => void): Logger {
  const forward = (...args: readonly unknown[]): void => {
    warn(args.map((arg: unknown): string => String(arg)).join(' '));
  };
  const instance = {
    level(): number {
      return 2;
    },
    error(...args: readonly unknown[]) {
      forward(...args);
      return instance;
    },
    warn(...args: readonly unknown[]) {
      forward(...args);
      return instance;
    },
    info() {
      return instance;
    },
    debug() {
      return instance;
    },
  };
  return instance as unknown as Logger;
}

/**
 * Rasterise an SVG to a PNG at the configured density.
 *
 * @returns null when sharp is unavailable or the SVG does not parse; the
 *          caller answers in text.
 */
export async function rasterise(svg: string): Promise<Buffer | null> {
  let sharp: SharpFactory;
  try {
    sharp = await loadSharp();
  } catch {
    return null;
  }
  try {
    return await sharp(Buffer.from(svg), { density: ASK.PICTURES.DENSITY })
      .png({ compressionLevel: 6 })
      .toBuffer();
  } catch (error: unknown) {
    logError('ask', 'Could not rasterise a picture', error);
    return null;
  }
}

/** The smallest spec that exercises both engines end to end. */
const WARM_UP: TopLevelSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  width: 40,
  height: 20,
  data: { values: [{ k0: 'a', k1: 1 }] },
  mark: 'bar',
  encoding: {
    y: { field: 'k0', type: 'nominal' },
    x: { field: 'k1', type: 'quantitative' },
  },
};

/**
 * Load both engines and draw one tiny picture, at boot, so the first member's
 * question does not pay Vega's import and sharp's font-cache build (about 4 s
 * on the pi, measured). A load check, not a visual one: a missing font does
 * not throw, librsvg substitutes one.
 *
 * @returns whether the host can draw. Never throws.
 */
export async function warmPictures(): Promise<boolean> {
  try {
    const svg: string = await renderSvg(WARM_UP);
    const png: Buffer | null = await rasterise(svg);
    return png !== null;
  } catch (error: unknown) {
    logError('ask', 'Picture warm-up failed; pictures will be refused', error);
    return false;
  }
}
