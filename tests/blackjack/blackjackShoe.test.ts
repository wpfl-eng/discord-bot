import { describe, test, expect } from '@jest/globals';
import {
  SHOE_PENETRATION,
  beginHand,
  createShoe,
  drawFromShoe,
  needsShuffle,
  shoeRemaining,
  shoeSize,
  shuffleShoe,
  formatCard,
  type Shoe,
} from '../../discordCommands/blackjack/blackjackUtils.js';

describe('shoe', () => {
  test('starts full for its deck count', () => {
    const shoe: Shoe = createShoe(6);
    expect(shoeSize(shoe)).toBe(312);
    expect(shoe.cards).toHaveLength(312);
    expect(shoeRemaining(shoe)).toBe(312);
  });

  test('holds exactly four of each rank per deck, with no duplicated cards', () => {
    const shoe: Shoe = createShoe(1);
    const seen = new Set(shoe.cards.map(formatCard));
    expect(seen.size).toBe(52);
  });

  test('a six-deck shoe holds six of every distinct card', () => {
    const shoe: Shoe = createShoe(6);
    const counts = new Map<string, number>();
    for (const card of shoe.cards) {
      const key = formatCard(card);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    expect([...counts.values()].every((n) => n === 6)).toBe(true);
  });

  test('drawing depletes it one card at a time', () => {
    const shoe: Shoe = createShoe(1);
    drawFromShoe(shoe);
    drawFromShoe(shoe);
    expect(shoe.dealt).toBe(2);
    expect(shoeRemaining(shoe)).toBe(50);
    expect(shoe.cards).toHaveLength(50);
  });

  // The cut card is what makes a persistent shoe meaningful; without it the shoe would
  // run to the last card and counting would be trivial.
  test('the cut card comes out at the configured penetration', () => {
    const shoe: Shoe = createShoe(6);
    expect(needsShuffle(shoe)).toBe(false);

    shoe.dealt = Math.floor(shoeSize(shoe) * SHOE_PENETRATION) - 1;
    expect(needsShuffle(shoe)).toBe(false);

    shoe.dealt = Math.ceil(shoeSize(shoe) * SHOE_PENETRATION);
    expect(needsShuffle(shoe)).toBe(true);
  });

  test('shuffling restores a full shoe', () => {
    const shoe: Shoe = createShoe(6);
    shoe.dealt = 300;
    shuffleShoe(shoe);
    expect(shoe.dealt).toBe(0);
    expect(shoe.cards).toHaveLength(312);
  });

  // A real table finishes the hand it is dealing before the cut card takes effect, so
  // the check belongs at the start of a hand and nowhere else.
  test('beginHand only shuffles once the cut card is reached', () => {
    const shoe: Shoe = createShoe(6);
    shoe.dealt = 10;
    expect(beginHand(shoe)).toBe(false);
    expect(shoe.dealt).toBe(10);
    expect(shoe.justShuffled).toBe(false);

    shoe.dealt = 300;
    expect(beginHand(shoe)).toBe(true);
    expect(shoe.dealt).toBe(0);
    expect(shoe.justShuffled).toBe(true);
  });

  test('the shuffle flag clears on the next hand', () => {
    const shoe: Shoe = createShoe(6);
    shoe.dealt = 300;
    beginHand(shoe);
    expect(shoe.justShuffled).toBe(true);

    beginHand(shoe);
    expect(shoe.justShuffled).toBe(false);
  });

  test('state carries across hands, which is the point of a persistent shoe', () => {
    const shoe: Shoe = createShoe(6);
    beginHand(shoe);
    for (let i = 0; i < 20; i++) drawFromShoe(shoe);

    beginHand(shoe);
    expect(shoe.dealt).toBe(20);
    expect(shoeRemaining(shoe)).toBe(292);
  });

  // With a cut card at 75% this should be unreachable, but dealing undefined mid-hand
  // would be far worse than an unexpected reshuffle.
  test('an exhausted shoe reshuffles rather than dealing nothing', () => {
    const shoe: Shoe = createShoe(1);
    shoe.cards = [];
    const card = drawFromShoe(shoe);
    expect(card).toBeDefined();
    expect(card.rank).toBeDefined();
  });

  test('remaining never reports negative', () => {
    const shoe: Shoe = createShoe(1);
    shoe.dealt = 999;
    expect(shoeRemaining(shoe)).toBe(0);
  });
});
