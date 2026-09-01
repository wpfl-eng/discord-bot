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

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ASK } from './askConfig.js';
import { agentEnv } from './askAuth.js';
import { buildSystemPrompt, readAsOf } from './systemPrompt.js';
import { createHooks } from './hooks.js';
import { requestSlot, startDeadline, type Slot } from './concurrency.js';
import { recordUsage } from './askDb.js';
import { wpflServer } from '../wpfl/mcpServer.js';

export interface AskRequest {
  readonly prompt: string;
  readonly userId: string;
  /** The channel or thread the conversation lives in; the ask_sessions key. */
  readonly threadId: string;
  readonly owner: string | null;
  readonly espnId: number | null;
  /** Present only when continuing an existing thread. */
  readonly sessionId?: string;
}

/** Everything the runner emits while it works. The ticker renders these. */
export interface AskSink {
  onToolCall(name: string): void;
  onToolInput(fragment: string): void;
  onReasoning(summary: string): void;
  onText(chunk: string): void;
  /** The tool call that was in flight has finished. */
  onToolSettled(): void;
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
  readonly error?: string;
}

/**
 * Narrower than `typeof query` on purpose. The runner consumes a stream of
 * messages and uses none of the control methods on the SDK's `Query` object, so
 * the seam is declared as what it actually needs -- which is also what makes a
 * plain async generator a valid substitute in tests (design §5.3).
 */
export type QueryFn = (params: {
  prompt: string;
  options: Options;
}) => AsyncIterable<SDKMessage>;

export async function runAsk(
  request: AskRequest,
  sink: AskSink,
  queryFn: QueryFn = query
): Promise<AskOutcome> {
  const { queuePosition, slot } = requestSlot();
  if (queuePosition > 0) sink.onQueued(queuePosition);

  const held: Slot = await slot;
  const deadline = startDeadline();
  const started: number = Date.now();

  let text = '';
  let sessionId: string | null = request.sessionId ?? null;
  let terminal: TerminalResult | null = null;
  let failure: string | undefined;

  try {
    for await (const message of queryFn({
      prompt: request.prompt,
      options: buildOptions(request, deadline.signal),
    })) {
      const result: TerminalResult | null = consume(message, sink, (chunk) => {
        text += chunk;
      });
      if (message.session_id !== undefined) sessionId = message.session_id;
      if (result !== null) terminal = result;
      if (deadline.expired()) break;
    }
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error);
    console.error('[ASK] query() threw:', failure);
  } finally {
    deadline.clear();
    held.release();
  }

  const outcome: AskOutcome = {
    text,
    sessionId,
    subtype: terminal?.subtype ?? 'error_during_execution',
    costUsd: terminal?.costUsd ?? 0,
    numTurns: terminal?.numTurns ?? 0,
    durationMs: terminal?.durationMs ?? Date.now() - started,
    timedOut: deadline.expired(),
    ...(failure === undefined ? {} : { error: failure }),
  };

  await writeLedger(request, outcome, terminal?.model ?? null);
  return outcome;
}

interface TerminalResult {
  readonly subtype: string;
  readonly costUsd: number;
  readonly numTurns: number;
  readonly durationMs: number;
  readonly model: string | null;
}

/** @returns the terminal result when this message was one, else null. */
function consume(message: SDKMessage, sink: AskSink, appendText: (chunk: string) => void): TerminalResult | null {
  if (message.type === 'result') {
    return {
      subtype: message.subtype,
      // Never `usage`: the docs are explicit that it excludes subagent tokens.
      costUsd: message.total_cost_usd,
      numTurns: message.num_turns,
      durationMs: message.duration_ms,
      model: Object.keys(message.modelUsage ?? {})[0] ?? null,
    };
  }

  if (message.type === 'assistant') {
    sink.onToolSettled();
    return null;
  }

  if (message.type !== 'stream_event') return null;

  const event = message.event as {
    type?: string;
    content_block?: { type?: string; name?: string };
    delta?: { type?: string; partial_json?: string; thinking?: string; text?: string };
  };

  if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    sink.onToolCall(event.content_block.name ?? 'tool');
    return null;
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta;
    if (delta?.type === 'input_json_delta' && delta.partial_json !== undefined) {
      sink.onToolInput(delta.partial_json);
    } else if (delta?.type === 'thinking_delta' && delta.thinking !== undefined) {
      sink.onReasoning(delta.thinking);
    } else if (delta?.type === 'text_delta' && delta.text !== undefined) {
      sink.onText(delta.text);
      appendText(delta.text);
    }
  }

  return null;
}

function buildOptions(request: AskRequest, signal: AbortSignal): Options {
  return {
    model: ASK.MODEL,
    effort: ASK.EFFORT,
    thinking: { type: 'adaptive', display: ASK.THINKING_DISPLAY },

    cwd: ASK.DATA_DIR,
    settingSources: [],
    permissionMode: 'dontAsk',
    // An availability allowlist, not a denylist: every unlisted built-in is
    // removed from Claude's context rather than merely denied at call time.
    tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    allowedTools: [
      // The `//` prefix anchors at the filesystem root. A single slash would
      // anchor at the session's working directory instead.
      `Read(//${ASK.DATA_DIR}/**)`,
      'WebSearch',
      'WebFetch',
      'mcp__wpfl__*',
    ],

    systemPrompt: buildSystemPrompt({
      owner: request.owner,
      espnId: request.espnId,
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
  } as Options;
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
    });
  } catch (error: unknown) {
    // The answer is already produced; losing the bookkeeping must not lose it.
    console.error('[ASK] Could not write the usage ledger:', error);
  }
}
