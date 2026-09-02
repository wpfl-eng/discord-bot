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

    /**
     * Steps settle by tool_use id (log Stage 14, decision 6). Under parallel
     * tool calls the results come back in completion order, and on a resumed
     * session the stream may replay results for calls this ticker never saw.
     */
    describe('settling by id', () => {
      const line = (rendered: string, needle: string): string =>
        rendered.split('\n').find((l) => l.includes(needle)) ?? '';

      test('settles the step whose id matches, not the oldest one', () => {
        const ticker: Ticker = createTicker();
        ticker.onToolCall('Read', 'a');
        ticker.onToolInput('{"file_path":"first.json"}');
        ticker.onToolCall('Read', 'b');
        ticker.onToolInput('{"file_path":"second.json"}');

        ticker.onToolSettled('b');

        const rendered: string = ticker.render();
        expect(line(rendered, 'second.json')).toContain('✓');
        expect(line(rendered, 'first.json')).not.toContain('✓');
      });

      test('ignores an id it never issued, as a replayed history would carry', () => {
        const ticker: Ticker = createTicker();
        ticker.onToolCall('Read', 'a');
        ticker.onToolInput('{"file_path":"first.json"}');

        ticker.onToolSettled('stale-from-last-week');

        expect(line(ticker.render(), 'first.json')).not.toContain('✓');
      });

      test('settles the oldest unsettled step when no id is available', () => {
        const ticker: Ticker = createTicker();
        ticker.onToolCall('Read');
        ticker.onToolInput('{"file_path":"first.json"}');
        ticker.onToolCall('Read');
        ticker.onToolInput('{"file_path":"second.json"}');

        ticker.onToolSettled(null);

        const rendered: string = ticker.render();
        expect(line(rendered, 'first.json')).toContain('✓');
        expect(line(rendered, 'second.json')).not.toContain('✓');
      });

      test('shows a failed step with its reason, so a denial is legible', () => {
        const ticker: Ticker = createTicker();
        ticker.onToolCall('WebFetch', 'a');
        ticker.onToolInput('{"url":"https://example.com/x"}');

        ticker.onToolSettled('a', "I don't open links from hosts I don't know.");

        const rendered: string = ticker.render();
        expect(line(rendered, 'WebFetch')).toContain('✗');
        expect(line(rendered, 'WebFetch')).toContain("hosts I don't know");
        expect(line(rendered, 'WebFetch')).not.toContain('✓');
      });

      test('the collapsed trace marks the step that failed', () => {
        const ticker: Ticker = createTicker();
        ticker.onToolCall('mcp__wpfl__sql', 'a');
        ticker.onToolSettled('a', 'Parser Error');
        ticker.onToolCall('mcp__wpfl__sql', 'b');
        ticker.onToolSettled('b');
        ticker.onText('The answer.');

        expect(ticker.render()).toMatch(/sql ✗ → sql/);
      });
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

        editor.update(() => 'one');
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

        editor.update(() => 'one');
        await Promise.resolve();
        editor.update(() => 'two');
        editor.update(() => 'three');
        editor.update(() => 'four');
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

        editor.update(() => 'one');
        await Promise.resolve();
        editor.update(() => 'final');

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

        editor.update(() => 'one');
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

        editor.update(() => 'one');
        await Promise.resolve();
        editor.update(() => 'two');
        await editor.flush();

        expect(sent).toEqual(['two']);
        error.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('rendering is lazy', () => {
    test('does not render for every update, only for edits that go out', async () => {
      // The agent's stream emits on the order of 1,000-3,000 deltas per run and
      // the throttle sends at most ~40 edits. Rendering eagerly built the whole
      // ticker -- the accumulated answer included -- for every delta and threw
      // almost all of them away, which is O(n^2) in the length of the answer.
      jest.useFakeTimers();
      try {
        const editor = createThrottledEditor(async () => {});
        let rendered = 0;
        const render = (): string => {
          rendered += 1;
          return `state ${rendered}`;
        };

        for (let i = 0; i < 500; i += 1) editor.update(render);
        await Promise.resolve();

        // One for the edit that opened the window; the other 499 are coalesced.
        expect(rendered).toBe(1);

        await editor.flush();
        expect(rendered).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });

    test('notifies its owner after every sink event', () => {
      const ticker: Ticker = createTicker();
      let changes = 0;
      ticker.onChange(() => {
        changes += 1;
      });

      ticker.onQueued(1);
      ticker.onToolCall('mcp__wpfl__sql');
      ticker.onToolInput('{"query"');
      ticker.onToolSettled();
      ticker.onReasoning('thinking');
      ticker.onText('answer');

      expect(changes).toBe(6);
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
  /**
   * The ticker is pushed into message.edit() on every event. Discord rejects an
   * edit over 2,000 characters, so once a streamed answer passed that length
   * every remaining live edit threw and the member watched a frozen ticker
   * until the final post. splitForDiscord was only ever applied at the end.
   */
  describe('the Discord length ceiling', () => {
    /**
     * The cap lives on the editor, not the renderer: the editor is what pushes
     * a string into one Discord message, and Discord rejects an edit over the
     * limit. A capped render() and an uncapped renderFull() had the same type,
     * so nothing but a comment stopped publish() reaching for the capped one
     * and silently truncating a member's answer instead of continuing it.
     */
    const cappedBy = async (build: (t: Ticker) => void): Promise<string[]> => {
      jest.useFakeTimers();
      try {
        const sent: string[] = [];
        const editor = createThrottledEditor(async (content: string) => {
          sent.push(content);
        });
        const ticker: Ticker = createTicker();
        build(ticker);
        editor.update(() => ticker.render());
        await Promise.resolve();
        return sent;
      } finally {
        jest.useRealTimers();
      }
    };

    test('the editor caps a long answer before it reaches Discord', async () => {
      const sent: string[] = await cappedBy((t) => t.onText('x'.repeat(5000)));

      expect(sent).toHaveLength(1);
      expect(sent[0].length).toBeLessThanOrEqual(2000);
      expect(sent[0]).toMatch(/still writing/);
    });

    test('the editor caps a long working ticker too', async () => {
      const sent: string[] = await cappedBy((t) => {
        for (let i = 0; i < 400; i += 1) {
          t.onToolCall(`mcp__wpfl__tool_number_${i}`);
          t.onToolInput(JSON.stringify({ query: 'y'.repeat(50) }));
        }
      });

      expect(sent[0].length).toBeLessThanOrEqual(2000);
    });

    test('what it sends is the newest prose rather than the oldest', async () => {
      const sent: string[] = await cappedBy((t) => {
        t.onText('a'.repeat(3000));
        t.onText('THE-LATEST-WORDS');
      });

      expect(sent[0]).toContain('THE-LATEST-WORDS');
    });

    test('it says the view is partial rather than looking finished', async () => {
      const sent: string[] = await cappedBy((t) => t.onText('x'.repeat(5000)));

      expect(sent[0]).toMatch(/still writing|…/);
    });

    test('render() is uncapped, which is what the final post is built from', () => {
      const ticker: Ticker = createTicker();
      ticker.onText('x'.repeat(5000));

      expect(ticker.render().length).toBeGreaterThan(2000);
      expect(ticker.render()).not.toMatch(/still writing/);
      expect(splitForDiscord(ticker.render()).length).toBeGreaterThan(1);
    });

    test('prose() still returns everything, so the final post is complete', () => {
      const ticker: Ticker = createTicker();
      ticker.onText('z'.repeat(5000));

      expect(ticker.prose().length).toBe(5000);
    });

    test('a short answer is untouched', () => {
      const ticker: Ticker = createTicker();
      ticker.onToolCall('Read');
      ticker.onText('Jimmy paid $61 for Bijan.');

      expect(ticker.render()).toContain('Jimmy paid $61 for Bijan.');
      expect(ticker.render()).not.toMatch(/still writing/);
    });
  });
});
