import { describe, test, expect, jest } from '@jest/globals';
import {
  createTicker,
  createThrottledEditor,
  splitForDiscord,
  type Ticker,
} from '../../ask/ticker.js';
import { ASK } from '../../ask/askConfig.js';

describe('ticker', () => {
  describe('what it shows while the agent works', () => {
    test('lists each tool call, and marks the finished ones', () => {
      const ticker: Ticker = createTicker();

      ticker.onToolCall('Read');
      ticker.onToolInput('{"file_path":"INDEX.md"}');
      ticker.onToolSettled();
      ticker.onToolCall('Read');
      ticker.onToolInput('{"file_path":"teams/aj-boorde.json"}');

      const rendered: string = ticker.render();

      expect(rendered).toContain('INDEX.md');
      expect(rendered).toContain('teams/aj-boorde.json');
      // The settled one and the in-flight one must look different.
      const lines: string[] = rendered
        .split('\n')
        .filter((l) => l.includes('.json') || l.includes('.md'));
      expect(lines[0]).not.toBe(lines[1]);
    });

    test('accumulates tool input across fragments before reading it', () => {
      const ticker: Ticker = createTicker();

      ticker.onToolCall('mcp__wpfl__sql');
      ticker.onToolInput('{"query":"SELECT owner');
      ticker.onToolInput(' FROM teams"}');

      expect(ticker.render()).toContain('SELECT owner FROM teams');
    });

    test('names the tool in a form a league member can read', () => {
      const ticker: Ticker = createTicker();

      ticker.onToolCall('mcp__wpfl__expected_wins');
      ticker.onToolInput('{"season":2024}');

      // Not "mcp__wpfl__expected_wins".
      expect(ticker.render()).toContain('expected_wins');
      expect(ticker.render()).not.toContain('mcp__wpfl__');
    });

    test('shows a tool call whose input never parsed, rather than dropping it', () => {
      const ticker: Ticker = createTicker();

      ticker.onToolCall('WebSearch');
      ticker.onToolInput('{"query":"Bijan Rob');

      expect(ticker.render()).toContain('WebSearch');
    });

    // Tool lines alone leave visible dead air across long thinking stretches,
    // which is exactly the stretch the ticker exists to cover.
    test('shows the latest reasoning summary on its own line', () => {
      const ticker: Ticker = createTicker();

      ticker.onToolCall('Read');
      ticker.onReasoning('comparing his WR spend against the ten-year curve');

      expect(ticker.render()).toContain('comparing his WR spend');
    });

    test('replaces the reasoning line rather than stacking summaries', () => {
      const ticker: Ticker = createTicker();

      ticker.onReasoning('first thought');
      ticker.onReasoning('second thought');

      expect(ticker.render()).toContain('second thought');
      expect(ticker.render()).not.toContain('first thought');
    });

    test('shows the queue position, so a wait is not mistaken for a hang', () => {
      const ticker: Ticker = createTicker();

      ticker.onQueued(2);

      expect(ticker.render()).toMatch(/queue|waiting/i);
      expect(ticker.render()).toContain('2');
    });

    test('says something even before the first tool call', () => {
      expect(createTicker().render().trim().length).toBeGreaterThan(0);
    });
  });

  describe('when the prose starts', () => {
    test('collapses the tool list and shows the answer', () => {
      const ticker: Ticker = createTicker();

      ticker.onToolCall('Read');
      ticker.onToolInput('{"file_path":"INDEX.md"}');
      ticker.onToolSettled();
      ticker.onReasoning('thinking about it');
      ticker.onText('Jimmy paid $54 for Drake London.');

      const rendered: string = ticker.render();

      expect(rendered).toContain('Jimmy paid $54 for Drake London.');
      expect(rendered).not.toContain('thinking about it');
    });

    test('keeps a one-line trace of what it did', () => {
      const ticker: Ticker = createTicker();

      ticker.onToolCall('Read');
      ticker.onToolSettled();
      ticker.onToolCall('mcp__wpfl__sql');
      ticker.onToolSettled();
      ticker.onText('The answer.');

      expect(ticker.render()).toMatch(/2 (tool calls|steps)|Read.*sql/i);
    });

    test('reports the prose separately from the rendering', () => {
      const ticker: Ticker = createTicker();

      ticker.onText('part one. ');
      ticker.onText('part two.');

      expect(ticker.prose()).toBe('part one. part two.');
      expect(ticker.hasProse()).toBe(true);
    });
  });

  describe('the throttled editor', () => {
    test('sends the first update immediately', async () => {
      jest.useFakeTimers();
      try {
        const sent: string[] = [];
        const editor = createThrottledEditor(async (c: string) => {
          sent.push(c);
        });

        editor.update('one');
        await Promise.resolve();

        expect(sent).toEqual(['one']);
        await editor.flush();
      } finally {
        jest.useRealTimers();
      }
    });

    test('coalesces everything that arrives inside the throttle window', async () => {
      jest.useFakeTimers();
      try {
        const sent: string[] = [];
        const editor = createThrottledEditor(async (c: string) => {
          sent.push(c);
        });

        editor.update('one');
        await Promise.resolve();
        editor.update('two');
        editor.update('three');
        editor.update('four');
        await Promise.resolve();

        expect(sent).toEqual(['one']);

        jest.advanceTimersByTime(ASK.TICKER_EDIT_THROTTLE_MS);
        await Promise.resolve();
        await Promise.resolve();

        // Only the newest survived the window.
        expect(sent).toEqual(['one', 'four']);
      } finally {
        jest.useRealTimers();
      }
    });

    test('flush sends the final state even mid-window', async () => {
      jest.useFakeTimers();
      try {
        const sent: string[] = [];
        const editor = createThrottledEditor(async (c: string) => {
          sent.push(c);
        });

        editor.update('one');
        await Promise.resolve();
        editor.update('final');

        await editor.flush();

        expect(sent[sent.length - 1]).toBe('final');
      } finally {
        jest.useRealTimers();
      }
    });

    test('flush sends nothing when nothing changed since the last edit', async () => {
      jest.useFakeTimers();
      try {
        const sent: string[] = [];
        const editor = createThrottledEditor(async (c: string) => {
          sent.push(c);
        });

        editor.update('one');
        await Promise.resolve();
        await editor.flush();
        await editor.flush();

        expect(sent).toEqual(['one']);
      } finally {
        jest.useRealTimers();
      }
    });

    test('a failed edit does not stop later ones -- Discord rate limits happen', async () => {
      jest.useFakeTimers();
      try {
        const sent: string[] = [];
        let first = true;
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const editor = createThrottledEditor(async (c: string) => {
          if (first) {
            first = false;
            throw new Error('rate limited');
          }
          sent.push(c);
        });

        editor.update('one');
        await Promise.resolve();
        editor.update('two');
        await editor.flush();

        expect(sent).toEqual(['two']);
        error.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('splitForDiscord', () => {
    test('leaves a short message alone', () => {
      expect(splitForDiscord('short')).toEqual(['short']);
    });

    test('splits past the 2,000 character limit rather than truncating', () => {
      const long: string = 'x'.repeat(4500);

      const parts: string[] = splitForDiscord(long);

      expect(parts.length).toBeGreaterThan(1);
      expect(parts.join('')).toBe(long);
      for (const part of parts) expect(part.length).toBeLessThanOrEqual(2000);
    });

    test('prefers to break at a line ending', () => {
      const text: string = `${'a'.repeat(1500)}\n${'b'.repeat(1000)}`;

      const parts: string[] = splitForDiscord(text);

      expect(parts[0]).toBe('a'.repeat(1500));
      expect(parts[1]).toBe('b'.repeat(1000));
    });

    test('never emits an empty part', () => {
      for (const part of splitForDiscord(`${'a'.repeat(2000)}\n${'b'.repeat(2000)}`)) {
        expect(part.length).toBeGreaterThan(0);
      }
    });
  });
});
