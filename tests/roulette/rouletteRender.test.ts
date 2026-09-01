import { describe, test, expect } from '@jest/globals';
import {
  buildTableMessage,
  buildBetPanel,
  buildSlipText,
  IDS,
  type TableView,
  type RenderBet,
} from '../../discordCommands/roulette/rouletteRender.js';
import { WHEEL_POSITIONS, CHIPS } from '../../discordCommands/roulette/rouletteConfig.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Discord rejects an over-budget message outright, so a layout regression breaks the
 * whole table rather than looking slightly wrong. These bounds are measured from the
 * API docs: a Container holds 10 children, a message 10 top-level and 40 total
 * components, a StringSelect 25 options.
 *
 * The 5-action-row bound is the conservative legacy cap. Components V2 may permit
 * more, but staying under it means the layout is valid either way.
 */
const LIMITS = { topLevel: 10, actionRows: 5, containerChildren: 10, total: 40, selectOptions: 25 };

function countComponents(node: any): number {
  let total = 1;
  if (Array.isArray(node.components)) {
    for (const child of node.components) total += countComponents(child);
  }
  if (node.accessory) total += 1;
  return total;
}

function measure(payload: { components: unknown[] }) {
  const comps = payload.components as any[];
  const container = comps.find((c) => c.type === 17);
  const selects = comps.flatMap((c) => c.components ?? []).filter((c: any) => c.type === 3);

  return {
    topLevel: comps.length,
    actionRows: comps.filter((c) => c.type === 1).length,
    containerChildren: container ? container.components.length : 0,
    total: comps.reduce((sum, c) => sum + countComponents(c), 0),
    maxSelectOptions: selects.length ? Math.max(...selects.map((s: any) => s.options.length)) : 0,
  };
}

function expectWithinLimits(payload: { components: unknown[] }): void {
  const m = measure(payload);
  expect(m.topLevel).toBeLessThanOrEqual(LIMITS.topLevel);
  expect(m.actionRows).toBeLessThanOrEqual(LIMITS.actionRows);
  expect(m.containerChildren).toBeLessThanOrEqual(LIMITS.containerChildren);
  expect(m.total).toBeLessThanOrEqual(LIMITS.total);
  expect(m.maxSelectOptions).toBeLessThanOrEqual(LIMITS.selectOptions);
}

function allButtons(payload: { components: unknown[] }): any[] {
  return (payload.components as any[])
    .flatMap((c) => c.components ?? [])
    .filter((c: any) => c.type === 2);
}

function allText(payload: { components: unknown[] }): string {
  const out: string[] = [];
  const walk = (n: any): void => {
    if (n.type === 10) out.push(n.content);
    (n.components ?? []).forEach(walk);
  };
  (payload.components as any[]).forEach(walk);
  return out.join('\n');
}

const emptyTable: TableView = {
  phase: 'betting',
  closesAt: Date.now() + 45_000,
  bets: [],
  recentSpins: [],
  spinCount: 0,
  sessionWagered: 0,
};

/** A deliberately punishing table: many players, many bet types, max stakes. */
const busyTable: TableView = {
  ...emptyTable,
  bets: Array.from(
    { length: 60 },
    (_, i): RenderBet => ({
      userId: `user${i % 12}`,
      betType: [
        'red',
        'black',
        'odd',
        'even',
        'low',
        'high',
        'first-dozen',
        '17',
        '0',
        '00',
        'third-column',
        '5',
      ][i % 12],
      amount: 100_000,
    })
  ),
  recentSpins: ['0', '00', '17', '4', '19', '32', '15', '1', '36', '2', '13', '26'],
};

describe('table message layout', () => {
  const phases: [string, TableView][] = [
    ['empty betting', emptyTable],
    ['busy betting', busyTable],
    [
      'spinning',
      { ...busyTable, phase: 'spinning', closesAt: null, tumbling: ['1', '2', '3', '4', '5'] },
    ],
    [
      'result',
      {
        ...busyTable,
        phase: 'result',
        closesAt: null,
        result: { position: '17', color: 'black' },
        payouts: Array.from({ length: 15 }, (_, i) => ({
          userId: `user${i}`,
          betType: '17',
          amount: 100_000,
          profit: 3_500_000,
          won: true,
          paid: i !== 3,
        })),
      },
    ],
    [
      'closed',
      { ...emptyTable, phase: 'closed', closesAt: null, spinCount: 8, sessionWagered: 421_000 },
    ],
  ];

  test.each(phases)('%s stays within Discord component limits', (_label, view) => {
    expectWithinLimits(buildTableMessage(view));
  });

  test.each(phases)('%s stays within the 4000-char text limit', (_label, view) => {
    expect(allText(buildTableMessage(view)).length).toBeLessThanOrEqual(4000);
  });

  // Without this every player named on the board is notified on every repaint - and
  // the board repaints on every chip and every countdown tick.
  test.each(phases)('%s suppresses mentions', (_label, view) => {
    expect(buildTableMessage(view).allowedMentions).toEqual({ parse: [] });
  });
});

describe('table controls', () => {
  test('offers a button for every configured chip plus a custom option', () => {
    const ids = allButtons(buildTableMessage(emptyTable)).map((b) => b.custom_id);
    for (const chip of CHIPS) {
      expect(ids).toContain(`${IDS.CHIP}${chip}`);
    }
    expect(ids).toContain(IDS.CHIP_CUSTOM);
  });

  // These are the bets players repeat most, so they are buttons rather than select
  // options - a button always fires on a repeat click.
  test('every even-money and dozen bet is one click', () => {
    const ids = allButtons(buildTableMessage(emptyTable)).map((b) => b.custom_id);
    for (const betType of [
      'red',
      'black',
      'odd',
      'even',
      'low',
      'high',
      'first-dozen',
      'second-dozen',
      'third-dozen',
    ]) {
      expect(ids).toContain(`${IDS.BET}${betType}`);
    }
  });

  test('controls are live during betting', () => {
    expect(allButtons(buildTableMessage(emptyTable)).every((b) => !b.disabled)).toBe(true);
  });

  // A click landing mid-spin must not be able to place a bet the wheel has passed.
  test.each(['spinning', 'result', 'closed'] as const)(
    'controls are disabled while %s',
    (phase) => {
      const payload = buildTableMessage({ ...emptyTable, phase, closesAt: null });
      expect(allButtons(payload).every((b) => b.disabled === true)).toBe(true);
    }
  );

  test("every custom id is under Discord's 100-character limit", () => {
    for (const button of allButtons(buildTableMessage(emptyTable))) {
      expect(button.custom_id.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('bet panel', () => {
  const panel = buildBetPanel(1000, buildSlipText([]));

  test('stays within component limits', () => {
    expectWithinLimits(panel);
  });

  test('is ephemeral', () => {
    // 64 = Ephemeral. The panel is per-player, which is what makes its selects safe
    // to re-render without disturbing anyone else.
    expect(panel.flags & 64).toBe(64);
  });

  // 38 pockets against a 25-option select cap is exactly why the panel exists.
  test('covers all 38 pockets across its selects', () => {
    const options = (panel.components as any[])
      .flatMap((c) => c.components ?? [])
      .filter((c: any) => c.type === 3)
      .flatMap((s: any) => s.options.map((o: any) => o.value));

    for (const position of WHEEL_POSITIONS) {
      expect(options).toContain(position);
    }
  });

  test('covers all three column bets', () => {
    const options = (panel.components as any[])
      .flatMap((c) => c.components ?? [])
      .filter((c: any) => c.type === 3)
      .flatMap((s: any) => s.options.map((o: any) => o.value));

    expect(options).toEqual(
      expect.arrayContaining(['first-column', 'second-column', 'third-column'])
    );
  });
});

describe('slip', () => {
  test('reads as empty when nothing is down', () => {
    expect(buildSlipText([])).toContain('Nothing on the table');
  });

  test('collapses repeated bets on one type into a single total', () => {
    const slip = buildSlipText([
      { userId: 'u1', betType: 'red', amount: 500 },
      { userId: 'u1', betType: 'red', amount: 500 },
    ]);
    expect(slip).toContain('1K');
    expect(slip).toContain('Total');
  });

  test('totals across bet types', () => {
    const slip = buildSlipText([
      { userId: 'u1', betType: 'red', amount: 1000 },
      { userId: 'u1', betType: '17', amount: 500 },
    ]);
    expect(slip).toContain('1.5K');
  });
});
