import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  MAX_CONSECUTIVE_FAILURES,
  createAdvanceGuard,
  type RecoveryContext,
} from '../../casino/casinoRecovery.js';

/**
 * The guard logs every failure, which would otherwise bury the test output in stack
 * traces that are the point of the test rather than a problem with it.
 */
let errors: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
  errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errors.mockRestore();
});

/** A guard plus the contexts its recovery was handed. */
function guardWithLog() {
  const seen: RecoveryContext[] = [];
  const guard = createAdvanceGuard('TEST', async (context) => {
    seen.push(context);
  });
  return { guard, seen };
}

describe('a healthy advance', () => {
  test('runs the body and never reaches recovery', async () => {
    const { guard, seen } = guardWithLog();
    let ran = false;

    await guard.run('advance', async () => {
      ran = true;
    });

    expect(ran).toBe(true);
    expect(seen).toHaveLength(0);
    expect(guard.failures).toBe(0);
  });
});

describe('a failing advance', () => {
  test('does not rethrow - a timer callback has nowhere to throw to', async () => {
    const { guard } = guardWithLog();

    await expect(
      guard.run('advance', async () => {
        throw new Error('escrow is on fire');
      })
    ).resolves.toBeUndefined();
  });

  test('hands recovery the step and the error', async () => {
    const { guard, seen } = guardWithLog();
    const boom = new Error('escrow is on fire');

    await guard.run('closeSeating', async () => {
      throw boom;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].step).toBe('closeSeating');
    expect(seen[0].error).toBe(boom);
    expect(seen[0].consecutive).toBe(1);
    expect(seen[0].exhausted).toBe(false);
  });

  test('logs the failure so a wedged table leaves a trace', async () => {
    const { guard } = guardWithLog();

    await guard.run('closeSeating', async () => {
      throw new Error('escrow is on fire');
    });

    expect(errors).toHaveBeenCalled();
    expect(String(errors.mock.calls[0][0])).toContain('closeSeating');
  });
});

describe('a fault that will not clear', () => {
  test('gives up rather than re-arming forever', async () => {
    const { guard, seen } = guardWithLog();

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      await guard.run('advance', async () => {
        throw new Error('database is down');
      });
    }

    expect(seen.map((c) => c.consecutive)).toEqual([1, 2, 3]);
    expect(seen.map((c) => c.exhausted)).toEqual([false, false, true]);
  });

  test('a completed advance clears the streak', async () => {
    const { guard, seen } = guardWithLog();

    await guard.run('advance', async () => {
      throw new Error('one blip');
    });
    await guard.run('advance', async () => undefined);
    await guard.run('advance', async () => {
      throw new Error('another blip, much later');
    });

    // Two separate blips must never add up to giving up on the table.
    expect(seen.map((c) => c.consecutive)).toEqual([1, 1]);
    expect(guard.failures).toBe(1);
  });

  test('reset forgets the streak', async () => {
    const { guard } = guardWithLog();

    await guard.run('advance', async () => {
      throw new Error('blip');
    });
    expect(guard.failures).toBe(1);

    guard.reset();
    expect(guard.failures).toBe(0);
  });
});

describe('recovery that itself fails', () => {
  test('is swallowed, because rethrowing recreates the bug this guards', async () => {
    const guard = createAdvanceGuard('TEST', async () => {
      throw new Error('the refund failed too');
    });

    await expect(
      guard.run('advance', async () => {
        throw new Error('original');
      })
    ).resolves.toBeUndefined();

    const logged: string = errors.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('recovery after advance also failed');
  });
});
