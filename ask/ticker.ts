/**
 * The live ticker and the Discord edit throttle (design §6.3).
 *
 * Two phases in one message. While the agent works it shows what it is
 * actually doing — which file it opened, which query it ran — and, on its own
 * line, the latest reasoning summary. Tool-call lines alone leave visible dead
 * air across long thinking stretches, which is exactly the stretch this exists
 * to cover. When prose starts arriving the tool list collapses to one line and
 * the answer streams beneath it.
 *
 * The ticker implements AskSink directly, so the runner drives it with no
 * adapter in between.
 */

import type { AskSink } from './askRunner.js';
import { ASK } from './askConfig.js';
import { logError } from '../errors/errorHandler.js';

const DISCORD_LIMIT = 2000;

export interface Ticker extends AskSink {
  /** Capped to Discord's message limit; safe to push into an edit. */
  render(): string;
  /** Uncapped, for the final post, which splitForDiscord continues instead. */
  renderFull(): string;
  hasProse(): boolean;
  prose(): string;
  /**
   * Called after every sink event. Set once, by whoever owns the editor.
   *
   * A setter rather than a constructor argument because the first thing the
   * caller does with a ticker is render it into the message the editor then
   * edits -- so the editor cannot exist before the ticker does.
   */
  onChange(handler: () => void): void;
}

interface Step {
  readonly tool: string;
  input: string;
  settled: boolean;
}

export function createTicker(): Ticker {
  const steps: Step[] = [];
  let reasoning: string | null = null;
  let text = '';
  let queuedAt: number | null = null;
  let notify: () => void = (): void => {};

  const renderFull = (): string => {
    if (text.trim() !== '') return `${trace(steps)}\n\n${text}`;
    return working(steps, reasoning, queuedAt);
  };

  return {
    onToolCall(name: string): void {
      steps.push({ tool: readableName(name), input: '', settled: false });
      notify();
    },

    onToolInput(fragment: string): void {
      const step: Step | undefined = steps[steps.length - 1];
      if (step !== undefined) step.input += fragment;
      notify();
    },

    onReasoning(summary: string): void {
      // Replaced, not stacked: only the current thought is worth a line.
      reasoning = summary.trim();
      notify();
    },

    onText(chunk: string): void {
      text += chunk;
      notify();
    },

    onToolSettled(): void {
      const step: Step | undefined = [...steps].reverse().find((s) => !s.settled);
      if (step !== undefined) step.settled = true;
      notify();
    },

    onQueued(position: number): void {
      queuedAt = position;
      notify();
    },

    hasProse(): boolean {
      return text.trim() !== '';
    },

    prose(): string {
      return text;
    },

    render(): string {
      return capped(renderFull());
    },

    renderFull,

    onChange(handler: () => void): void {
      notify = handler;
    },
  };
}

/**
 * Discord rejects an edit over DISCORD_LIMIT characters, and render() is pushed
 * into message.edit() on every event. Unbounded, a streamed answer past that
 * length made every remaining live edit throw, and the member watched a frozen
 * ticker until the final post -- which is exactly when the ticker matters most,
 * because the answer is arriving.
 *
 * The tail is what is kept: prose streams forwards, so the newest words are the
 * ones worth showing. prose() still returns the whole answer, so the final
 * post is complete and correctly split.
 */
function capped(rendered: string): string {
  if (rendered.length <= DISCORD_LIMIT) return rendered;

  const marker = '\n\n_… still writing_';
  const room: number = DISCORD_LIMIT - marker.length;
  return `${rendered.slice(rendered.length - room)}${marker}`;
}

function working(steps: Step[], reasoning: string | null, queuedAt: number | null): string {
  const lines: string[] = ['🤖 **CommishBot**'];

  if (queuedAt !== null && steps.length === 0) {
    lines.push(`> ⏳ ${queuedAt} question${queuedAt === 1 ? '' : 's'} ahead in the queue.`);
    return lines.join('\n');
  }

  if (steps.length === 0 && reasoning === null) {
    lines.push('> …thinking');
    return lines.join('\n');
  }

  for (const step of steps) {
    lines.push(`> ${step.settled ? '✓' : '▸'} ${describe(step)}`);
  }
  if (reasoning !== null && reasoning !== '') {
    lines.push(`> … _${truncate(reasoning, 160)}_`);
  }

  return lines.join('\n');
}

/** Once prose starts, the whole tool list becomes one line of provenance. */
function trace(steps: Step[]): string {
  if (steps.length === 0) return '🤖 **CommishBot**';
  const names: string = steps.map((s) => s.tool).join(' → ');
  return `> _${steps.length} tool call${steps.length === 1 ? '' : 's'}: ${truncate(names, 180)}_`;
}

function describe(step: Step): string {
  const argument: string | null = firstArgument(step.input);
  return argument === null ? step.tool : `${step.tool} ${truncate(argument, 90)}`;
}

/**
 * Tool input arrives as JSON fragments and may never complete. Parse when it
 * does; otherwise show the tool alone rather than dropping the line.
 */
function firstArgument(input: string): string | null {
  if (input.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(input);
    if (parsed === null || typeof parsed !== 'object') return null;
    const value: unknown = Object.values(parsed as Record<string, unknown>)[0];
    return value === undefined ? null : String(value);
  } catch {
    return null;
  }
}

/** `mcp__wpfl__expected_wins` is not something to show a league member. */
function readableName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, '');
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export interface ThrottledEditor {
  /**
   * @param render called only if an edit is actually about to go out.
   */
  update(render: () => string): void;
  flush(): Promise<void>;
}

/**
 * Discord allows roughly 5 edits per 5 s per channel. Edits are coalesced to
 * one per throttle window — whatever arrived in between is dropped, since only
 * the newest state matters — and the final state is always flushed.
 *
 * `update` takes a thunk rather than a string because the caller is the agent's
 * event stream: a run emits on the order of 1,000-3,000 deltas, of which a
 * 60 s run sends at most ~40 edits. Rendering eagerly built the whole ticker,
 * including the entire accumulated answer, for every one of those deltas and
 * threw >95% of them away -- O(n^2) in the length of the answer, and the
 * answer is the part that grows.
 */
export function createThrottledEditor(
  edit: (content: string) => Promise<void>,
  intervalMs: number = ASK.TICKER_EDIT_THROTTLE_MS
): ThrottledEditor {
  let pending: (() => string) | null = null;
  let sent: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const send = (content: string): void => {
    sent = content;
    inFlight = edit(content).catch((error: unknown) => {
      // A rate limit or a deleted message must not stop the next edit.
      logError('ask', 'Ticker edit failed', error);
    });
  };

  /** @returns whether anything was actually sent. */
  const sendPending = (): boolean => {
    if (pending === null) return false;
    const render: () => string = pending;
    pending = null;
    const content: string = render();
    if (content === sent) return false;
    send(content);
    return true;
  };

  const openWindow = (): void => {
    timer = setTimeout(() => {
      timer = null;
      if (sendPending()) openWindow();
    }, intervalMs);
  };

  return {
    update(render: () => string): void {
      if (timer === null) {
        const content: string = render();
        if (content !== sent) send(content);
        openWindow();
        return;
      }
      pending = render;
    },

    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      sendPending();
      await inFlight;
    },
  };
}

/** Discord caps a message at 2,000 characters. Continue rather than truncate. */
export function splitForDiscord(text: string, limit: number = DISCORD_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let rest: string = text;

  while (rest.length > limit) {
    const window: string = rest.slice(0, limit);
    const breakAt: number = window.lastIndexOf('\n');
    const cut: number = breakAt > limit / 2 ? breakAt : limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(breakAt > limit / 2 ? cut + 1 : cut);
  }

  if (rest !== '') parts.push(rest);
  return parts;
}
