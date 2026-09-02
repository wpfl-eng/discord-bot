import { describe, test, expect } from '@jest/globals';
import {
  blackjackHeroSvg,
  crapsHeroSvg,
  heroAvailable,
  renderHero,
  rouletteHeroSvg,
} from '../../casino/casinoHero.js';

describe('hero SVG builders', () => {
  test('roulette names the pocket and its colour', () => {
    const svg = rouletteHeroSvg('17', 'black', '12K wagered');
    expect(svg).toContain('<svg');
    expect(svg).toContain('>17<');
    expect(svg).toContain('BLACK');
  });

  test('the double-zero pocket fits without overflowing its tile', () => {
    // '00' is the only two-character pocket and gets a smaller type size for it.
    expect(rouletteHeroSvg('00', 'green', '')).toContain('font-size="130"');
    expect(rouletteHeroSvg('7', 'red', '')).toContain('font-size="160"');
  });

  test('craps draws both dice and their total', () => {
    const svg = crapsHeroSvg(3, 4, 'SEVEN OUT!');
    expect(svg).toContain('>7<');
    expect(svg).toContain('SEVEN OUT!');
  });

  test.each([1, 2, 3, 4, 5, 6])('a die showing %i draws that many pips', (value: number) => {
    const svg = crapsHeroSvg(value, 1, '');
    // Both dice are drawn, and the second always shows one pip.
    const pips = (svg.match(/<circle/g) ?? []).length;
    expect(pips).toBe(value + 1);
  });

  test('blackjack names the dealer total and the headline', () => {
    const svg = blackjackHeroSvg('BUST', 'DEALER BUSTS', '4 seats · table +12K');
    expect(svg).toContain('BUST');
    expect(svg).toContain('DEALER BUSTS');
  });

  // Captions come from usernames and bet labels, so they must not be able to break the
  // SVG or inject markup into it.
  test('captions are XML-escaped', () => {
    const svg = rouletteHeroSvg('7', 'red', '<script>&"bad"');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<script>');
  });
});

describe('rendering', () => {
  test('produces an attachment and a gallery that points at it', async () => {
    const hero = await renderHero(rouletteHeroSvg('17', 'black', 'test'), 'Roulette 17 black');

    // sharp ships native binaries and may not load everywhere. When it does not, the
    // contract is a null return and a text-only frame - never a throw.
    if (!hero) {
      expect(heroAvailable()).toBe(false);
      return;
    }

    expect(hero.file.name).toBe('hero.png');
    const gallery = hero.gallery.toJSON() as { items: { media: { url: string } }[] };
    expect(gallery.items[0].media.url).toBe('attachment://hero.png');
  });

  test('malformed SVG degrades to null rather than throwing', async () => {
    await expect(renderHero('not an svg at all', 'broken')).resolves.toBeNull();
  });
});
