import { describe, test, expect } from '@jest/globals';
import { ButtonStyle, MessageFlags } from 'discord.js';
import {
  BUDGET,
  assertWithinBudget,
  button,
  countComponents,
  frame,
  rendered,
  row,
  separator,
  text,
} from '../../casino/casinoRender.js';
import { CASINO_COLORS, bar, resultAccent } from '../../casino/casinoTheme.js';

describe('row', () => {
  test('accepts five components', () => {
    const five = Array.from({ length: 5 }, (_, i) => button({ id: `x:${i}`, label: `${i}` }));
    expect(() => row(five)).not.toThrow();
  });

  // Discord rejects an over-full row outright, which would break the whole board rather
  // than looking slightly wrong. Failing here makes it a test failure instead.
  test('rejects a sixth component', () => {
    const six = Array.from({ length: 6 }, (_, i) => button({ id: `x:${i}`, label: `${i}` }));
    expect(() => row(six)).toThrow(/at most 5/);
  });
});

describe('rendered', () => {
  test('always sets the Components V2 flag', () => {
    const payload = rendered([frame(CASINO_COLORS.blue).toJSON()]);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
  });

  test('adds the ephemeral flag only when asked', () => {
    expect(rendered([], {}).flags & MessageFlags.Ephemeral).toBeFalsy();
    expect(rendered([], { ephemeral: true }).flags & MessageFlags.Ephemeral).toBeTruthy();
  });

  // A V2 TextDisplay is real message content, not an embed, so an unescaped <@id> in a
  // bet board would notify every player on it on every repaint.
  test('suppresses every mention', () => {
    expect(rendered([]).allowedMentions).toEqual({ parse: [] });
  });
});

describe('countComponents', () => {
  test('counts nested children and accessories', () => {
    const container = frame(CASINO_COLORS.blue)
      .addTextDisplayComponents(text('a'))
      .addSeparatorComponents(separator())
      .toJSON();

    // container + 2 children
    expect(countComponents(container)).toBe(3);
  });

  test('ignores non-objects', () => {
    expect(countComponents(null)).toBe(0);
    expect(countComponents('nope')).toBe(0);
  });
});

describe('assertWithinBudget', () => {
  test('passes a realistic board', () => {
    const payload = rendered([
      frame(CASINO_COLORS.blue).addTextDisplayComponents(text('hi')).toJSON(),
      row([button({ id: 'a', label: 'A', style: ButtonStyle.Primary })]).toJSON(),
    ]);
    expect(() => assertWithinBudget(payload, 'test board')).not.toThrow();
  });

  test('rejects too many top-level components', () => {
    const many = Array.from({ length: BUDGET.topLevel + 1 }, () =>
      frame(CASINO_COLORS.blue).addTextDisplayComponents(text('x')).toJSON()
    );
    expect(() => assertWithinBudget(rendered(many), 'overfull')).toThrow(/top-level/);
  });

  test('rejects an overfull container', () => {
    const container = frame(CASINO_COLORS.blue);
    for (let i = 0; i < BUDGET.containerChildren + 1; i++) {
      container.addTextDisplayComponents(text(`line ${i}`));
    }
    expect(() => assertWithinBudget(rendered([container.toJSON()]), 'deep')).toThrow(/children/);
  });
});

describe('theme', () => {
  test('resultAccent maps direction to the shared palette', () => {
    expect(resultAccent(100)).toBe(CASINO_COLORS.green);
    expect(resultAccent(-100)).toBe(CASINO_COLORS.red);
    expect(resultAccent(0)).toBe(CASINO_COLORS.purple);
  });

  test('bar fills proportionally and clamps out-of-range input', () => {
    expect(bar(1, 10)).toBe('█'.repeat(10));
    expect(bar(0, 10)).toBe('░'.repeat(10));
    expect(bar(0.5, 10)).toBe('█'.repeat(5) + '░'.repeat(5));
    expect(bar(5, 4)).toBe('████');
    expect(bar(-3, 4)).toBe('░░░░');
  });
});
