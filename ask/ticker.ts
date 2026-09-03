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
import { truncate } from '../helpers/utils.js';
import { plural } from '../casino/casinoFormat.js';
import { logError } from '../errors/errorHandler.js';

const DISCORD_LIMIT = 2000;
const HEADER = '🤖 **CommishBot**';

export interface Ticker extends AskSink {
  /**
   * The whole ticker as it stands, uncapped, with whatever prose has streamed.
   *
   * Capping is the throttled editor's job, because the editor is what pushes a
   * string into a single Discord message.
   */
  render(): string;
  /**
   * The ticker with the answer the runner settled on in place of the streamed
   * prose. The stream includes what the model said before its first tool
   * call; the SDK's result does not, and that is what gets published. Same
   * shape as `render()`, so the trace line carries over.
   */
  renderFinal(prose: string): string;
  /** This message is waiting for earlier ones in its own thread to finish. */
  onWaiting(behind: number): void;
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
  /** The tool_use id; what a result is matched by. */
  readonly id: string;
  input: string;
  settled: boolean;
  /** The first line of the result when it came back as an error. */
  error: string | null;
}

export function createTicker(): Ticker {
  const steps: Step[] = [];
  let reasoning: string | null = null;
  let text = '';
  let queuedAt: number | null = null;
  let waitingBehind: number | null = null;
  let notify: () => void = (): void => {};

  const composeWith = (line: (steps: Step[]) => string, prose: string): string => {
    if (prose.trim() !== '') return `${line(steps)}\n\n${prose}`;
    return working(steps, reasoning, queuedAt, waitingBehind);
  };

  return {
    onToolCall(name: string, id: string): void {
      steps.push({ tool: readableName(name), id, input: '', settled: false, error: null });
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

    onToolSettled(id: string, error?: string): void {
      // By id: under parallel calls results arrive in completion order, and a
      // resumed session can replay results for calls this ticker never issued
      // -- those match nothing and are ignored.
      const step: Step | undefined = steps.find((s) => s.id === id && !s.settled);
      if (step === undefined) return;
      step.settled = true;
      step.error = error ?? null;
      notify();
    },

    onQueued(position: number): void {
      queuedAt = position;
      notify();
    },

    onWaiting(behind: number): void {
      waitingBehind = behind;
      notify();
    },

    render: (): string => composeWith(trace, text),

    // Grouped for the post that stays; the live line keeps its arrows,
    // because while a member is watching, the order is the progress.
    renderFinal: (prose: string): string => composeWith(groupedTrace, prose),

    onChange(handler: () => void): void {
      notify = handler;
    },
  };
}

/**
 * Discord rejects an edit over DISCORD_LIMIT characters. Unbounded, a streamed
 * answer past that length made every remaining live edit throw, and the member
 * watched a frozen ticker until the final post -- which is exactly when the
 * ticker matters most, because the answer is arriving.
 *
 * Applied by the throttled editor, not by the renderer. A capped render() and
 * an uncapped renderFull() had the same type, so nothing but a comment stopped
 * a caller reaching for the capped one to build the final answer and silently
 * truncating it. The cap belongs to whoever writes a single message.
 *
 * The tail is what is kept: prose streams forwards, so the newest words are the
 * ones worth showing.
 */
function capped(rendered: string): string {
  if (rendered.length <= DISCORD_LIMIT) return rendered;

  const marker = '\n\n_… still writing_';
  const room: number = DISCORD_LIMIT - marker.length;
  return `${rendered.slice(rendered.length - room)}${marker}`;
}

function working(
  steps: Step[],
  reasoning: string | null,
  queuedAt: number | null,
  waitingBehind: number | null
): string {
  // Its own thread first: a message behind another in the same thread has not
  // asked for a slot yet, so the global queue line would be wrong.
  if (waitingBehind !== null && steps.length === 0) {
    return waitingBehind === 1
      ? `${HEADER}\n> ⏳ waiting for the answer above to finish.`
      : `${HEADER}\n> ⏳ waiting for the ${waitingBehind} answers above to finish.`;
  }

  if (queuedAt !== null && steps.length === 0) {
    return `${HEADER}\n> ⏳ ${plural(queuedAt, 'question')} ahead in the queue.`;
  }

  if (steps.length === 0 && reasoning === null) return `${HEADER}\n> …thinking`;

  const lines: string[] = [HEADER];
  for (const step of steps) {
    lines.push(`> ${glyph(step)} ${describe(step)}`);
  }
  if (reasoning !== null && reasoning !== '') {
    lines.push(`> … _${truncate(reasoning, 160)}_`);
  }

  return lines.join('\n');
}

/** Once prose starts, the whole tool list becomes one line of provenance. */
function trace(steps: Step[]): string {
  if (steps.length === 0) return HEADER;
  const names: string = steps.map((s) => (s.error === null ? s.tool : `${s.tool} ✗`)).join(' → ');
  return `> _${plural(steps.length, 'tool call')}: ${truncate(names, 180)}_`;
}

/**
 * The same line grouped by tool, first-seen order, for the final post: "Read
 * → sql → sql → sql → sql → sql → sql → sql → sql" was a third of a line
 * saying "nine calls, mostly sql". A tool called once is named bare; the
 * failure count rides on its group.
 */
function groupedTrace(steps: Step[]): string {
  if (steps.length === 0) return HEADER;

  const groups = new Map<string, { calls: number; failed: number }>();
  for (const step of steps) {
    const group = groups.get(step.tool) ?? { calls: 0, failed: 0 };
    group.calls += 1;
    if (step.error !== null) group.failed += 1;
    groups.set(step.tool, group);
  }
  const names: string = [...groups]
    .map(
      ([tool, { calls, failed }]): string =>
        `${calls > 1 ? `${calls} ` : ''}${tool}${failed > 0 ? ` (${failed} ✗)` : ''}`
    )
    .join(', ');
  return `> _${plural(steps.length, 'tool call')}: ${truncate(names, 180)}_`;
}

function glyph(step: Step): string {
  if (!step.settled) return '▸';
  return step.error === null ? '✓' : '✗';
}

function describe(step: Step): string {
  const argument: string | null = firstArgument(step.input);
  const call: string = argument === null ? step.tool : `${step.tool} ${truncate(argument, 90)}`;
  // A failed step carries its reason: a hook denial was written to be read,
  // and a parser error explains the retry that follows it.
  return step.error === null ? call : `${call} — ${truncate(step.error, 80)}`;
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

export interface ThrottledEditor {
  /**
   * @param render called only if an edit is actually about to go out.
   */
  update(render: () => string): void;
  /**
   * Stop editing: drop whatever is pending and wait for the edit in flight.
   *
   * Nothing pending is sent. The final post replaces this message within the
   * same second, and the edit budget is tightest exactly then; waiting for the
   * in-flight edit is what keeps that post from being overtaken by a stale one.
   */
  settle(): Promise<void>;
}

/**
 * Edits are coalesced to one per throttle window -- whatever arrived in
 * between is dropped, since only the newest state matters. The window is a
 * coalescing budget, not a rate limit: Discord publishes no per-route figure
 * and says not to hard-code one, and discord.js already sleeps and retries on
 * a 429. What the window buys is fewer edits in flight when the final post has
 * to land, and a ticker that reads as motion rather than flicker.
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
    inFlight = edit(capped(content)).catch((error: unknown) => {
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

    async settle(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      await inFlight;
    },
  };
}

/** Discord caps a message at 2,000 characters. Continue rather than truncate. */
/**
 * Discord renders no markdown tables: a pipe table reaches the channel as
 * raw pipes, which is how a 14-row ranking arrived in front of the league.
 * The prompt bans them; this is the net under the prompt. A run of two or
 * more pipe rows outside a code fence is wrapped in one, so it at least
 * lines up. Nothing else in the text is touched, and the ledger has the raw
 * answer either way.
 */
export function wrapPipeTables(text: string): string {
  const lines: string[] = text.split('\n');
  const out: string[] = [];
  let fenced = false;

  for (let i = 0; i < lines.length; ) {
    const line: string = lines[i];
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      out.push(line);
      i += 1;
      continue;
    }
    if (!fenced && isPipeRow(line)) {
      let end: number = i;
      while (end < lines.length && isPipeRow(lines[end])) end += 1;
      if (end - i >= 2) {
        out.push('```', ...lines.slice(i, end), '```');
        i = end;
        continue;
      }
    }
    out.push(line);
    i += 1;
  }
  return out.join('\n');
}

/** A markdown table row: pipes at both ends. A lone `|` in prose is not one. */
function isPipeRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

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
