import { describe, test, expect } from '@jest/globals';
import { buildBoard, buildSlipText, IDS, type BoardView, type RenderBet } from '../../discordCommands/craps/crapsRender.js';
import { CHIPS, type Roll } from '../../discordCommands/craps/crapsConfig.js';
import { BUDGET, countComponents } from '../../casino/casinoRender.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function roll(die1: number, die2: number): Roll {
  return { die1, die2, total: die1 + die2, timestamp: new Date() };
}

function view(overrides: Partial<BoardView> = {}): BoardView {
  return {
    phase: 'betting',
    point: null,
    shooter: { userId: '1', username: 'AJ' },
    bets: [],
    recentRolls: [],
    lastRoll: null,
    deadline: Date.now() + 30_000,
    rollCount: 0,
    sessionWagered: 0,
    ...overrides,
  };
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

function buttonIds(payload: { components: unknown[] }): string[] {
  return (payload.components as any[])
    .flatMap((c) => c.components ?? [])
    .filter((c: any) => c.type === 2)
    .map((c: any) => c.custom_id)
    .filter(Boolean);
}

function selectIds(payload: { components: unknown[] }): string[] {
  return (payload.components as any[])
    .flatMap((c) => c.components ?? [])
    .filter((c: any) => c.type === 3)
    .map((c: any) => c.custom_id);
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

// ============ BUDGET ============

describe('component budget', () => {
  // Discord rejects an over-budget message outright, so a layout regression breaks the
  // whole table rather than looking slightly wrong.
  const cases: Array<[string, BoardView]> = [
    ['come-out betting', view()],
    ['point betting', view({ point: 6 })],
    ['awaiting roll', view({ phase: 'awaiting_roll', point: 6 })],
    ['rolling', view({ phase: 'rolling', point: 6, tumbling: [roll(1, 2), roll(3, 4)] })],
    [
      'resolved',
      view({
        phase: 'resolved',
        point: 6,
        lastRoll: roll(3, 4),
        rollName: 'SEVEN OUT!',
        results: [{ userId: '1', net: -500 }],
        sevenOut: true,
        nextShooter: '2',
      }),
    ],
    ['idle', view({ phase: 'idle', shooter: null, deadline: null })],
  ];

  test.each(cases)('%s stays inside every limit', (_label, v) => {
    const m = measure(buildBoard(v));
    expect(m.topLevel).toBeLessThanOrEqual(BUDGET.topLevel);
    expect(m.containerChildren).toBeLessThanOrEqual(BUDGET.containerChildren);
    expect(m.total).toBeLessThanOrEqual(BUDGET.total);
    expect(m.maxSelectOptions).toBeLessThanOrEqual(BUDGET.selectOptions);
  });

  test('a crowded point-phase table is still in budget', () => {
    const bets: RenderBet[] = Array.from({ length: 40 }, (_, i) => ({
      userId: String(i % 10),
      betType: 'place_6',
      amount: 500 + i,
    }));
    const m = measure(buildBoard(view({ point: 8, bets, rollCount: 14 })));
    expect(m.topLevel).toBeLessThanOrEqual(BUDGET.topLevel);
    expect(m.total).toBeLessThanOrEqual(BUDGET.total);
  });
});

// ============ PHASE-CONTEXTUAL LAYOUT ============

describe('phase-contextual rows', () => {
  // The whole point of the design: an illegal bet is unreachable, not merely rejected.
  test('come-out offers the line but no place or odds', () => {
    const payload = buildBoard(view({ point: null }));
    const ids = buttonIds(payload);

    expect(ids).toContain(`${IDS.BET}pass_line`);
    expect(ids).toContain(`${IDS.BET}dont_pass`);
    expect(ids).not.toContain(IDS.ODDS);
    expect(selectIds(payload)).not.toContain(IDS.SELECT_PLACE);
  });

  test('point phase offers odds and place but closes the line', () => {
    const payload = buildBoard(view({ point: 6 }));
    const ids = buttonIds(payload);

    expect(ids).toContain(IDS.ODDS);
    expect(ids).not.toContain(`${IDS.BET}pass_line`);
    expect(ids).not.toContain(`${IDS.BET}dont_pass`);
    expect(selectIds(payload)).toContain(IDS.SELECT_PLACE);
  });

  test('place select offers exactly the six point numbers', () => {
    const payload = buildBoard(view({ point: 6 }));
    const select = (payload.components as any[])
      .flatMap((c) => c.components ?? [])
      .find((c: any) => c.custom_id === IDS.SELECT_PLACE);

    expect(select.options).toHaveLength(6);
    expect(select.options.map((o: any) => o.value).sort()).toEqual(
      ['place_10', 'place_4', 'place_5', 'place_6', 'place_8', 'place_9'].sort()
    );
  });

  test('come-out prop select excludes hardways, point phase includes them', () => {
    const comeout = (buildBoard(view({ point: null })).components as any[])
      .flatMap((c) => c.components ?? [])
      .find((c: any) => c.custom_id === IDS.SELECT_PROPS);
    const point = (buildBoard(view({ point: 6 })).components as any[])
      .flatMap((c) => c.components ?? [])
      .find((c: any) => c.custom_id === IDS.SELECT_PROPS);

    expect(comeout.options).toHaveLength(5);
    expect(point.options).toHaveLength(9);
  });

  test('chips are offered whenever betting is open', () => {
    const ids = buttonIds(buildBoard(view()));
    for (const chip of CHIPS) expect(ids).toContain(`${IDS.CHIP}${chip}`);
    expect(ids).toContain(IDS.CHIP_CUSTOM);
  });
});

// ============ SHOOTER ============

describe('the shooter', () => {
  test('awaiting_roll shows the ROLL button and nothing else', () => {
    const ids = buttonIds(buildBoard(view({ phase: 'awaiting_roll', point: 6 })));
    expect(ids).toEqual([IDS.ROLL]);
  });

  test('betting phase never shows an enabled ROLL button', () => {
    expect(buttonIds(buildBoard(view()))).not.toContain(IDS.ROLL);
  });

  test('the board names who has the dice', () => {
    expect(text(buildBoard(view()))).toContain('<@1> has the dice');
  });

  test('a seven out announces where the dice go next', () => {
    const body = text(
      buildBoard(
        view({
          phase: 'resolved',
          lastRoll: roll(3, 4),
          rollName: 'SEVEN OUT!',
          results: [{ userId: '1', net: -500 }],
          sevenOut: true,
          nextShooter: '2',
        })
      )
    );
    expect(body).toContain('<@2>');
  });
});

// ============ CONTROLS DURING RESOLUTION ============

describe('controls while the dice are live', () => {
  test('rolling shows no controls at all', () => {
    const payload = buildBoard(view({ phase: 'rolling', tumbling: [roll(1, 1)] }));
    expect(buttonIds(payload)).toHaveLength(0);
    expect(selectIds(payload)).toHaveLength(0);
  });

  test('resolved shows no controls at all', () => {
    const payload = buildBoard(
      view({ phase: 'resolved', lastRoll: roll(3, 3), results: [{ userId: '1', net: 100 }] })
    );
    expect(buttonIds(payload)).toHaveLength(0);
  });
});

// ============ BOARD TEXT ============

describe('bet board', () => {
  test('scales with player count rather than bet variety', () => {
    // The property that matters: one player holding twelve bets must not make the board
    // four times longer than one player holding three. Asserted by comparison rather
    // than against a magic number, so it keeps holding if the layout is reworked.
    const make = (types: string[]): RenderBet[] =>
      types.map((betType) => ({
        userId: '1',
        betType: betType as RenderBet['betType'],
        amount: 100,
      }));

    const few = make(['pass_line', 'place_6', 'hard_8']);
    const many = make([
      'pass_line',
      'pass_odds',
      'place_4',
      'place_5',
      'place_6',
      'place_8',
      'place_9',
      'place_10',
      'hard_4',
      'hard_6',
      'hard_8',
      'hard_10',
    ]);

    const lines = (bets: RenderBet[]): number =>
      text(buildBoard(view({ point: 6, bets }))).split('\n').length;

    expect(lines(many)).toBe(lines(few));
  });

  test('grows by one line per additional player', () => {
    const bet = (userId: string): RenderBet => ({ userId, betType: 'place_6', amount: 100 });

    const one = text(buildBoard(view({ point: 6, bets: [bet('1')] }))).split('\n').length;
    const three = text(
      buildBoard(view({ point: 6, bets: [bet('1'), bet('2'), bet('3')] }))
    ).split('\n').length;

    // Two extra players add two "ON THE TABLE" lines and two "BIGGEST ACTION" lines,
    // since biggest action caps at three.
    expect(three).toBeGreaterThan(one);
    expect(three - one).toBeLessThanOrEqual(4);
  });

  test('an empty table says so', () => {
    expect(text(buildBoard(view()))).toContain('No bets down');
  });
});

// ============ SLIP ============

describe('slip', () => {
  test('reports nothing when the player has no action', () => {
    expect(buildSlipText([], 6)).toContain('nothing on the table');
  });

  test('names the point an odds bet is riding', () => {
    const slip = buildSlipText(
      [{ userId: '1', betType: 'pass_odds', amount: 500, oddsPoint: 6 }],
      6
    );
    expect(slip).toContain('behind the 6');
    expect(slip).toContain('6:5');
  });

  test('totals everything at risk', () => {
    const slip = buildSlipText(
      [
        { userId: '1', betType: 'pass_line', amount: 1000 },
        { userId: '1', betType: 'place_6', amount: 600 },
      ],
      6
    );
    expect(slip).toContain('1.6K');
  });
});
