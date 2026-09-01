import { describe, test, expect } from '@jest/globals';
import {
  IDS,
  buildBoard,
  buildSlipText,
  type SeatView,
  type TablePhase,
  type TableView,
} from '../../discordCommands/blackjack/blackjackRender.js';
import {
  newHand,
  resolveHand,
  type PlayerHand,
} from '../../discordCommands/blackjack/blackjackEngine.js';
import { BUDGET, countComponents } from '../../casino/casinoRender.js';
import {
  createShoe,
  type Card,
  type Rank,
  type Suit,
} from '../../discordCommands/blackjack/blackjackUtils.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const c = (rank: Rank, suit: Suit = '♠'): Card => ({ rank, suit });

function seat(overrides: Partial<SeatView> = {}): SeatView {
  const hands: PlayerHand[] = [newHand([c('9'), c('7')], 1000)];
  return {
    userId: '1',
    username: 'AJ',
    stake: 1000,
    hands,
    activeHandIndex: 0,
    insuranceBet: 0,
    sideBets: { pairs: 0, p3: 0 },
    acting: true,
    ...overrides,
  };
}

function view(overrides: Partial<TableView> = {}): TableView {
  return {
    phase: 'acting',
    shoe: createShoe(6),
    dealerHand: [c('K'), c('5')],
    hideHole: true,
    seats: [seat()],
    deadline: Date.now() + 45_000,
    roundCount: 1,
    roundStake: 1000,
    ...overrides,
  };
}

function measure(payload: { components: unknown[] }) {
  const comps = payload.components as any[];
  const container = comps.find((x) => x.type === 17);
  return {
    topLevel: comps.length,
    containerChildren: container ? container.components.length : 0,
    total: comps.reduce((s, x) => s + countComponents(x), 0),
  };
}

function buttonIds(payload: { components: unknown[] }): string[] {
  return (payload.components as any[])
    .flatMap((x) => x.components ?? [])
    .filter((x: any) => x.type === 2)
    .map((x: any) => x.custom_id)
    .filter(Boolean);
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
  const phases: TablePhase[] = [
    'idle',
    'betting',
    'dealing',
    'insurance',
    'acting',
    'dealer',
    'settled',
  ];

  test.each(phases)('%s stays inside every limit', (phase) => {
    const m = measure(buildBoard(view({ phase })));
    expect(m.topLevel).toBeLessThanOrEqual(BUDGET.topLevel);
    expect(m.containerChildren).toBeLessThanOrEqual(BUDGET.containerChildren);
    expect(m.total).toBeLessThanOrEqual(BUDGET.total);
  });

  // Seats are unlimited, so the board must survive a genuinely crowded table - the case
  // that made the two-zone layout necessary in the first place.
  test('twenty seats, each with four split hands, is still in budget', () => {
    const busy: SeatView[] = Array.from({ length: 20 }, (_, i) =>
      seat({
        userId: String(i),
        username: `p${i}`,
        hands: Array.from({ length: 4 }, () => newHand([c('8'), c('8')], 500)),
        acting: i % 2 === 0,
      })
    );

    const m = measure(buildBoard(view({ seats: busy })));
    expect(m.topLevel).toBeLessThanOrEqual(BUDGET.topLevel);
    expect(m.containerChildren).toBeLessThanOrEqual(BUDGET.containerChildren);
    expect(m.total).toBeLessThanOrEqual(BUDGET.total);
  });
});

// ============ TWO ZONES ============

describe('two-zone layout', () => {
  test('acting seats show their cards, settled seats collapse', () => {
    const stood: PlayerHand = newHand([c('K'), c('9')], 1000);
    stood.status = 'stood';

    const payload = buildBoard(
      view({
        seats: [
          seat({ userId: '1', acting: true }),
          seat({
            userId: '2',
            hands: [stood],
            acting: false,
            results: [resolveHand(stood, [c('K'), c('5'), c('9')])],
            net: 1000,
          }),
        ],
      })
    );

    const body = text(payload);
    expect(body).toContain('ACTING');
    expect(body).toContain('DONE');
  });

  // The property the design exists for: the board must not keep growing as seats pile
  // up, because a settled seat costs a clause rather than a block.
  test('a settled seat costs far less height than an acting one', () => {
    const stood: PlayerHand = newHand([c('K'), c('9')], 1000);
    stood.status = 'stood';

    const heightWith = (acting: boolean): number =>
      text(
        buildBoard(
          view({
            seats: Array.from({ length: 6 }, (_, i) =>
              seat({
                userId: String(i),
                hands: [acting ? newHand([c('9'), c('7')], 1000) : stood],
                acting,
                results: acting ? undefined : [resolveHand(stood, [c('K'), c('5'), c('9')])],
                net: acting ? undefined : 1000,
              })
            ),
          })
        )
      ).split('\n').length;

    expect(heightWith(false)).toBeLessThan(heightWith(true));
  });

  test('an empty table says so', () => {
    expect(text(buildBoard(view({ seats: [], phase: 'idle' })))).toContain('No seats taken');
  });
});

// ============ CONTROLS ============

describe('controls by phase', () => {
  test('betting offers chips and seating, never play actions', () => {
    const ids = buttonIds(buildBoard(view({ phase: 'betting' })));
    expect(ids).toContain(IDS.SIT);
    expect(ids).toContain(IDS.LEAVE);
    expect(ids).not.toContain(IDS.HIT);
  });

  test('acting offers every play action', () => {
    const ids = buttonIds(buildBoard(view({ phase: 'acting' })));
    expect(ids).toEqual(
      expect.arrayContaining([IDS.HIT, IDS.STAND, IDS.DOUBLE, IDS.SPLIT, IDS.SURRENDER])
    );
    expect(ids).not.toContain(IDS.SIT);
  });

  test('insurance offers exactly the two answers', () => {
    const ids = buttonIds(buildBoard(view({ phase: 'insurance' })));
    expect(ids).toEqual([IDS.INSURANCE_YES, IDS.INSURANCE_NO]);
  });

  test.each(['dealing', 'dealer', 'settled'] as TablePhase[])(
    '%s shows no controls at all',
    (phase) => {
      expect(buttonIds(buildBoard(view({ phase })))).toHaveLength(0);
    }
  );

  test("every custom id is under Discord's 100-character limit", () => {
    for (const id of buttonIds(buildBoard(view({ phase: 'acting' })))) {
      expect(id.length).toBeLessThanOrEqual(100);
    }
  });
});

// ============ DEALER ============

describe('dealer block', () => {
  test('an ace upcard is named rather than counted', () => {
    const body = text(buildBoard(view({ dealerHand: [c('A'), c('5')], hideHole: true })));
    expect(body).toContain('showing an Ace');
  });

  test('a numeric upcard shows its value', () => {
    const body = text(buildBoard(view({ dealerHand: [c('9'), c('5')], hideHole: true })));
    expect(body).toContain('showing 9');
  });

  test('the hole card stays hidden until it is turned', () => {
    const hidden = text(buildBoard(view({ hideHole: true })));
    const shown = text(buildBoard(view({ hideHole: false, phase: 'dealer' })));
    expect(hidden).not.toBe(shown);
  });
});

// ============ SHOE ============

describe('the shoe', () => {
  test('depth is always on the board, because counting depends on it', () => {
    expect(text(buildBoard(view()))).toMatch(/cards/);
  });

  test('a reshuffle is announced', () => {
    const shoe = createShoe(6);
    shoe.justShuffled = true;
    expect(text(buildBoard(view({ shoe })))).toContain('reshuffled');
  });
});

// ============ SIDE BETS ============

describe('side bets', () => {
  test('a hit is called out on the shared board', () => {
    const payload = buildBoard(
      view({
        seats: [
          seat({
            sideBets: { pairs: 100, p3: 0 },
            sideBetResults: [
              {
                kind: 'pairs',
                stake: 100,
                tier: 'perfect',
                payout: 2600,
                net: 2500,
                label: 'Perfect pair 25:1',
              },
            ],
          }),
        ],
      })
    );

    const body = text(payload);
    expect(body).toContain('Perfect pair 25:1');
    expect(body).toContain('+2.5K');
  });

  test('a losing side bet is not called out', () => {
    const payload = buildBoard(
      view({
        seats: [
          seat({
            sideBets: { pairs: 100, p3: 0 },
            sideBetResults: [
              {
                kind: 'pairs',
                stake: 100,
                tier: null,
                payout: 0,
                net: -100,
                label: 'Perfect Pairs — no pair',
              },
            ],
          }),
        ],
      })
    );
    expect(text(payload)).not.toContain('Perfect Pairs — no pair');
  });

  test('stakes are listed while seats are still open', () => {
    const body = text(
      buildBoard(view({ phase: 'betting', seats: [seat({ sideBets: { pairs: 500, p3: 500 } })] }))
    );
    expect(body).toContain('pairs');
    expect(body).toContain('21+3');
  });
});

// ============ SLIP ============

describe('slip', () => {
  test('tells an unseated player how to join', () => {
    const slip = buildSlipText(null, 1000, 50_000);
    expect(slip).toContain('not seated');
    expect(slip).toContain('Sit');
  });

  test('reports the riding stake and balance', () => {
    const slip = buildSlipText(seat(), 1000, 50_000);
    expect(slip).toContain('Riding stake');
    expect(slip).toContain('50K');
  });

  test('marks which of several split hands is live', () => {
    const slip = buildSlipText(
      seat({
        hands: [newHand([c('8'), c('3')], 500), newHand([c('8'), c('K')], 500)],
        activeHandIndex: 1,
      }),
      500,
      10_000
    );
    expect(slip).toContain('▶');
  });
});
