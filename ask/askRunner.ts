/**
 * Invoke query() and consume its message stream (design §5.1, §5.3).
 *
 * `queryFn` is injected so tests substitute a fake async generator; the default
 * is the SDK's own `query`.
 *
 * The consumption loop is wrapped in try/catch because **query() throws after
 * yielding an error result**. Without that, an `error_max_budget_usd` run takes
 * down the /ask handler and skips the ledger write — on precisely the run that
 * most needs recording. The ledger row is written from whatever terminal result
 * arrived before the throw, and from a synthesised one if none did.
 */

import {
  query,
  type Options,
  type SDKAssistantMessageError,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { ASK } from './askConfig.js';
import { agentEnv } from './askAuth.js';
import { buildSystemPrompt, readAsOf } from './systemPrompt.js';
import { createHooks } from './hooks.js';
import { requestSlot, startDeadline, type Slot } from './concurrency.js';
import { recordUsage } from './askDb.js';
import { logError } from '../errors/errorHandler.js';
import { wpflServer } from '../wpfl/mcpServer.js';
import { borrowShred } from '../wpfl/liveShred.js';
import { getCurrentPeriod, type NFLPeriod } from '../helpers/espnPeriod.js';
import type { Release } from './generations.js';

export interface AskRequest {
  readonly prompt: string;
  readonly userId: string;
  /** The channel or thread the conversation lives in; the ask_sessions key. */
  readonly threadId: string;
  readonly owner: string | null;
  readonly espnId: number | null;
  /** Present only when continuing an existing thread. */
  readonly sessionId?: string;
  /** The Discord message the answer lands in, so the ledger row can be joined to feedback. */
  readonly messageId?: string;
}

/**
 * SDK-reported failures that are not the member's consumption: the run never
 * got an answer from the model, and nothing the member did caused it. A run
 * that ends in one of these is written to the ledger and not counted against
 * anyone's cap. The token this bot runs on expires in a year, which makes the
 * first of these a certainty rather than an edge case.
 */
export const OPS_FAILURES: ReadonlySet<SDKAssistantMessageError> =
  new Set<SDKAssistantMessageError>([
    'authentication_failed',
    'oauth_org_not_allowed',
    'account_on_hold',
    'billing_error',
    'rate_limit',
    'overloaded',
  ]);

/** Everything the runner emits while it works. The ticker renders these. */
export interface AskSink {
  /** @param id the tool_use id, so the result can be matched to the call. */
  onToolCall(name: string, id?: string | null): void;
  onToolInput(fragment: string): void;
  onReasoning(summary: string): void;
  onText(chunk: string): void;
  /**
   * A tool result arrived. Matched by id; `error` is the first line of the
   * result when it came back as an error, which is what a hook denial reads
   * as, and undefined otherwise.
   */
  onToolSettled(id?: string | null, error?: string): void;
  onQueued(position: number): void;
}

export interface AskOutcome {
  readonly text: string;
  readonly sessionId: string | null;
  readonly subtype: string;
  readonly costUsd: number;
  readonly numTurns: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  /**
   * Whether the run counts against the caps: a session id was observed and no
   * ops failure was reported. A run the SDK never started is not consumption.
   */
  readonly counted: boolean;
  /** One of OPS_FAILURES when the SDK reported it, else null. */
  readonly opsFailure: SDKAssistantMessageError | null;
  readonly error?: string;
}

/**
 * Narrower than `typeof query` on purpose. The runner consumes a stream of
 * messages and uses none of the control methods on the SDK's `Query` object, so
 * the seam is declared as what it actually needs -- which is also what makes a
 * plain async generator a valid substitute in tests (design §5.3).
 */
export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export async function runAsk(
  request: AskRequest,
  sink: AskSink,
  queryFn: QueryFn = query
): Promise<AskOutcome> {
  const { queuePosition, slot } = requestSlot();
  if (queuePosition > 0) sink.onQueued(queuePosition);

  const held: Slot = await slot;
  const deadline = startDeadline();

  // Pin the shred for the whole run. The agent's cwd is the data directory and
  // it reads from it by relative path for as long as it is thinking, so a
  // reshred triggered by somebody else's question -- which retires this
  // directory -- must not delete it out from under this one. Borrowed after
  // the slot, not before: a query still queued should not hold a generation
  // open that it has not started reading.
  const shred: Release = borrowShred();
  const started: number = Date.now();

  // Once per run, before the prompt is built: the prompt states the week and
  // the ESPN tools default to it, and both have to agree with /median, which
  // reads the same helper. Cached bot-wide for fifteen minutes; it falls back
  // to the calendar on its own and never throws.
  const period: NFLPeriod = await getCurrentPeriod();

  let text = '';
  let thinking = '';
  let sessionId: string | null = request.sessionId ?? null;
  // From the stream, not from the request: a resumed session id proves
  // nothing about whether this run ever reached the model.
  let sessionObserved = false;
  let opsFailure: SDKAssistantMessageError | null = null;
  let terminal: TerminalResult | null = null;
  let failure: string | undefined;

  try {
    for await (const message of queryFn({
      prompt: request.prompt,
      options: buildOptions(request, deadline.signal, period),
    })) {
      const result: TerminalResult | null = consume(message, sink, {
        text: (chunk: string): void => {
          text += chunk;
        },
        // Summarised thinking streams as fragments; the ticker shows the whole
        // of the current block, so the runner keeps the block.
        thinkingStart: (): void => {
          thinking = '';
        },
        thinking: (fragment: string): string => {
          thinking += fragment;
          return thinking;
        },
      });
      if (message.session_id !== undefined) {
        sessionId = message.session_id;
        sessionObserved = true;
      }
      const reported: SDKAssistantMessageError | null = opsFailureOf(message);
      if (reported !== null) opsFailure = reported;
      if (result !== null) terminal = result;
      if (deadline.expired()) break;
    }
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error);
    // logError, not console.error: it captures the stack, which is the only
    // thing that distinguishes an SDK abort from a bug in the consumption loop.
    logError('ask', 'query() threw', error);
  } finally {
    deadline.clear();
    shred();
    held.release();
  }

  const outcome: AskOutcome = {
    // The SDK's result message carries the final answer on its own. The
    // accumulated stream includes whatever the model said before its first
    // tool call -- "I'll start with INDEX.md" -- which the live preview may
    // show and the published answer must not. Measured, log Stage 14.
    text:
      terminal?.subtype === 'success' &&
      terminal.result !== undefined &&
      terminal.result.trim() !== ''
        ? terminal.result
        : text,
    sessionId,
    subtype: terminal?.subtype ?? 'error_during_execution',
    costUsd: terminal?.costUsd ?? 0,
    numTurns: terminal?.numTurns ?? 0,
    durationMs: terminal?.durationMs ?? Date.now() - started,
    timedOut: deadline.expired(),
    counted: sessionObserved && opsFailure === null,
    opsFailure,
    ...(failure === undefined ? {} : { error: failure }),
  };

  await writeLedger(request, outcome, terminal?.model ?? null);
  return outcome;
}

/** The SDK reports an API-level failure as an `error` on an assistant message. */
function opsFailureOf(message: SDKMessage): SDKAssistantMessageError | null {
  if (message.type !== 'assistant' || message.error === undefined) return null;
  return OPS_FAILURES.has(message.error) ? message.error : null;
}

interface TerminalResult {
  readonly subtype: string;
  readonly costUsd: number;
  readonly numTurns: number;
  readonly durationMs: number;
  readonly model: string | null;
  /** The final answer text, when the result carried one. */
  readonly result?: string;
}

interface Accumulators {
  text(chunk: string): void;
  thinkingStart(): void;
  /** @returns the whole of the current thinking block so far. */
  thinking(fragment: string): string;
}

/** @returns the terminal result when this message was one, else null. */
function consume(message: SDKMessage, sink: AskSink, into: Accumulators): TerminalResult | null {
  if (message.type === 'result') {
    const result: unknown = (message as { result?: unknown }).result;
    return {
      subtype: message.subtype,
      // Never `usage`: the docs are explicit that it excludes subagent tokens.
      costUsd: message.total_cost_usd,
      numTurns: message.num_turns,
      durationMs: message.duration_ms,
      model: Object.keys(message.modelUsage ?? {})[0] ?? null,
      ...(typeof result === 'string' ? { result } : {}),
    };
  }

  // A tool settles when its result arrives, which the SDK delivers as a user
  // message carrying tool_result blocks. Not on the assistant message: with
  // partial messages the SDK emits one per content block, so the one carrying
  // a tool_use lands before the tool has run (measured, log Stage 14).
  if (message.type === 'user') {
    for (const result of toolResults(message.message)) {
      sink.onToolSettled(result.id, result.error);
    }
    return null;
  }

  if (message.type !== 'stream_event') return null;

  const event = message.event as {
    type?: string;
    content_block?: { type?: string; name?: string; id?: string };
    delta?: { type?: string; partial_json?: string; thinking?: string; text?: string };
  };

  if (event.type === 'content_block_start') {
    if (event.content_block?.type === 'tool_use') {
      sink.onToolCall(event.content_block.name ?? 'tool', event.content_block.id ?? null);
    } else if (event.content_block?.type === 'thinking') {
      into.thinkingStart();
    }
    return null;
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta;
    if (delta?.type === 'input_json_delta' && delta.partial_json !== undefined) {
      sink.onToolInput(delta.partial_json);
    } else if (delta?.type === 'thinking_delta' && delta.thinking !== undefined) {
      sink.onReasoning(into.thinking(delta.thinking));
    } else if (delta?.type === 'text_delta' && delta.text !== undefined) {
      sink.onText(delta.text);
      into.text(delta.text);
    }
  }

  return null;
}

interface SettledTool {
  readonly id: string | null;
  readonly error?: string;
}

/** The tool_result blocks in a user message, with the first line of any error. */
function toolResults(message: unknown): SettledTool[] {
  const content: unknown = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return [];

  const settled: SettledTool[] = [];
  for (const block of content as {
    type?: string;
    tool_use_id?: string;
    is_error?: boolean;
    content?: unknown;
  }[]) {
    if (block.type !== 'tool_result') continue;
    const id: string | null = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
    settled.push(block.is_error === true ? { id, error: firstLine(block.content) } : { id });
  }
  return settled;
}

/** A tool result's text is a string or a list of text blocks. */
function firstLine(content: unknown): string {
  const text: string =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? (content as { text?: string }[]).map((block) => block.text ?? '').join(' ')
        : '';
  return text.split('\n')[0].trim() || 'Tool returned an error.';
}

function buildOptions(request: AskRequest, signal: AbortSignal, period: NFLPeriod): Options {
  // Typed as Options rather than asserted into it. A blanket `as Options` on
  // the whole object would let a renamed or removed SDK field typecheck clean
  // forever, and this is the object where that matters most.
  const options: Options = {
    model: ASK.MODEL,
    effort: ASK.EFFORT,
    thinking: { type: 'adaptive', display: ASK.THINKING_DISPLAY },

    cwd: ASK.DATA_DIR,
    settingSources: [],
    permissionMode: 'dontAsk',
    // An availability allowlist, not a denylist: every unlisted built-in is
    // removed from Claude's context rather than merely denied at call time.
    tools: [...ASK.FILE_TOOLS, ...ASK.WEB_TOOLS],
    // `dontAsk` denies anything not pre-approved here, so every tool named in
    // `tools` above must also appear in this list or it is dead on arrival.
    // Derived from the same two lists rather than restated, so the two cannot
    // drift apart again.
    allowedTools: [
      // The `//` prefix anchors at the filesystem root; a single slash would
      // anchor at the session's working directory instead. The documented
      // form is `//home/…`, so DATA_DIR sheds its own leading slash first.
      `Read(//${ASK.DATA_DIR.replace(/^\/+/, '')}/**)`,
      // Bare, not path-qualified: `Grep(path)` and `Glob(path)` rules are
      // documented as accepted but never consulted (§10.2), so qualifying them
      // would pre-approve nothing and every grep would be denied -- which would
      // strand the whole reason the two big collections are shredded to JSONL.
      // The PreToolUse path guard is what confines them, and a hook deny holds
      // even in bypassPermissions.
      ...ASK.FILE_TOOLS.filter((name: string): boolean => name !== 'Read'),
      ...ASK.WEB_TOOLS,
      'mcp__wpfl__*',
    ],

    systemPrompt: buildSystemPrompt({
      owner: request.owner,
      espnId: request.espnId,
      period,
      asOf: readAsOf(),
    }),
    mcpServers: { wpfl: wpflServer },
    strictMcpConfig: true,

    includePartialMessages: true,
    maxBudgetUsd: ASK.MAX_BUDGET_USD,
    env: agentEnv(),
    settings: { cleanupPeriodDays: ASK.SESSION_RETENTION_DAYS },
    abortController: toController(signal),

    hooks: createHooks({ threadId: request.threadId, userId: request.userId }),

    ...(request.sessionId === undefined ? {} : { resume: request.sessionId }),
  };
  return options;
}

/** The SDK takes a controller; the deadline owns the signal. */
function toController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', () => controller.abort(), { once: true });
  return controller;
}

async function writeLedger(
  request: AskRequest,
  outcome: AskOutcome,
  model: string | null
): Promise<void> {
  try {
    await recordUsage({
      userId: request.userId,
      threadId: request.threadId,
      prompt: request.prompt,
      model,
      numTurns: outcome.numTurns,
      costUsd: outcome.costUsd,
      subtype: outcome.subtype,
      durationMs: outcome.durationMs,
      counted: outcome.counted,
      // The SDK's own code names the failure better than a thrown message.
      error: outcome.opsFailure ?? outcome.error ?? null,
      messageId: request.messageId ?? null,
    });
  } catch (error: unknown) {
    // The answer is already produced; losing the bookkeeping must not lose it.
    logError('ask', 'Could not write the usage ledger', error);
  }
}
