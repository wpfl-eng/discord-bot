import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  __resetHubForTesting,
  buildHubMessage,
  registerGameStatus,
  registeredGameCount,
  type GameStatus,
} from '../../casino/casinoHub.js';
import { BUDGET, countComponents } from '../../casino/casinoRender.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function status(overrides: Partial<GameStatus> = {}): GameStatus {
  return {
    key: 'roulette',
    label: 'ROULETTE',
    emoji: '🎰',
    channelId: '123',
    live: true,
    summary: 'Betting open',
    ...overrides,
  };
}

function text(payload: { components: unknown[] }): string {
  const out: string[] = [];
  const walk = (n: any): void => {
    if (n.type === 10) out.push(n.content);
    (n.components ?? []).forEach(walk);
  };
  (payload.components as any[]).forEach(walk);
  return out.join('\n');
}

function buttons(payload: { components: unknown[] }): any[] {
  return (payload.components as any[])
    .flatMap((c) => c.components ?? [])
    .filter((c: any) => c.type === 2);
}

beforeEach(() => {
  __resetHubForTesting();
});

describe('registration', () => {
  test('counts registered games', () => {
    expect(registeredGameCount()).toBe(0);
    registerGameStatus(() => status());
    registerGameStatus(() => status({ key: 'craps' }));
    expect(registeredGameCount()).toBe(2);
  });
});

describe('hub message', () => {
  test('stays within component limits with every game live', () => {
    const all = [
      status(),
      status({ key: 'craps', label: 'CRAPS', channelId: '456' }),
      status({ key: 'blackjack', label: 'BLACKJACK', channelId: '789' }),
    ];
    const payload = buildHubMessage(all, 'guild1');

    const comps = payload.components as any[];
    expect(comps.length).toBeLessThanOrEqual(BUDGET.topLevel);
    expect(comps.reduce((s, c) => s + countComponents(c), 0)).toBeLessThanOrEqual(BUDGET.total);
  });

  test('marks live and quiet games differently', () => {
    const body = text(
      buildHubMessage([status({ live: true }), status({ key: 'craps', live: false })], 'g')
    );
    expect(body).toContain('🟢');
    expect(body).toContain('⚫');
  });

  test('says so when everything is quiet', () => {
    expect(text(buildHubMessage([status({ live: false })], 'g'))).toContain('All quiet');
  });

  test('links to each configured channel', () => {
    const payload = buildHubMessage([status({ channelId: '999' })], 'guild1');
    const jump = buttons(payload)[0];
    expect(jump.url).toBe('https://discord.com/channels/guild1/999');
    // A link button carries no custom id, so it never produces an interaction.
    expect(jump.custom_id).toBeUndefined();
  });

  test('an unconfigured game is listed but not linked', () => {
    const payload = buildHubMessage([status({ channelId: undefined })], 'guild1');
    expect(text(payload)).toContain('not configured');
    expect(buttons(payload)).toHaveLength(0);
  });

  test('no links at all outside a guild', () => {
    expect(buttons(buildHubMessage([status()], null))).toHaveLength(0);
  });

  // An action row holds five buttons, so a sixth game must not silently break the hub.
  test('caps jump links at one action row', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      status({ key: `g${i}`, label: `G${i}`, channelId: String(i) })
    );
    expect(buttons(buildHubMessage(many, 'g'))).toHaveLength(5);
  });

  test('renders with no games registered', () => {
    expect(text(buildHubMessage([], 'g'))).toContain('No games registered');
  });
});
