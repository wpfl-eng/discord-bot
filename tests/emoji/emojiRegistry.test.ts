import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  cardEmojiName,
  pocketEmojiName,
  expectedEmojiNames,
  emoji,
  isLoaded,
  CARD_BACK_NAME,
  __setEmojiForTesting,
  __resetEmojiForTesting,
} from '../../emoji/emojiRegistry.js';
import { RANKS, SUITS } from '../../discordCommands/blackjack/blackjackUtils.js';
import { WHEEL_POSITIONS } from '../../discordCommands/roulette/rouletteConfig.js';

describe('emoji naming', () => {
  test('card names encode rank and suit', () => {
    expect(cardEmojiName('A', '♠')).toBe('cAS');
    expect(cardEmojiName('K', '♥')).toBe('cKH');
    expect(cardEmojiName('2', '♣')).toBe('c2C');
  });

  // '10' is the only two-character rank; collapsing it to T keeps every name the same
  // shape and avoids a name that could collide with '1' + '0'.
  test('ten collapses to T', () => {
    expect(cardEmojiName('10', '♦')).toBe('cTD');
  });

  test('pocket names cover both zeroes distinctly', () => {
    expect(pocketEmojiName('0')).toBe('n0');
    expect(pocketEmojiName('00')).toBe('n00');
    expect(pocketEmojiName('17')).toBe('n17');
  });

  test('every generated name is a legal Discord emoji name', () => {
    // Discord requires 2-32 characters, alphanumeric and underscores only.
    for (const name of expectedEmojiNames(RANKS, SUITS)) {
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(32);
      expect(name).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  test('names are unique across the whole set', () => {
    const names = expectedEmojiNames(RANKS, SUITS);
    expect(new Set(names).size).toBe(names.length);
  });

  test('the set covers every card, the back, and every pocket', () => {
    const names = expectedEmojiNames(RANKS, SUITS);

    // 52 cards + 1 back + 38 pockets
    expect(names).toHaveLength(52 + 1 + WHEEL_POSITIONS.length);
    expect(names).toContain(CARD_BACK_NAME);

    for (const suit of SUITS) {
      for (const rank of RANKS) {
        expect(names).toContain(cardEmojiName(rank, suit));
      }
    }
    for (const position of WHEEL_POSITIONS) {
      expect(names).toContain(pocketEmojiName(position));
    }
  });
});

describe('emoji lookup', () => {
  beforeEach(() => {
    __resetEmojiForTesting();
  });

  // The whole point of the fallback: a bot deployed before the upload runs must still
  // be fully playable, just with text cards.
  test('returns the fallback when nothing has been loaded', () => {
    expect(isLoaded()).toBe(false);
    expect(emoji('cAS', '`A♠`')).toBe('`A♠`');
  });

  test('returns the mention once loaded', () => {
    __setEmojiForTesting('cAS', '<:cAS:123>');
    expect(emoji('cAS', '`A♠`')).toBe('<:cAS:123>');
    expect(isLoaded()).toBe(true);
  });

  test('falls back per-name, so a partial upload degrades gracefully', () => {
    __setEmojiForTesting('cAS', '<:cAS:123>');
    expect(emoji('cAS', '`A♠`')).toBe('<:cAS:123>');
    expect(emoji('cKH', '`K♥`')).toBe('`K♥`');
  });
});
