import { describe, test, expect } from '@jest/globals';
import {
  MAX_HANDS,
  canDoubleHand,
  canSplitHand,
  canSurrenderHand,
  dealerMustPlay,
  doubleHand,
  hitHand,
  isNatural,
  newHand,
  nextPlayableHand,
  playDealerTurn,
  resolveHand,
  resolveInsurance,
  splitHand,
  totalStaked,
  type PlayerHand,
} from '../../discordCommands/blackjack/blackjackEngine.js';
import {
  TABLES,
  type TableConfig,
  createShoe,
  type Card,
  type Hand,
  type Rank,
  type Shoe,
  type Suit,
} from '../../discordCommands/blackjack/blackjackUtils.js';

const card = (rank: Rank, suit: Suit = '♠'): Card => ({ rank, suit });

/** A shoe that deals exactly the cards named, in order. */
function stackedShoe(cards: Hand): Shoe {
  const shoe = createShoe(1);
  shoe.cards = [...cards].reverse(); // drawn with pop()
  return shoe;
}

const hand = (cards: Hand, bet = 100, fromSplit = false): PlayerHand =>
  newHand(cards, bet, fromSplit);

describe('resolveHand', () => {
  const dealer20: Hand = [card('K'), card('Q')];

  test('a natural pays 3:2', () => {
    const result = resolveHand(hand([card('A'), card('K')], 1000), dealer20);
    expect(result.outcome).toBe('blackjack');
    expect(result.payout).toBe(2500);
    expect(result.net).toBe(1500);
  });

  // Half a coin cannot be paid, and rounding up would leak money to the player on
  // every odd stake.
  test('a natural on an odd stake floors rather than rounds up', () => {
    expect(resolveHand(hand([card('A'), card('K')], 101), dealer20).payout).toBe(252);
  });

  test('natural against natural is a push', () => {
    const result = resolveHand(hand([card('A'), card('K')], 1000), [card('A'), card('Q')]);
    expect(result.outcome).toBe('push');
    expect(result.payout).toBe(1000);
    expect(result.net).toBe(0);
  });

  // Even money is the whole point of the prompt: a guaranteed 1:1 instead of risking
  // the push against a dealer natural.
  test('even money pays 1:1 even when the dealer also has a natural', () => {
    const result = resolveHand(hand([card('A'), card('K')], 1000), [card('A'), card('Q')], {
      evenMoney: true,
    });
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(2000);
  });

  test('a bust loses even when the dealer busts too', () => {
    const busted = hand([card('K'), card('Q'), card('5')], 500);
    busted.status = 'busted';
    const result = resolveHand(busted, [card('K'), card('Q'), card('5')]);
    expect(result.outcome).toBe('loss');
    expect(result.payout).toBe(0);
    expect(result.isBust).toBe(true);
  });

  test('a dealer bust pays even money', () => {
    const result = resolveHand(hand([card('K'), card('8')], 500), [
      card('K'),
      card('Q'),
      card('5'),
    ]);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(1000);
  });

  test('a dealer natural beats a non-natural 21', () => {
    const twentyOne = hand([card('7'), card('7'), card('7')], 500);
    twentyOne.status = 'stood';
    const result = resolveHand(twentyOne, [card('A'), card('K')]);
    expect(result.outcome).toBe('loss');
  });

  test('higher total wins, lower loses, equal pushes', () => {
    expect(resolveHand(hand([card('K'), card('9')], 100), dealer20).outcome).toBe('loss');
    expect(resolveHand(hand([card('K'), card('K')], 100), dealer20).outcome).toBe('push');
    expect(resolveHand(hand([card('K'), card('A')], 100, true), dealer20).outcome).toBe('win');
  });

  test('surrender returns half the stake', () => {
    const surrendered = hand([card('K'), card('6')], 1000);
    surrendered.status = 'surrendered';
    const result = resolveHand(surrendered, dealer20);
    expect(result.outcome).toBe('surrender');
    expect(result.payout).toBe(500);
    expect(result.net).toBe(-500);
  });

  // 21 on a split hand is not a natural; paying 3:2 there would be a real money bug.
  test('21 made from a split pays 1:1, not 3:2', () => {
    const split = hand([card('A'), card('K')], 1000, true);
    const result = resolveHand(split, [card('K'), card('9')]);
    expect(result.outcome).toBe('win');
    expect(result.payout).toBe(2000);
    expect(isNatural(split)).toBe(false);
  });

  test('a doubled hand settles against its full stake', () => {
    const doubled = hand([card('5'), card('6')], 100);
    doubleHand(doubled, stackedShoe([card('K')]), 100);
    const result = resolveHand(doubled, [card('K'), card('7')]);
    expect(doubled.bet).toBe(200);
    expect(result.payout).toBe(400);
  });
});

describe('insurance', () => {
  test('pays 2:1 plus the stake back when the dealer has a natural', () => {
    expect(resolveInsurance(500, [card('A'), card('K')])).toBe(1500);
  });

  test('pays nothing when the dealer does not', () => {
    expect(resolveInsurance(500, [card('A'), card('9')])).toBe(0);
  });

  test('is a no-op when no insurance was taken', () => {
    expect(resolveInsurance(0, [card('A'), card('K')])).toBe(0);
  });
});

describe('splitting', () => {
  test('allows an exact pair', () => {
    expect(canSplitHand(hand([card('8'), card('8')]), 1)).toBe(true);
  });

  // Unchanged from the previous rules: matching value is not enough.
  test('refuses two ten-value cards of different rank', () => {
    expect(canSplitHand(hand([card('K'), card('Q')]), 1)).toBe(false);
  });

  test('allows re-splitting up to four hands and no further', () => {
    const pair = hand([card('8'), card('8')]);
    expect(canSplitHand(pair, 1)).toBe(true);
    expect(canSplitHand(pair, 3)).toBe(true);
    expect(canSplitHand(pair, MAX_HANDS)).toBe(false);
  });

  test('produces a second hand carrying its own stake', () => {
    const original = hand([card('8'), card('8')], 500);
    const created = splitHand(original, stackedShoe([card('3'), card('9')]), 500);

    expect(original.cards).toHaveLength(2);
    expect(created.cards).toHaveLength(2);
    expect(created.bet).toBe(500);
    expect(original.fromSplit).toBe(true);
    expect(created.fromSplit).toBe(true);
    expect(totalStaked([original, created])).toBe(1000);
  });

  // Split aces take one card and stand; without this a pair of aces could be drawn out
  // into several strong hands.
  test('split aces take one card each and stand', () => {
    const aces = hand([card('A'), card('A')], 500);
    const created = splitHand(aces, stackedShoe([card('9'), card('7')]), 500);

    expect(aces.cards).toHaveLength(2);
    expect(created.cards).toHaveLength(2);
    expect(aces.status).toBe('stood');
    expect(created.status).toBe('stood');
    expect(canSplitHand(aces, 2)).toBe(false);
    expect(canDoubleHand(aces)).toBe(false);
  });

  test('an ace-ten from split aces is 21 but not a natural', () => {
    const aces = hand([card('A'), card('A')], 500);
    const created = splitHand(aces, stackedShoe([card('K'), card('K')]), 500);
    expect(isNatural(aces)).toBe(false);
    expect(isNatural(created)).toBe(false);
    expect(resolveHand(created, [card('K'), card('9')]).payout).toBe(1000);
  });
});

describe('hitting and doubling', () => {
  test('busting marks the hand busted', () => {
    const h = hand([card('K'), card('9')]);
    hitHand(h, stackedShoe([card('5')]));
    expect(h.status).toBe('busted');
  });

  // Prompting on a 21 only invites a misclick that busts a made hand.
  test('reaching 21 stands automatically', () => {
    const h = hand([card('K'), card('6')]);
    hitHand(h, stackedShoe([card('5')]));
    expect(h.status).toBe('stood');
  });

  test('a live hand stays playable', () => {
    const h = hand([card('5'), card('4')]);
    hitHand(h, stackedShoe([card('3')]));
    expect(h.status).toBe('playing');
  });

  test('doubling is only offered on the opening two cards', () => {
    const h = hand([card('5'), card('4')]);
    expect(canDoubleHand(h)).toBe(true);
    hitHand(h, stackedShoe([card('3')]));
    expect(canDoubleHand(h)).toBe(false);
  });

  test('doubling takes exactly one card and stands', () => {
    const h = hand([card('5'), card('6')], 100);
    doubleHand(h, stackedShoe([card('9')]), 100);
    expect(h.cards).toHaveLength(3);
    expect(h.status).toBe('stood');
    expect(h.doubled).toBe(true);
  });
});

describe('surrender', () => {
  test('is offered on an untouched opening hand', () => {
    expect(canSurrenderHand(hand([card('K'), card('6')]), 1)).toBe(true);
  });

  test('is withdrawn once the hand has been hit', () => {
    const h = hand([card('K'), card('6')]);
    hitHand(h, stackedShoe([card('2')]));
    expect(canSurrenderHand(h, 1)).toBe(false);
  });

  test('is withdrawn once the hand has been split', () => {
    expect(canSurrenderHand(hand([card('8'), card('8')], 100, true), 2)).toBe(false);
  });
});

describe('turn order', () => {
  test('finds the next hand still in play', () => {
    const hands = [hand([card('K'), card('Q')]), hand([card('5'), card('6')])];
    hands[0].status = 'stood';
    expect(nextPlayableHand(hands)).toBe(1);
  });

  test('reports -1 when every hand is finished', () => {
    const hands = [hand([card('K'), card('Q')])];
    hands[0].status = 'busted';
    expect(nextPlayableHand(hands)).toBe(-1);
  });

  // Drawing for the dealer when nothing can beat him only reveals the hole card for no
  // reason, and burns cards out of the shoe.
  test('the dealer does not draw when every hand busted', () => {
    const hands = [hand([card('K'), card('Q'), card('5')])];
    hands[0].status = 'busted';
    expect(dealerMustPlay(hands)).toBe(false);
  });

  test('the dealer draws when any hand stands', () => {
    const hands = [hand([card('K'), card('Q')]), hand([card('5'), card('6')])];
    hands[0].status = 'busted';
    hands[1].status = 'stood';
    expect(dealerMustPlay(hands)).toBe(true);
  });
});

describe('dealer play', () => {
  test('stands on hard 17', () => {
    const dealer: Hand = [card('K'), card('7')];
    playDealerTurn(dealer, stackedShoe([card('5')]), TABLES.main);
    expect(dealer).toHaveLength(2);
  });

  test('draws below 17', () => {
    const dealer: Hand = [card('K'), card('6')];
    playDealerTurn(dealer, stackedShoe([card('4')]), TABLES.main);
    expect(dealer).toHaveLength(3);
  });

  // The house now runs one table, but the engine still implements both soft-17 rules,
  // so both stay covered. The configs are built inline rather than pulled from TABLES,
  // which deliberately offers only the one the house actually deals.
  test('S17 stands on soft 17, H17 hits it', () => {
    const s17Table: TableConfig = { ...TABLES.main, dealerHitsSoft17: false };
    const h17Table: TableConfig = { ...TABLES.main, dealerHitsSoft17: true };

    const s17: Hand = [card('A'), card('6')];
    playDealerTurn(s17, stackedShoe([card('2')]), s17Table);
    expect(s17).toHaveLength(2);

    const h17: Hand = [card('A'), card('6')];
    playDealerTurn(h17, stackedShoe([card('2')]), h17Table);
    expect(h17).toHaveLength(3);
  });

  // D6: the two tables collapsed into one six-deck, stand-on-soft-17 game.
  test('the house table is 6 decks and stands on soft 17', () => {
    expect(Object.keys(TABLES)).toEqual(['main']);
    expect(TABLES.main.deckCount).toBe(6);
    expect(TABLES.main.dealerHitsSoft17).toBe(false);
  });
});

describe('staking', () => {
  test('totals every hand plus insurance', () => {
    const hands = [hand([card('8'), card('8')], 500), hand([card('8'), card('3')], 500)];
    expect(totalStaked(hands)).toBe(1000);
    expect(totalStaked(hands, 250)).toBe(1250);
  });

  // The worst case the 100,000 cap allows.
  test('four doubled hands plus insurance at the cap', () => {
    const hands = Array.from({ length: MAX_HANDS }, () => hand([card('5'), card('6')], 200_000));
    expect(totalStaked(hands, 50_000)).toBe(850_000);
  });
});
