/**
 * The picture renderer: a Vega-Lite spec to SVG through Vega, and SVG to PNG
 * through sharp (design §11).
 *
 * Vega is imported lazily, and a failure to load -- or a warm-up that could
 * not draw -- is remembered, so a host that cannot draw pays one attempt and
 * then refuses every picture with the text fallback before any SQL runs: the
 * stance helpers/svg takes with sharp, which the casino's hero frames share.
 * Vega is pure JavaScript and is not loaded at import time, so a test of the
 * spec builders never pays for it.
 *
 * Vega renders without node-canvas and estimates text widths, so every spec
 * fixes its own size and padding rather than letting Vega autosize from those
 * estimates (verified on the pi: a title anchored by estimate clipped).
 */

import type { TopLevelSpec } from 'vega-lite';
import { ASK } from '../ask/askConfig.js';
import { logError } from '../errors/errorHandler.js';
import { sharpAvailable, svgToPng } from '../helpers/svg.js';
import { UNAVAILABLE } from './shared.js';

type VegaModule = typeof import('vega');
type VegaLiteModule = typeof import('vega-lite');

interface Engines {
  readonly vega: VegaModule;
  readonly vegaLite: VegaLiteModule;
}

let engines: Engines | null = null;
let vegaUnavailable = false;
/** Set by a warm-up that could not draw. sharp can load and still not rasterise. */
let warmUpFailed = false;

async function loadEngines(): Promise<Engines> {
  if (engines !== null) return engines;
  if (vegaUnavailable) throw new Error(UNAVAILABLE);
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
    vegaUnavailable = true;
    logError('ask', 'Vega unavailable; pictures will be refused', error);
    throw new Error(UNAVAILABLE);
  }
}

/** False once an engine has failed to load or the warm-up could not draw; the tools then refuse before running any SQL. */
export function picturesAvailable(): boolean {
  return !vegaUnavailable && !warmUpFailed && sharpAvailable();
}

/**
 * Compile a Vega-Lite spec and render it to an SVG string. Vega-Lite's
 * warnings print to the console, which is where a spec defect belongs.
 *
 * Throws when the engines cannot load or the spec is invalid. The tools
 * turn that into a refusal.
 */
export async function renderSvg(spec: TopLevelSpec): Promise<string> {
  const { vega, vegaLite } = await loadEngines();
  const view = new vega.View(vega.parse(vegaLite.compile(spec).spec), { renderer: 'none' });
  return view.toSVG();
}

/**
 * Rasterise an SVG to a PNG at the configured density.
 *
 * @returns null when sharp is unavailable or the SVG does not parse; the
 *          caller answers in text.
 */
export function rasterise(svg: string): Promise<Buffer | null> {
  return svgToPng(svg, ASK.PICTURES.DENSITY);
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
    warmUpFailed = png === null;
  } catch (error: unknown) {
    logError('ask', 'Picture warm-up failed; pictures will be refused', error);
    warmUpFailed = true;
  }
  return !warmUpFailed;
}
