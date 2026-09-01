import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import type { MessageComponentInteraction } from 'discord.js';

const { registerComponentHandler, findComponentHandler, dispatchComponent, getRegisteredPrefixes } =
  await import('../../interactions/componentRouter.js');

/**
 * Build a stand-in interaction. Only the fields the router touches are present.
 */
function fakeInteraction(customId: string, opts: { replied?: boolean; deferred?: boolean } = {}) {
  return {
    customId,
    replied: opts.replied ?? false,
    deferred: opts.deferred ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reply: jest.fn<any>(async () => undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    followUp: jest.fn<any>(async () => undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as MessageComponentInteraction & { reply: any; followUp: any };
}

describe('componentRouter', () => {
  let counter = 0;
  /** Unique prefix per test - the registry is module-level and persists across tests. */
  const uniq = (): string => `test${counter++}:`;

  beforeEach(() => {
    counter += 100;
  });

  test('routes a customId to the handler that claims its prefix', async () => {
    const prefix = uniq();
    const handler = jest.fn(async () => undefined);
    registerComponentHandler(prefix, handler);

    const handled = await dispatchComponent(fakeInteraction(`${prefix}hit`));

    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('returns false for an unclaimed customId', async () => {
    const handled = await dispatchComponent(fakeInteraction('nothing_claims_this'));
    expect(handled).toBe(false);
  });

  // Without longest-prefix-first, registering 'bj:' and 'bj:split:' would make the
  // winner depend on registration order.
  test('the most specific prefix wins regardless of registration order', async () => {
    const base = uniq();
    const broad = jest.fn(async () => undefined);
    const narrow = jest.fn(async () => undefined);

    registerComponentHandler(base, broad);
    registerComponentHandler(`${base}split:`, narrow);

    await dispatchComponent(fakeInteraction(`${base}split:2`));

    expect(narrow).toHaveBeenCalledTimes(1);
    expect(broad).not.toHaveBeenCalled();
  });

  test('rejects a duplicate prefix rather than silently shadowing', () => {
    const prefix = uniq();
    registerComponentHandler(prefix, async () => undefined);

    expect(() => registerComponentHandler(prefix, async () => undefined)).toThrow(
      /already registered/
    );
  });

  test('rejects an empty prefix, which would claim every interaction', () => {
    expect(() => registerComponentHandler('', async () => undefined)).toThrow();
  });

  // A throwing handler must not crash the gateway listener or leave the player with a
  // spinner that never resolves.
  test('contains a throwing handler and still reports the interaction as handled', async () => {
    const prefix = uniq();
    registerComponentHandler(prefix, async () => {
      throw new Error('boom');
    });

    const interaction = fakeInteraction(`${prefix}x`);
    const handled = await dispatchComponent(interaction);

    expect(handled).toBe(true);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  test('uses followUp when the handler already replied', async () => {
    const prefix = uniq();
    registerComponentHandler(prefix, async () => {
      throw new Error('boom');
    });

    const interaction = fakeInteraction(`${prefix}x`, { replied: true });
    await dispatchComponent(interaction);

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('swallows a failure to deliver the error notice', async () => {
    const prefix = uniq();
    registerComponentHandler(prefix, async () => {
      throw new Error('boom');
    });

    const interaction = fakeInteraction(`${prefix}x`);
    interaction.reply.mockRejectedValue(new Error('Unknown interaction'));

    await expect(dispatchComponent(interaction)).resolves.toBe(true);
  });

  test('findComponentHandler reports null for unclaimed ids', () => {
    expect(findComponentHandler('definitely_unclaimed_zzz')).toBeNull();
  });

  test('getRegisteredPrefixes lists what has been claimed', () => {
    const prefix = uniq();
    registerComponentHandler(prefix, async () => undefined);
    expect(getRegisteredPrefixes()).toContain(prefix);
  });
});
