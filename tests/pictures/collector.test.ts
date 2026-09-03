import { describe, test, expect } from '@jest/globals';
import {
  createCollector,
  tokenFor,
  hideTokens,
  resolvePictures,
  UNAVAILABLE_LINE,
  type Picture,
  type PictureCollector,
} from '../../pictures/collector.js';
import { ASK } from '../../ask/askConfig.js';

function picture(collector: PictureCollector, title: string = 'A chart'): Picture {
  return collector.add({ kind: 'bar', title, alt: `${title}, 3 rows`, png: Buffer.from('png') });
}

describe('collector', () => {
  test('numbers pictures in the order they are added and remembers who is asking', () => {
    const collector = createCollector('AJ Boorde');
    const first = picture(collector, 'first');
    const second = picture(collector, 'second');

    expect(collector.owner).toBe('AJ Boorde');
    expect(collector.pictures.map((p: Picture): string => p.title)).toEqual(['first', 'second']);
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[a-f0-9]{8}$/);
  });

  test('is full at the per-answer ceiling', () => {
    const collector = createCollector('AJ Boorde');
    for (let i = 0; i < ASK.PICTURES.PER_ANSWER; i += 1) {
      expect(collector.full).toBe(false);
      picture(collector);
    }
    expect(collector.full).toBe(true);
  });

  test('two collectors never share ids', () => {
    const a = picture(createCollector('AJ Boorde'));
    const b = picture(createCollector('Todd Ellis'));
    expect(a.id).not.toBe(b.id);
  });
});

describe('tokens', () => {
  test('the token is what the tool tells the model to write', () => {
    expect(tokenFor('0123abcd')).toBe('[[picture:0123abcd]]');
  });

  test('the live ticker hides token lines while the model is still writing', () => {
    const text = `**Bold line.**\n- a bullet\n${tokenFor('0123abcd')}\n_footer_`;
    expect(hideTokens(text)).toBe('**Bold line.**\n- a bullet\n_footer_');
  });
});

describe('resolvePictures', () => {
  const collector = createCollector('AJ Boorde');
  const chart = picture(collector, 'chart');
  const table = picture(collector, 'table');

  test('swaps each token for its picture, in the order the tokens appear', () => {
    const text = `**Answer.**\n- one\n${tokenFor(table.id)}\n${tokenFor(chart.id)}\n_footer_`;
    const resolved = resolvePictures(text, collector.pictures);

    expect(resolved.pictures.map((p: Picture): string => p.title)).toEqual(['table', 'chart']);
    expect(resolved.text).toBe('**Answer.**\n- one\n_footer_');
    expect(resolved.unresolved).toEqual([]);
  });

  test('a token that matches nothing becomes a visible line, and is reported', () => {
    const text = `**Answer.**\n${tokenFor('deadbeef')}\n_footer_`;
    const resolved = resolvePictures(text, collector.pictures);

    expect(resolved.pictures).toEqual([]);
    expect(resolved.text).toBe(`**Answer.**\n${UNAVAILABLE_LINE}\n_footer_`);
    expect(resolved.unresolved).toEqual(['deadbeef']);
  });

  test('a picture referenced twice attaches once', () => {
    const text = `${tokenFor(chart.id)}\n${tokenFor(chart.id)}`;
    const resolved = resolvePictures(text, collector.pictures);

    expect(resolved.pictures).toHaveLength(1);
    expect(resolved.text).toBe('');
  });

  test('a token inside a sentence is removed without eating the sentence', () => {
    const text = `See ${tokenFor(chart.id)} below.`;
    const resolved = resolvePictures(text, collector.pictures);

    expect(resolved.text).toBe('See below.');
    expect(resolved.pictures).toHaveLength(1);
  });

  test('a picture the model never referenced is not attached', () => {
    const resolved = resolvePictures('**Answer with no picture.**', collector.pictures);
    expect(resolved.pictures).toEqual([]);
  });

  test('never leaves three blank lines where a token was', () => {
    const text = `a\n\n${tokenFor(chart.id)}\n\nb`;
    expect(resolvePictures(text, collector.pictures).text).toBe('a\n\nb');
  });
});
