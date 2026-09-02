/**
 * One run at a time per thread (design §6.2; log Stage 14, decision 5).
 *
 * Two messages in one thread used to start two concurrent resumes of one SDK
 * session. Each subprocess loaded the transcript as it stood and appended its
 * own turn; the next resume followed one chain and forgot the other, so the
 * thread on Discord showed both answers and the session remembered one.
 *
 * A promise chain per thread. This gate sits in front of the global slot, so
 * a message waiting on its thread never holds one of the two slots. Entries
 * are removed when their chain drains, or the map would grow with every
 * thread ever used. Bounded: past the waiting cap a message is refused with a
 * reply rather than queued, and it costs nobody a cap slot.
 */

import { ASK } from './askConfig.js';

interface Lane {
  /** Settles when the newest admitted run settles; never rejects. */
  tail: Promise<void>;
  /** Runs in flight or waiting. */
  depth: number;
}

const lanes = new Map<string, Lane>();

export interface Admitted<T> {
  /** 0 when it runs now; otherwise how many runs are ahead of it in this thread. */
  readonly position: number;
  readonly result: Promise<T>;
}

/**
 * @returns null when the thread already has the maximum waiting; the caller
 *   replies and drops the message.
 */
export function enqueueInThread<T>(threadId: string, work: () => Promise<T>): Admitted<T> | null {
  const lane: Lane = lanes.get(threadId) ?? { tail: Promise.resolve(), depth: 0 };
  // depth counts the one in flight; the cap is on those waiting behind it.
  if (lane.depth > ASK.THREAD_QUEUE_DEPTH) return null;

  const position: number = lane.depth;
  lane.depth += 1;
  lanes.set(threadId, lane);

  // Run after the previous one settles, whichever way it settled.
  const result: Promise<T> = lane.tail.then(work);
  lane.tail = result.then(
    () => undefined,
    () => undefined
  );
  void lane.tail.then(() => {
    lane.depth -= 1;
    if (lane.depth === 0 && lanes.get(threadId) === lane) lanes.delete(threadId);
  });

  return { position, result };
}

/** Tests only: runs in flight or waiting in this thread. */
export function threadQueueDepth(threadId: string): number {
  return lanes.get(threadId)?.depth ?? 0;
}

/** Threads with a run in flight or waiting. For /ask-admin status. */
export function activeThreads(): number {
  return lanes.size;
}

/** Tests only. */
export function resetThreadQueues(): void {
  lanes.clear();
}
