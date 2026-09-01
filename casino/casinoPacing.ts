// Casino Pacing
//
// How much theatre a resolution gets, scaled to the money riding on it.
//
// A routine 100-coin spin resolving in four seconds makes a grinding session feel slow;
// a 50,000-coin spin resolving instantly throws away the only moment the game is
// actually about. Neither a fixed fast setting nor a fixed slow one is right, so the
// build-up is chosen per round from what is at risk.

/** One tier of build-up. */
export interface Pacing {
  /** Number of animation frames before the result */
  readonly frames: number;
  /** Gap between frames in milliseconds */
  readonly frameMs: number;
  /** How long the result stays up before the next window opens */
  readonly holdMs: number;
  /** Whether this round earns a rendered hero image and a callout */
  readonly hero: boolean;
}

/** Money thresholds, in coins, at which the build-up steps up. */
export const PACING_THRESHOLDS = {
  MEDIUM: 5_000,
  BIG: 25_000,
} as const;

const QUICK: Pacing = { frames: 1, frameMs: 800, holdMs: 2_000, hero: false };
const STANDARD: Pacing = { frames: 3, frameMs: 800, holdMs: 3_000, hero: false };
const BIG: Pacing = { frames: 5, frameMs: 800, holdMs: 4_000, hero: true };

/**
 * Pick the build-up for a round.
 *
 * @param moneyAtRisk - total staked on this resolution across every player
 */
export function pacingFor(moneyAtRisk: number): Pacing {
  if (moneyAtRisk >= PACING_THRESHOLDS.BIG) return BIG;
  if (moneyAtRisk >= PACING_THRESHOLDS.MEDIUM) return STANDARD;
  return QUICK;
}

/**
 * Total wall-clock cost of a resolution, so a caller can reason about round length
 * without re-deriving it.
 */
export function pacingDurationMs(pacing: Pacing): number {
  return pacing.frames * pacing.frameMs + pacing.holdMs;
}

/** Wait helper, shared by every game's animation loop. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
