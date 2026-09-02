import { describe, test, expect, jest } from '@jest/globals';
import { createGenerations, type Generations, type Release } from '../../ask/generations.js';

/**
 * The whole point of this primitive is that teardown waits for readers and the
 * rotation does not. Both halves are asserted: a retired generation with a
 * reader inside stays alive, and `rotate` itself always returns.
 */
describe('generations', () => {
  test('retiring a generation nobody is reading disposes it immediately', () => {
    const generations: Generations = createGenerations('test');
    const disposed: string[] = [];

    generations.rotate((): void => {
      disposed.push('first');
    });

    expect(disposed).toEqual(['first']);
    expect(generations.pending()).toBe(0);
  });

  test('a reader inside the retired generation holds its teardown open', () => {
    const generations: Generations = createGenerations('test');
    const disposed: string[] = [];

    const reader: Release = generations.enter();
    generations.rotate((): void => {
      disposed.push('first');
    });

    // This is the bug the whole change exists to fix: the retired thing --
    // a directory, a connection -- must still be there for the reader.
    expect(disposed).toEqual([]);
    expect(generations.pending()).toBe(1);

    reader();

    expect(disposed).toEqual(['first']);
    expect(generations.pending()).toBe(0);
  });

  test('the last reader out is the one that disposes', () => {
    const generations: Generations = createGenerations('test');
    const disposed: string[] = [];

    const first: Release = generations.enter();
    const second: Release = generations.enter();
    generations.rotate((): void => {
      disposed.push('first');
    });

    first();
    expect(disposed).toEqual([]);
    second();
    expect(disposed).toEqual(['first']);
  });

  test('readers arriving after the rotation do not hold the retired one open', () => {
    const generations: Generations = createGenerations('test');
    const disposed: string[] = [];

    const old: Release = generations.enter();
    generations.rotate((): void => {
      disposed.push('first');
    });

    // A second question starting mid-reshred joins the new generation. If it
    // were counted against the retired one, one steady stream of questions
    // would keep every retired directory on disk forever.
    const fresh: Release = generations.enter();
    expect(generations.readers()).toBe(1);

    old();
    expect(disposed).toEqual(['first']);
    fresh();
    expect(disposed).toEqual(['first']);
  });

  test('two rotations each wait on their own generation', () => {
    const generations: Generations = createGenerations('test');
    const disposed: string[] = [];

    const inFirst: Release = generations.enter();
    generations.rotate((): void => {
      disposed.push('first');
    });

    const inSecond: Release = generations.enter();
    generations.rotate((): void => {
      disposed.push('second');
    });

    expect(generations.pending()).toBe(2);

    inSecond();
    expect(disposed).toEqual(['second']);
    inFirst();
    expect(disposed).toEqual(['second', 'first']);
  });

  test('releasing twice does not dispose a generation someone else is reading', () => {
    const generations: Generations = createGenerations('test');
    const disposed: string[] = [];

    const first: Release = generations.enter();
    const second: Release = generations.enter();
    generations.rotate((): void => {
      disposed.push('first');
    });

    // runAsk releases in a `finally` and could also release on a timeout path,
    // the same reason concurrency.ts's slot is idempotent.
    first();
    first();
    expect(disposed).toEqual([]);

    second();
    expect(disposed).toEqual(['first']);
  });

  test('rotate returns without waiting, even with readers inside', () => {
    const generations: Generations = createGenerations('test');
    generations.enter();

    // The swap calls this. If it could ever block on a reader, a four-minute
    // query would hold up a reshred -- which is why teardown is deferred
    // rather than the rotation being made to wait.
    let returned = false;
    generations.rotate((): void => {});
    returned = true;

    expect(returned).toBe(true);
    expect(generations.pending()).toBe(1);
  });

  test('a teardown that throws is logged, not raised at whoever released last', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const generations: Generations = createGenerations('shred');

    const reader: Release = generations.enter();
    generations.rotate((): void => {
      throw new Error('EBUSY');
    });

    // Teardown runs from whichever `finally` released the last reader. A throw
    // here would surface as a failure of that unrelated caller -- an answer
    // lost to a failed unlink.
    expect((): void => reader()).not.toThrow();
    expect(error).toHaveBeenCalled();
    expect(generations.pending()).toBe(0);
    error.mockRestore();
  });
});
