/**
 * The two runtime guards around query() (design §5.3).
 *
 * Every /ask spawns a Claude Code subprocess. Fourteen members at 20 questions
 * a day is up to 280 spawns, and maxBudgetUsd caps spend but not duration or
 * concurrency. So: a semaphore, and a hard wall-clock deadline.
 *
 * The queue position is returned synchronously rather than through the promise,
 * because the ticker needs to show the wait *before* the wait starts —
 * otherwise a queued question is indistinguishable from a hung one.
 */

import { ASK } from './askConfig.js';

export interface Slot {
  release(): void;
}

export interface SlotRequest {
  /** 0 when a slot was free; 1 and up is the position in the queue. */
  readonly queuePosition: number;
  readonly slot: Promise<Slot>;
}

let held = 0;
let waiting: (() => void)[] = [];

export function requestSlot(): SlotRequest {
  if (held < ASK.MAX_CONCURRENT_QUERIES) {
    held += 1;
    return { queuePosition: 0, slot: Promise.resolve(makeSlot()) };
  }

  const queuePosition: number = waiting.length + 1;
  const slot: Promise<Slot> = new Promise<Slot>((resolve) => {
    waiting.push(() => {
      held += 1;
      resolve(makeSlot());
    });
  });
  return { queuePosition, slot };
}

function makeSlot(): Slot {
  let released = false;
  return {
    release(): void {
      // A runner that both finishes and times out would otherwise release
      // twice and admit a query nobody asked for.
      if (released) return;
      released = true;
      held -= 1;
      waiting.shift()?.();
    },
  };
}

export function inFlight(): number {
  return held;
}

/** Tests only: drop every slot and waiter. */
export function resetConcurrency(): void {
  held = 0;
  waiting = [];
}

export interface Deadline {
  /** Handed to the SDK, which takes a controller rather than a signal. */
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  expired(): boolean;
  /** Stop the timer once the work has finished in time. */
  clear(): void;
}

export function startDeadline(ms: number = ASK.QUERY_TIMEOUT_MS): Deadline {
  const controller = new AbortController();
  let fired = false;

  const timer = setTimeout(() => {
    fired = true;
    controller.abort();
  }, ms);

  return {
    controller,
    signal: controller.signal,
    expired: (): boolean => fired,
    clear: (): void => clearTimeout(timer),
  };
}
