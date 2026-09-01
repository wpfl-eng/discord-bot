// Application Emoji Registry
//
// Custom art for cards and roulette pockets lives on the bot itself rather than in a
// guild: application emojis do not consume a server's emoji slots, are usable in every
// server the bot is in, and allow up to 2000 (this set uses 91).
//
// IDs only exist once scripts/uploadEmoji.ts has run, so every lookup takes a plain
// text fallback. A bot booted without the upload renders exactly what it renders today
// and stays fully playable - the art is an upgrade, never a dependency.

import type { Client } from 'discord.js';
import type { Rank, Suit } from '../discordCommands/blackjack/blackjackUtils.js';

// ============ CANONICAL NAMES ============

/** Suit letter used in emoji names; '♠' -> 'S' */
const SUIT_LETTER: Readonly<Record<Suit, string>> = {
  '♠': 'S',
  '♥': 'H',
  '♦': 'D',
  '♣': 'C',
} as const;

/** Rank token used in emoji names; '10' -> 'T' so every name is a fixed width */
function rankToken(rank: Rank): string {
  return rank === '10' ? 'T' : rank;
}

/**
 * Emoji name for a playing card, e.g. ('A','♠') -> 'cAS'
 */
export function cardEmojiName(rank: Rank, suit: Suit): string {
  return `c${rankToken(rank)}${SUIT_LETTER[suit]}`;
}

/** Emoji name for the face-down hole card */
export const CARD_BACK_NAME = 'cback';

/**
 * Emoji name for a roulette pocket, e.g. '00' -> 'n00', '17' -> 'n17'
 */
export function pocketEmojiName(position: string): string {
  return `n${position}`;
}

// ============ RUNTIME CACHE ============

/** name -> '<:name:id>' mention string, populated on ready */
const mentions = new Map<string, string>();
let loaded = false;

export interface EmojiLoadResult {
  readonly loaded: number;
  readonly ok: boolean;
}

/**
 * Fetch the bot's application emojis once at startup and cache their mention strings.
 *
 * Never throws: a failure here must not stop the bot from booting, it only means
 * every lookup falls back to text.
 */
export async function loadApplicationEmojis(client: Client): Promise<EmojiLoadResult> {
  try {
    if (!client.application) {
      console.warn('[EMOJI] Client application unavailable; using text fallbacks');
      return { loaded: 0, ok: false };
    }

    const collection = await client.application.emojis.fetch();

    mentions.clear();
    for (const [, appEmoji] of collection) {
      if (appEmoji.name) {
        mentions.set(appEmoji.name, appEmoji.toString());
      }
    }
    loaded = true;

    console.log(`[EMOJI] Loaded ${mentions.size} application emojis`);
    return { loaded: mentions.size, ok: true };
  } catch (error: unknown) {
    console.error('[EMOJI] Failed to fetch application emojis; using text fallbacks:', error);
    return { loaded: 0, ok: false };
  }
}

/**
 * Resolve an emoji name to its mention, or return the fallback unchanged.
 *
 * @param name - canonical emoji name, e.g. 'cAS'
 * @param fallback - text to use when the emoji has not been uploaded
 */
export function emoji(name: string, fallback: string): string {
  return mentions.get(name) ?? fallback;
}

/**
 * Whether the registry has been populated. False means every call to emoji()
 * is returning its fallback.
 */
export function isLoaded(): boolean {
  return loaded && mentions.size > 0;
}

/**
 * Names the bot expects to exist. Used by the upload script to report gaps and by
 * tests to guard the naming scheme.
 */
export function expectedEmojiNames(ranks: readonly Rank[], suits: readonly Suit[]): string[] {
  const names: string[] = [CARD_BACK_NAME];

  for (const suit of suits) {
    for (const rank of ranks) {
      names.push(cardEmojiName(rank, suit));
    }
  }

  names.push(pocketEmojiName('0'), pocketEmojiName('00'));
  for (let n = 1; n <= 36; n++) {
    names.push(pocketEmojiName(String(n)));
  }

  return names;
}

/**
 * Test seam: populate the cache without a Discord client.
 */
export function __setEmojiForTesting(name: string, mention: string): void {
  mentions.set(name, mention);
  loaded = true;
}

/**
 * Test seam: drop everything so fallbacks apply again.
 */
export function __resetEmojiForTesting(): void {
  mentions.clear();
  loaded = false;
}
