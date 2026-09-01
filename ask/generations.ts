/**
 * Deferred teardown for state that readers hold across an await.
 *
 * Two things in this feature get replaced while somebody is still reading the
 * old one, and both were replaced the same way: overwrite a variable, destroy
 * the old value on the spot -- `rmSync` on the retired shred directory,
 * `closeSync()` on the retired DuckDB connection -- with nothing anywhere
 * recording that a reader was still inside it.
 *
 * - The shred directory is the agent subprocess's own cwd for up to
 *   QUERY_TIMEOUT_MS, and it reads from it by relative path the whole time.
 * - The materialized connection is what an in-flight `runSql` is reading
 *   through when the next rebuild lands.
 *
 * Measured on this host: renaming the live data directory does *not* disturb a
 * process whose cwd is it -- a cwd is a reference to the inode, not to the
 * path, so the reader keeps seeing its own snapshot, correctly and completely.
 * Deleting that directory is what turns its next relative read into ENOENT.
 *
 * That measurement is the whole design. The swap does not need to wait for
 * readers; only the *teardown* does. So `rotate()` returns immediately, nothing
 * here ever blocks, and there is no lock ordering to get wrong -- a four-minute
 * query can never hold up a reshred, which is the deadlock that made coupling
 * the swap to the concurrency semaphore the wrong answer. The price is that a
 * retired generation lives a little longer than it used to, bounded by the
 * longest reader, which QUERY_TIMEOUT_MS already bounds.
 */

import { logError } from '../errors/errorHandler.js';

/** Idempotent: releasing twice is a no-op, not a double decrement. */
export type Release = () => void;

export interface Generations {
  /** Borrow the live generation. Release it when you are done reading. */
  enter(): Release;
  /**
   * Retire the live generation and start a fresh one. `dispose` runs when the
   * retired generation's last reader leaves -- synchronously, here and now, if
   * it had none. Readers arriving after this call join the new generation and
   * do not hold the retired one open.
   */
  rotate(dispose: () => void): void;
  /** Readers currently inside the live generation. */
  readers(): number;
  /** Retired generations still waiting on a reader. */
  pending(): number;
}

interface Generation {
  readers: number;
  dispose: (() => void) | null;
}

export function createGenerations(label: string): Generations {
  let live: Generation = { readers: 0, dispose: null };
  const retired = new Set<Generation>();

  const leave = (generation: Generation): void => {
    generation.readers -= 1;
    const dispose: (() => void) | null = generation.dispose;
    if (generation.readers > 0 || dispose === null) return;
    generation.dispose = null;
    retired.delete(generation);
    run(label, dispose);
  };

  return {
    enter(): Release {
      const generation: Generation = live;
      generation.readers += 1;

      // Held by callers that release in a `finally` and may also release on a
      // timeout path, the same reason concurrency.ts's slot is idempotent.
      let released = false;
      return (): void => {
        if (released) return;
        released = true;
        leave(generation);
      };
    },

    rotate(dispose: () => void): void {
      const previous: Generation = live;
      live = { readers: 0, dispose: null };

      if (previous.readers === 0) {
        run(label, dispose);
        return;
      }
      previous.dispose = dispose;
      retired.add(previous);
    },

    readers: (): number => live.readers,
    pending: (): number => retired.size,
  };
}

/**
 * Teardown runs from whichever `finally` released the last reader. A throw here
 * would surface as a failure of that caller -- an answer lost to a failed
 * unlink -- so it is logged and swallowed instead.
 */
function run(label: string, dispose: () => void): void {
  try {
    dispose();
  } catch (error: unknown) {
    logError('ask', `Could not retire a ${label} generation`, error);
  }
}
