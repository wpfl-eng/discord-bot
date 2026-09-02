import { describe, test, expect, beforeEach } from '@jest/globals';
import { enqueueInThread, threadQueueDepth, resetThreadQueues } from '../../ask/threadQueue.js';

/**
 * Two messages in one thread used to start two concurrent resumes of one SDK
 * session: each subprocess loaded the transcript as it stood, appended its own
 * turn, and the next resume followed one chain and forgot the other. Runs are
 * now serialised per thread, ahead of the global slot, with a depth cap (log
 * Stage 14, decision 5).
 */
describe('threadQueue', () => {
  beforeEach(() => {
    resetThreadQueues();
  });

  const gate = (): { promise: Promise<void>; open: () => void } => {
    let open: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };

  test('runs at once when the thread is idle', async () => {
    const admitted = enqueueInThread('t1', async () => 'answer');

    expect(admitted?.position).toBe(0);
    await expect(admitted?.result).resolves.toBe('answer');
  });

  test('a second message waits for the first, and runs after it in order', async () => {
    const first = gate();
    const order: string[] = [];

    const a = enqueueInThread('t1', async () => {
      await first.promise;
      order.push('a');
    });
    const b = enqueueInThread('t1', async () => {
      order.push('b');
    });

    expect(a?.position).toBe(0);
    expect(b?.position).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);

    first.open();
    await Promise.all([a?.result, b?.result]);
    expect(order).toEqual(['a', 'b']);
  });

  test('different threads never wait on each other', async () => {
    const first = gate();
    const a = enqueueInThread('t1', async () => {
      await first.promise;
    });
    const b = enqueueInThread('t2', async () => 'other thread');

    expect(b?.position).toBe(0);
    await expect(b?.result).resolves.toBe('other thread');
    first.open();
    await a?.result;
  });

  test('refuses past the depth cap rather than queueing forever', async () => {
    const first = gate();
    enqueueInThread('t1', async () => {
      await first.promise;
    });
    const second = enqueueInThread('t1', async () => {});
    const third = enqueueInThread('t1', async () => {});

    const fourth = enqueueInThread('t1', async () => {});

    expect(second?.position).toBe(1);
    expect(third?.position).toBe(2);
    expect(fourth).toBeNull();
    first.open();
    await Promise.all([second?.result, third?.result]);
  });

  test('a failed run does not block the next one', async () => {
    const a = enqueueInThread('t1', async () => {
      throw new Error('boom');
    });
    const b = enqueueInThread('t1', async () => 'still runs');

    await expect(a?.result).rejects.toThrow('boom');
    await expect(b?.result).resolves.toBe('still runs');
  });

  test('forgets a thread once its chain has drained, so the map cannot grow forever', async () => {
    const a = enqueueInThread('t1', async () => {});
    expect(threadQueueDepth('t1')).toBe(1);

    await a?.result;
    // Cleanup happens after the last settled promise's continuations.
    await new Promise((resolve) => setImmediate(resolve));

    expect(threadQueueDepth('t1')).toBe(0);
  });
});
