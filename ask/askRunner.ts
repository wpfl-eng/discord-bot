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
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { ASK, FILE_TOOLS } from './askConfig.js';
import { agentEnv } from './askAuth.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { createHooks, toolResultText } from './hooks.js';
import { requestSlot, startDeadline, type Slot } from './concurrency.js';
import { recordUsage } from './askDb.js';
import { errorMessage, logError } from '../errors/errorHandler.js';
import { wpflServer, WPFL_SERVER } from '../wpfl/mcpServer.js';
import { liveShred } from '../wpfl/liveShred.js';
import { readAsOf } from '../wpfl/layout.js';
import { getCurrentPeriod, type NFLPeriod } from '../helpers/espnPeriod.js';
import type { Release } from './generations.js';
import type { WpflMember } from '../constants/wpflMembers.js';

export interface AskRequest {
  readonly prompt: string;
  readonly userId: string;
  /** The channel or thread the conversation lives in; the ask_sessions key. */
  readonly threadId: string;
  /** The league member asking, or null for a Discord user with no mapping. */
  readonly member: WpflMember | null;
  /** The SDK session to resume when continuing a thread; null for a fresh one. */
  readonly sessionId: string | null;
  /** The Discord message the answer lands in, so the ledger row can be joined to feedback. */
  readonly messageId?: string;
}

/**
 * SDK-reported failures that are not the member's consumption: the run never
 * got an answer from the model, and nothing the member did caused it. A run
 * that ends in one of these is written to the ledger and not counted against
 * anyone's cap. The token this bot runs on expires in a year, which makes the
 * first of these a certainty rather than an edge case.
 *
 * A tuple, so `OpsFailure` is derived from it: the command keeps one
 * member-facing line per code, and the compiler holds it to exactly these.
 */
export const OPS_FAILURE_CODES = [
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'billing_error',
  'rate_limit',
  'overloaded',
] as const satisfies readonly SDKAssistantMessageError[];

export type OpsFailure = (typeof OPS_FAILURE_CODES)[number];

const OPS_FAILURES: ReadonlySet<SDKAssistantMessageError> = new Set(OPS_FAILURE_CODES);

function isOpsFailure(code: SDKAssistantMessageError): code is OpsFailure {
  return OPS_FAILURES.has(code);
}

/** Everything the runner emits while it works. The ticker renders these. */
export interface AskSink {
  /** @param id the tool_use id, so the result can be matched to the call. */
  onToolCall(name: string, id: string): void;
  onToolInput(fragment: string): void;
  onReasoning(summary: string): void;
  onText(chunk: string): void;
  /**
   * A tool result arrived. Matched by id; `error` is the first line of the
   * result when it came back as an error, which is what a hook denial reads
   * as, and undefined otherwise.
   */
  onToolSettled(id: string, error?: string): void;
  onQueued(position: number): void;
}

export interface AskOutcome {
  /**
   * The answer to publish: the SDK result's final turn when the run succeeded
   * with one, else whatever text streamed. The stream includes what the model
   * said before its first tool call -- "I'll start with INDEX.md" -- which the
   * live preview may show and the published answer must not (log Stage 14).
   */
  readonly text: string;
  readonly sessionId: string | null;
  readonly subtype: SDKResultMessage['subtype'];
  /** The model the SDK billed the run to, when a result arrived. */
  readonly model: string | null;
  readonly costUsd: number;
  readonly numTurns: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  /**
   * Whether the run counts against the caps: a session id was observed and no
   * ops failure was reported. A run the SDK never started is not consumption.
   */
  readonly counted: boolean;
  /** One of OPS_FAILURE_CODES when the SDK reported it, else null. */
  readonly opsFailure: OpsFailure | null;
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
  // Once per run, before the prompt is built: the prompt states the week and
  // the ESPN tools default to it, and both have to agree with /median, which
  // reads the same helper. Cached bot-wide for fifteen minutes; it falls back
  // to the calendar on its own and never throws. Before the slot, because the
  // ESPN fork has no request timeout: a hung lookup must not hold one of the
  // two slots, and the deadline below could not have ended it.
  const period: NFLPeriod = await getCurrentPeriod();

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
  const shred: Release = liveShred.enter();
  const started: number = Date.now();

  const state: StreamState = { text: '', thinking: '' };
  let sessionId: string | null = request.sessionId;
  // From the stream, not from the request: a resumed session id proves
  // nothing about whether this run ever reached the model.
  let sessionObserved = false;
  let opsFailure: OpsFailure | null = null;
  let terminal: TerminalResult | null = null;
  let failure: string | undefined;

  try {
    for await (const message of queryFn({
      prompt: request.prompt,
      options: buildOptions(request, deadline.controller, period),
    })) {
      const result: TerminalResult | null = consume(message, sink, state);
      if (message.session_id !== undefined) {
        sessionId = message.session_id;
        sessionObserved = true;
      }
      const reported: OpsFailure | null = opsFailureOf(message);
      if (reported !== null) opsFailure = reported;
      if (result !== null) terminal = result;
      if (deadline.expired()) break;
    }
  } catch (error: unknown) {
    failure = errorMessage(error);
    // logError, not console.error: it captures the stack, which is the only
    // thing that distinguishes an SDK abort from a bug in the consumption loop.
    logError('ask', 'query() threw', error);
  } finally {
    deadline.clear();
    shred();
    held.release();
  }

  const outcome: AskOutcome = {
    text: terminal !== null && terminal.result.trim() !== '' ? terminal.result : state.text,
    sessionId,
    subtype: terminal?.subtype ?? 'error_during_execution',
    model: terminal?.model ?? null,
    costUsd: terminal?.costUsd ?? 0,
    numTurns: terminal?.numTurns ?? 0,
    durationMs: terminal?.durationMs ?? Date.now() - started,
    timedOut: deadline.expired(),
    counted: sessionObserved && opsFailure === null,
    opsFailure,
    error: failure,
  };

  await writeLedger(request, outcome);
  return outcome;
}

/** The SDK reports an API-level failure as an `error` on an assistant message. */
function opsFailureOf(message: SDKMessage): OpsFailure | null {
  if (message.type !== 'assistant' || message.error === undefined) return null;
  return isOpsFailure(message.error) ? message.error : null;
}

interface TerminalResult {
  readonly subtype: SDKResultMessage['subtype'];
  readonly costUsd: number;
  readonly numTurns: number;
  readonly durationMs: number;
  readonly model: string | null;
  /** The final answer text on a success; empty on an error result, which carries none. */
  readonly result: string;
}

/** What the stream has said so far. Thinking is the current block only. */
interface StreamState {
  text: string;
  thinking: string;
}

type UserMessage = Extract<SDKMessage, { type: 'user' }>;

/** @returns the terminal result when this message was one, else null. */
function consume(message: SDKMessage, sink: AskSink, state: StreamState): TerminalResult | null {
  if (message.type === 'result') {
    return {
      subtype: message.subtype,
      // Never `usage`: the docs are explicit that it excludes subagent tokens.
      costUsd: message.total_cost_usd,
      numTurns: message.num_turns,
      durationMs: message.duration_ms,
      model: Object.keys(message.modelUsage ?? {})[0] ?? null,
      result: message.subtype === 'success' ? message.result : '',
    };
  }

  // A tool settles when its result arrives, which the SDK delivers as a user
  // message carrying tool_result blocks. Not on the assistant message: with
  // partial messages the SDK emits one per content block, so the one carrying
  // a tool_use lands before the tool has run (measured, log Stage 14).
  if (message.type === 'user') {
    for (const settled of toolResults(message.message)) {
      sink.onToolSettled(settled.id, settled.error);
    }
    return null;
  }

  if (message.type !== 'stream_event') return null;

  const { event } = message;
  if (event.type === 'content_block_start') {
    const block = event.content_block;
    if (block.type === 'tool_use') {
      sink.onToolCall(block.name, block.id);
    } else if (block.type === 'thinking') {
      state.thinking = '';
    }
    return null;
  }

  if (event.type === 'content_block_delta') {
    const { delta } = event;
    if (delta.type === 'input_json_delta') {
      sink.onToolInput(delta.partial_json);
    } else if (delta.type === 'thinking_delta') {
      // Summarised thinking streams as fragments; the ticker shows the whole
      // of the current block.
      state.thinking += delta.thinking;
      sink.onReasoning(state.thinking);
    } else if (delta.type === 'text_delta') {
      sink.onText(delta.text);
      state.text += delta.text;
    }
  }

  return null;
}

interface SettledTool {
  readonly id: string;
  readonly error?: string;
}

/** The tool_result blocks in a user message, with the first line of any error. */
function toolResults(message: UserMessage['message']): SettledTool[] {
  if (typeof message.content === 'string') return [];

  const settled: SettledTool[] = [];
  for (const block of message.content) {
    if (block.type !== 'tool_result') continue;
    settled.push(
      block.is_error === true
        ? { id: block.tool_use_id, error: firstLine(block.content) }
        : { id: block.tool_use_id }
    );
  }
  return settled;
}

/** The first line of a tool result, for the ticker's failed-step line. */
function firstLine(content: unknown): string {
  return toolResultText(content).split('\n')[0].trim();
}

function buildOptions(
  request: AskRequest,
  controller: AbortController,
  period: NFLPeriod
): Options {
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
    tools: [...FILE_TOOLS, ...ASK.WEB_TOOLS],
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
      ...FILE_TOOLS.filter((name: string): boolean => name !== 'Read'),
      ...ASK.WEB_TOOLS,
      `mcp__${WPFL_SERVER}__*`,
    ],

    systemPrompt: buildSystemPrompt({ member: request.member, period, asOf: readAsOf() }),
    mcpServers: { [WPFL_SERVER]: wpflServer },
    strictMcpConfig: true,

    includePartialMessages: true,
    maxBudgetUsd: ASK.MAX_BUDGET_USD,
    env: agentEnv(),
    settings: { cleanupPeriodDays: ASK.SESSION_RETENTION_DAYS },
    abortController: controller,

    hooks: createHooks({ threadId: request.threadId, userId: request.userId }),

    // Left absent rather than set to undefined: whether the SDK treats an
    // explicit `resume: undefined` as "no session" is not documented.
    ...(request.sessionId === null ? {} : { resume: request.sessionId }),
  };
  return options;
}

async function writeLedger(request: AskRequest, outcome: AskOutcome): Promise<void> {
  try {
    await recordUsage({
      userId: request.userId,
      threadId: request.threadId,
      prompt: request.prompt,
      model: outcome.model,
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
