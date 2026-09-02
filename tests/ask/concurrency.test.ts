import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  requestSlot,
  startDeadline,
  resetConcurrency,
  inFlight,
  type Slot,
  type SlotRequest,
} from '../../ask/concurrency.js';
import { ASK } from '../../ask/askConfig.js';

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('concurrency', () => {
  beforeEach(() => {
    resetConcurrency();
  });

  describe('the semaphore', () => {
    test('admits exactly MAX_CONCURRENT_QUERIES without queueing', async () => {
      const requests: SlotRequest[] = [];
      for (let i = 0; i < ASK.MAX_CONCURRENT_QUERIES; i += 1) requests.push(requestSlot());

      expect(requests.map((r) => r.queuePosition)).toEqual(
        Array.from({ length: ASK.MAX_CONCURRENT_QUERIES }, () => 0)
      );
      await Promise.all(requests.map((r) => r.slot));
      expect(inFlight()).toBe(ASK.MAX_CONCURRENT_QUERIES);
    });

    test('queues the overflow and numbers the wait, so it is visible', async () => {
      for (let i = 0; i < ASK.MAX_CONCURRENT_QUERIES; i += 1) await requestSlot().slot;

      const first: SlotRequest = requestSlot();
      const second: SlotRequest = requestSlot();

      expect(first.queuePosition).toBe(1);
      expect(second.queuePosition).toBe(2);
    });

    test('a queued request does not resolve until a slot frees', async () => {
      const held: Slot[] = [];
      for (let i = 0; i < ASK.MAX_CONCURRENT_QUERIES; i += 1) held.push(await requestSlot().slot);

      let admitted = false;
      void requestSlot().slot.then(() => {
        admitted = true;
      });

      await settle();
      expect(admitted).toBe(false);

      held[0].release();
      await settle();
      expect(admitted).toBe(true);
    });

    test('hands slots out in the order they were asked for', async () => {
      const held: Slot[] = [];
      for (let i = 0; i < ASK.MAX_CONCURRENT_QUERIES; i += 1) held.push(await requestSlot().slot);

      const order: number[] = [];
      void requestSlot().slot.then(() => order.push(1));
      void requestSlot().slot.then(() => order.push(2));
      void requestSlot().slot.then(() => order.push(3));

      held[0].release();
      await settle();
      held[1].release();
      await settle();

      expect(order).toEqual([1, 2]);
    });

    test('releasing twice does not hand out a slot that was never held', async () => {
      const slot: Slot = await requestSlot().slot;
      slot.release();
      slot.release();

      expect(inFlight()).toBe(0);
    });

    test('a released slot lets the queue drain to empty', async () => {
      const held: Slot[] = [];
      for (let i = 0; i < ASK.MAX_CONCURRENT_QUERIES + 3; i += 1) {
        const request: SlotRequest = requestSlot();
        void request.slot.then((s) => held.push(s));
      }
      await settle();

      while (held.length > 0) {
        held.pop()?.release();
        await settle();
      }

      expect(inFlight()).toBe(0);
    });
  });

  describe('the wall-clock deadline', () => {
    test('does not fire while the work is still in time', () => {
      jest.useFakeTimers();
      try {
        const deadline = startDeadline(1000);

        jest.advanceTimersByTime(999);

        expect(deadline.expired()).toBe(false);
        expect(deadline.controller.signal.aborted).toBe(false);
        deadline.clear();
      } finally {
        jest.useRealTimers();
      }
    });

    test('aborts the signal when it fires', () => {
      jest.useFakeTimers();
      try {
        const deadline = startDeadline(1000);

        jest.advanceTimersByTime(1001);

        expect(deadline.expired()).toBe(true);
        expect(deadline.controller.signal.aborted).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    test('clear() stops it firing after the work finished', () => {
      jest.useFakeTimers();
      try {
        const deadline = startDeadline(1000);
        deadline.clear();

        jest.advanceTimersByTime(5000);

        expect(deadline.expired()).toBe(false);
        expect(deadline.controller.signal.aborted).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    test('defaults to the configured query timeout', () => {
      jest.useFakeTimers();
      try {
        const deadline = startDeadline();

        jest.advanceTimersByTime(ASK.QUERY_TIMEOUT_MS - 1);
        expect(deadline.expired()).toBe(false);

        jest.advanceTimersByTime(2);
        expect(deadline.expired()).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
