import { describe, test, expect } from '@jest/globals';
import {
  IDS,
  buildEvenMoneyPrompt,
  buildGameMessage,
  buildInsurancePrompt,
  playAgainId,
  type GameView,
} from '../../discordCommands/blackjack/blackjackRender.js';
import {
  MAX_HANDS,
  newHand,
  resolveHand,
  type PlayerHand,
} from '../../discordCommands/blackjack/blackjackEngine.js';
import {
  TABLES,
  createShoe,
  type Card,
  type Rank,
  type Suit,
} from '../../discordCommands/blackjack/blackjackUtils.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const c = (rank: Rank, suit: Suit = '♠'): Card => ({ rank, suit });

const LIMITS = { topLevel: 10, actionRows: 5, containerChildren: 10, total: 40 };

function countComponents(node: any): number {
  let total = 1;
  if (Array.isArray(node.components))
    for (const child of node.components) total += countComponents(child);
  if (node.accessory) total += 1;
  return total;
}

function expectWithinLimits(payload: { components: unknown[] }): void {
  const comps = payload.components as any[];
  const container = comps.find((x) => x.type === 17);
  expect(comps.length).toBeLessThanOrEqual(LIMITS.topLevel);
  expect(comps.filter((x) => x.type === 1).length).toBeLessThanOrEqual(LIMITS.actionRows);
  expect(container ? container.components.length : 0).toBeLessThanOrEqual(LIMITS.containerChildren);
  expect(comps.reduce((s, x) => s + countComponents(x), 0)).toBeLessThanOrEqual(LIMITS.total);
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
    .flatMap((x) => x.components ?? [])
    .filter((x: any) => x.type === 2);
}

const baseView: GameView = {
  table: TABLES.classic,
  shoe: null,
  dealerHand: [c('9', '♥'), c('K')],
  hideHole: true,
  hands: [newHand([c('K', '♦'), c('7', '♣')], 1000)],
  activeHandIndex: 0,
  insuranceBet: 0,
  balance: 12_500,
  originalBet: 1000,
};

/** The worst case the rules allow: four hands, all doubled, plus insurance. */
function maxHandsView(): GameView {
  const hands: PlayerHand[] = Array.from({ length: MAX_HANDS }, () => {
    const h = newHand([c('8'), c('3'), c('9')], 200_000, true);
    h.doubled = true;
    h.status = 'stood';
    return h;
  });
  hands[MAX_HANDS - 1].status = 'playing';

  return {
    ...baseView,
    table: TABLES.vegas,
    shoe: createShoe(6),
    hands,
    activeHandIndex: MAX_HANDS - 1,
    insuranceBet: 50_000,
    balance: 1_250_000,
    originalBet: 100_000,
  };
}

describe('game message layout', () => {
  test('a single hand stays within limits', () => {
    expectWithinLimits(buildGameMessage(baseView));
  });

  // Four doubled hands is the most the rules can produce, so if anything fits, this does.
  test('four hands with every action available stays within limits', () => {
    expectWithinLimits(
      buildGameMessage({ ...maxHandsView(), canDouble: true, canSplit: true, canSurrender: true })
    );
  });

  test('the settled view stays within limits', () => {
    const view = maxHandsView();
    expectWithinLimits(
      buildGameMessage({
        ...view,
        hideHole: false,
        results: view.hands.map((h) => resolveHand(h, view.dealerHand)),
        netProfit: -400_000,
        canPlayAgain: true,
      })
    );
  });

  test.each([
    ['insurance', () => buildInsurancePrompt(baseView, 500)],
    ['even money', () => buildEvenMoneyPrompt(baseView)],
  ])('the %s prompt stays within limits', (_label, build) => {
    expectWithinLimits(build());
  });

  test('stays within the 4000-character text limit at four hands', () => {
    expect(text(buildGameMessage(maxHandsView())).length).toBeLessThanOrEqual(4000);
  });

  // The hand is private, so it must be ephemeral - this is what keeps blackjack from
  // adding anything to the channel.
  test('every view is ephemeral', () => {
    for (const payload of [
      buildGameMessage(baseView),
      buildInsurancePrompt(baseView, 500),
      buildEvenMoneyPrompt(baseView),
    ]) {
      expect(payload.flags & 64).toBe(64);
    }
  });
});

describe('controls', () => {
  test('hit and stand are always offered while playing', () => {
    const ids = buttons(buildGameMessage(baseView)).map((b) => b.custom_id);
    expect(ids).toContain(IDS.HIT);
    expect(ids).toContain(IDS.STAND);
  });

  test('double, split and surrender appear only when available', () => {
    const without = buttons(buildGameMessage(baseView)).map((b) => b.custom_id);
    expect(without).not.toContain(IDS.DOUBLE);
    expect(without).not.toContain(IDS.SPLIT);
    expect(without).not.toContain(IDS.SURRENDER);

    const withAll = buttons(
      buildGameMessage({ ...baseView, canDouble: true, canSplit: true, canSurrender: true })
    ).map((b) => b.custom_id);
    expect(withAll).toContain(IDS.DOUBLE);
    expect(withAll).toContain(IDS.SPLIT);
    expect(withAll).toContain(IDS.SURRENDER);
  });

  // Play Again reads its stake and table back from the customId, so the id must carry
  // both. The label is presentation only and must not be what the replay depends on.
  test('the settled view offers Play Again carrying the stake and table', () => {
    const payload = buildGameMessage({
      ...baseView,
      hideHole: false,
      results: [resolveHand(baseView.hands[0], baseView.dealerHand)],
      netProfit: -1000,
      canPlayAgain: true,
    });
    const play = buttons(payload).find((b) => b.custom_id.startsWith(IDS.PLAY_AGAIN));
    expect(play).toBeDefined();
    expect(play.custom_id).toBe(playAgainId(1000, baseView.table.name));
    expect(play.label).toContain('1,000');
  });

  test('Play Again is withheld when the player cannot cover the stake', () => {
    const payload = buildGameMessage({
      ...baseView,
      hideHole: false,
      results: [resolveHand(baseView.hands[0], baseView.dealerHand)],
      netProfit: -1000,
      canPlayAgain: false,
    });
    expect(buttons(payload)).toHaveLength(0);
  });

  test('no play controls survive into the settled view', () => {
    const payload = buildGameMessage({
      ...baseView,
      hideHole: false,
      results: [resolveHand(baseView.hands[0], baseView.dealerHand)],
      netProfit: -1000,
      canPlayAgain: true,
    });
    const ids = buttons(payload).map((b) => b.custom_id);
    expect(ids).not.toContain(IDS.HIT);
    expect(ids).not.toContain(IDS.STAND);
  });
});

describe('presentation', () => {
  test('hides the hole card while the hand is live and reveals it after', () => {
    expect(text(buildGameMessage(baseView))).toContain('🎴');

    const settled = text(
      buildGameMessage({
        ...baseView,
        hideHole: false,
        results: [resolveHand(baseView.hands[0], baseView.dealerHand)],
        netProfit: -1000,
      })
    );
    expect(settled).not.toContain('🎴');
  });

  // "showing 11" is the ace's value but nobody reads a table that way.
  test('names an ace upcard rather than counting it', () => {
    const body = text(buildGameMessage({ ...baseView, dealerHand: [c('A'), c('K')] }));
    expect(body).toContain('showing an Ace');
    expect(body).not.toContain('showing 11');
  });

  test('marks soft totals but not 21', () => {
    expect(
      text(buildGameMessage({ ...baseView, hands: [newHand([c('A'), c('6')], 100)] }))
    ).toContain('soft 17');
    expect(
      text(buildGameMessage({ ...baseView, hands: [newHand([c('A'), c('K')], 100)] }))
    ).not.toContain('soft 21');
  });

  test('shows the shoe gauge only where the shoe persists', () => {
    expect(
      text(buildGameMessage({ ...baseView, table: TABLES.vegas, shoe: createShoe(6) }))
    ).toContain('cards');
    expect(text(buildGameMessage(baseView))).not.toContain('cards');
  });

  test('calls out a reshuffle', () => {
    const shoe = createShoe(6);
    shoe.justShuffled = true;
    expect(text(buildGameMessage({ ...baseView, table: TABLES.vegas, shoe }))).toContain(
      'reshuffled'
    );
  });

  test('marks which hand is live when several are in play', () => {
    const body = text(buildGameMessage(maxHandsView()));
    expect(body).toContain('your turn');
    expect(body).toContain(`HAND ${MAX_HANDS}`);
  });

  test('labels a single hand without a number', () => {
    expect(text(buildGameMessage(baseView))).toContain('YOUR HAND');
  });

  test('reports insurance and its settlement', () => {
    const body = text(
      buildGameMessage({
        ...baseView,
        insuranceBet: 500,
        hideHole: false,
        results: [resolveHand(baseView.hands[0], baseView.dealerHand)],
        insurancePayout: 1500,
        netProfit: 500,
      })
    );
    expect(body).toContain('Insurance');
    expect(body).toContain('paid');
  });
});
