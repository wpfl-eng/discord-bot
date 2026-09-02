import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { AskRequest } from '../../ask/askRunner.js';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  recordUsage: jest.fn(),
  recordToolException: jest.fn(),
}));

// The week comes from ESPN in production. Nothing here reaches the network,
// and the ESPN tools the wpfl server registers get no client to reach it with.
jest.unstable_mockModule('../../helpers/espnPeriod.js', () => ({
  getCurrentPeriod: jest.fn(async () => ({
    seasonId: 2026,
    scoringPeriodId: 7,
    matchupPeriodId: 7,
    source: 'espn',
  })),
  espnClientFromEnv: jest.fn(() => null),
}));

const { runAsk } = await import('../../ask/askRunner.js');
const { resetConcurrency, inFlight } = await import('../../ask/concurrency.js');
const { ASK } = await import('../../ask/askConfig.js');
const askDb = await import('../../ask/askDb.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRecordUsage = askDb.recordUsage as any;

type Message = Record<string, unknown>;

const REQUEST: AskRequest = {
  prompt: 'why did Jimmy get an A+?',
  userId: 'u1',
  threadId: 't1',
  member: { espnId: 4, owner: 'AJ Boorde', discordId: '120231673722830849' },
  sessionId: null,
};

const toolStart = (name: string): Message => ({
  type: 'stream_event',
  session_id: 's1',
  event: {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'tu1', name, input: {} },
  },
});

const delta = (d: Record<string, unknown>): Message => ({
  type: 'stream_event',
  session_id: 's1',
  event: { type: 'content_block_delta', index: 0, delta: d },
});

const assistant = (): Message => ({
  type: 'assistant',
  session_id: 's1',
  message: { id: 'm1', content: [] },
});

/** The tool's result, as the SDK delivers it: a user message carrying a tool_result block. */
const toolResult = (id: string, text: string, isError = false): Message => ({
  type: 'user',
  session_id: 's1',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }],
  },
});

const success = (over: Message = {}): Message => ({
  type: 'result',
  subtype: 'success',
  session_id: 's1',
  duration_ms: 42000,
  num_turns: 9,
  total_cost_usd: 0.1473,
  usage: {},
  modelUsage: { 'claude-opus-5': { inputTokens: 18000, outputTokens: 2400 } },
  // An empty `result` by default: most tests stream their text and expect it
  // back. A real success result carries the final answer, which the one test
  // that sets it asserts is preferred over the stream.
  result: '',
  is_error: false,
  ...over,
});

/** Collects everything the runner emits, so a test can assert on the ticker. */
function recorder(): { events: string[]; sink: Parameters<typeof runAsk>[1] } {
  const events: string[] = [];
  return {
    events,
    sink: {
      onToolCall: (name: string, id: string | null): void => {
        events.push(`tool:${name}:${id ?? '-'}`);
      },
      onToolInput: (fragment: string): void => {
        events.push(`input:${fragment}`);
      },
      onReasoning: (summary: string): void => {
        events.push(`think:${summary}`);
      },
      onText: (chunk: string): void => {
        events.push(`text:${chunk}`);
      },
      onToolSettled: (id: string | null, error?: string): void => {
        events.push(error === undefined ? `settled:${id ?? '-'}` : `settled:${id ?? '-'}:${error}`);
      },
      onQueued: (position: number): void => {
        events.push(`queued:${position}`);
      },
    },
  };
}

const stream =
  (messages: Message[], thrown?: Error) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (args: any) => {
    void args;
    return (async function* () {
      for (const message of messages) yield message as never;
      if (thrown !== undefined) throw thrown;
    })();
  };

describe('askRunner', () => {
  // The runner builds the subprocess environment before it can call query(),
  // and agentEnv() requires a Claude credential. The dev box has none, so the
  // suite supplies one -- nothing here reaches the network.
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecordUsage.mockResolvedValue(undefined);
    resetConcurrency();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('a missing credential fails the run visibly, and writes an uncounted ledger row', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const { sink } = recorder();

    const outcome = await runAsk(REQUEST, sink, stream([success()]));

    expect(outcome.text).toBe('');
    expect(outcome.subtype).toBe('error_during_execution');
    expect(outcome.error).toBeDefined();
    expect(outcome.counted).toBe(false);
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({ counted: false }));
    error.mockRestore();
  });

  /**
   * What a member is charged for (log Stage 14, decision 12). A row counts
   * against the caps when the run reached the model: a session id was seen
   * and the SDK reported no ops failure. A subprocess that never spawned, a
   * missing credential, an expired login or a rate limit is not the member's
   * consumption, and the token that runs this bot expires in a year.
   */
  describe('what counts against the caps', () => {
    test('a run that reached the model counts, even when it hits the budget', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([success({ subtype: 'error_max_budget_usd', is_error: true })])
      );

      expect(outcome.counted).toBe(true);
      expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({ counted: true }));
    });

    test('a run that never produced a session id does not count', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { sink } = recorder();

      const outcome = await runAsk(REQUEST, sink, stream([], new Error('spawn failed')));

      expect(outcome.counted).toBe(false);
      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ counted: false, error: expect.stringMatching(/spawn failed/) })
      );
      error.mockRestore();
    });

    test('an expired login is reported by name and does not count', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream(
          [
            { ...assistant(), error: 'authentication_failed' },
            success({ subtype: 'error_during_execution', is_error: true, num_turns: 0 }),
          ],
          new Error('auth')
        )
      );

      expect(outcome.counted).toBe(false);
      expect(outcome.opsFailure).toBe('authentication_failed');
      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ counted: false, error: 'authentication_failed' })
      );
      error.mockRestore();
    });

    test('every one of the nine ops-failure codes is uncounted', async () => {
      for (const code of [
        'authentication_failed',
        'oauth_org_not_allowed',
        'account_on_hold',
        'billing_error',
        'rate_limit',
        'overloaded',
        'invalid_request',
        'model_not_found',
        'server_error',
      ]) {
        const { sink } = recorder();
        const outcome = await runAsk(
          REQUEST,
          sink,
          stream([{ ...assistant(), error: code }, success({ num_turns: 0 })])
        );
        expect(outcome.counted).toBe(false);
        expect(outcome.opsFailure).toBe(code);
      }
    });

    test('an assistant error outside those nine still counts -- the model was reached', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([{ ...assistant(), error: 'max_output_tokens' }, success()])
      );

      expect(outcome.counted).toBe(true);
      expect(outcome.opsFailure).toBeNull();
    });

    /**
     * The SDK's typing is explicit: a `success` result with `is_error` set
     * carries the API error text in `result`. Taken as the answer, a member
     * read "API Error: 500" under the trace line and paid a cap slot for it.
     */
    test('a success result flagged is_error is an API error, not an answer', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([
          { ...assistant(), error: 'server_error' },
          success({ is_error: true, result: 'API Error: 500 {"type":"error"}' }),
        ])
      );

      expect(outcome.text).toBe('');
      expect(outcome.error).toMatch(/API Error: 500/);
      expect(outcome.opsFailure).toBe('server_error');
      expect(outcome.counted).toBe(false);
    });

    test('an is_error result with no known code publishes nothing and still counts', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([success({ is_error: true, result: 'API Error: 400 bad request' })])
      );

      expect(outcome.text).toBe('');
      expect(outcome.error).toMatch(/400/);
      expect(outcome.counted).toBe(true);
      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/400/) })
      );
    });

    test('the ledger row carries the answer message id, so feedback can join to it', async () => {
      const { sink } = recorder();

      await runAsk({ ...REQUEST, messageId: 'm42' }, sink, stream([success()]));

      expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm42' }));
    });
  });

  /**
   * `alwaysLoad` waits for the server to connect, capped at five seconds; a
   * server that missed it leaves the model with no league tools and, before
   * this, no log line saying so.
   */
  describe('the init message', () => {
    const init = (status: string): Message => ({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      mcp_servers: [{ name: 'wpfl', status }],
    });

    test('warns when the wpfl server is not connected', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { sink } = recorder();

      await runAsk(REQUEST, sink, stream([init('failed'), success()]));

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/wpfl.*failed/));
      warn.mockRestore();
    });

    test('says nothing when it is connected', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { sink } = recorder();

      await runAsk(REQUEST, sink, stream([init('connected'), success()]));

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('the message stream', () => {
    test('turns a scripted stream into ticker events in order', async () => {
      const { events, sink } = recorder();

      await runAsk(
        REQUEST,
        sink,
        stream([
          toolStart('Read'),
          delta({ type: 'input_json_delta', partial_json: '{"file_path":"INDEX.md"}' }),
          assistant(),
          toolResult('tu1', '# WPFL data index'),
          delta({ type: 'thinking_delta', thinking: 'comparing his WR spend' }),
          toolStart('mcp__wpfl__sql'),
          assistant(),
          toolResult('tu1', '[{"owner":"Jimmy Simpson"}]'),
          delta({ type: 'text_delta', text: 'Jimmy paid ' }),
          delta({ type: 'text_delta', text: '$54 for Drake London.' }),
          success(),
        ])
      );

      expect(events).toEqual([
        'tool:Read:tu1',
        'input:{"file_path":"INDEX.md"}',
        'settled:tu1',
        'think:comparing his WR spend',
        'tool:mcp__wpfl__sql:tu1',
        'settled:tu1',
        'text:Jimmy paid ',
        'text:$54 for Drake London.',
      ]);
    });

    /**
     * Measured live (log Stage 14): the SDK emits an assistant message per
     * content block, so the one carrying a tool_use arrives before the tool
     * runs. Settling on it showed ✓ on a SQL query for the whole twenty
     * seconds it executed. The result is a user message with a tool_result
     * block, matched by id.
     */
    test('settles a step on its tool result, not on the assistant message that issued it', async () => {
      const { events, sink } = recorder();

      await runAsk(
        REQUEST,
        sink,
        stream([toolStart('mcp__wpfl__sql'), assistant(), toolResult('tu1', 'rows'), success()])
      );

      expect(events).toEqual(['tool:mcp__wpfl__sql:tu1', 'settled:tu1']);
    });

    test('reports a tool error by its first line, which is what a denial reads as', async () => {
      const { events, sink } = recorder();

      await runAsk(
        REQUEST,
        sink,
        stream([
          toolStart('WebFetch'),
          toolResult('tu1', "I don't open links from hosts I don't know.\nSecond line.", true),
          success(),
        ])
      );

      expect(events).toEqual([
        'tool:WebFetch:tu1',
        "settled:tu1:I don't open links from hosts I don't know.",
      ]);
    });

    test('reads a tool result whose content is a list of text blocks', async () => {
      const { events, sink } = recorder();

      await runAsk(
        REQUEST,
        sink,
        stream([
          toolStart('mcp__wpfl__sql'),
          {
            type: 'user',
            session_id: 's1',
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tu1',
                  is_error: true,
                  content: [{ type: 'text', text: 'Parser Error: syntax error at end of input' }],
                },
              ],
            },
          },
          success(),
        ])
      );

      expect(events).toEqual([
        'tool:mcp__wpfl__sql:tu1',
        'settled:tu1:Parser Error: syntax error at end of input',
      ]);
    });

    /**
     * Measured live (log Stage 14): the model wrote "I'll start with INDEX.md
     * and the table list." before its first tool call, and the runner glued
     * that onto the answer. The SDK's result message carries the final text
     * on its own, so that is what is published on success; the accumulated
     * stream stays the live preview and the fallback for a run that ended
     * without one.
     */
    test('publishes the result text, not the narration before the tools', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([
          delta({ type: 'text_delta', text: "I'll start with INDEX.md." }),
          toolStart('Read'),
          toolResult('tu1', '# index'),
          delta({ type: 'text_delta', text: 'Jimmy paid $54.' }),
          success({ result: 'Jimmy paid $54.' }),
        ])
      );

      expect(outcome.text).toBe('Jimmy paid $54.');
    });

    test('falls back to the accumulated stream when the result carries no text', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([delta({ type: 'text_delta', text: 'as far as I got' }), success({ result: '' })])
      );

      expect(outcome.text).toBe('as far as I got');
    });

    test('keeps the stream on an error result, whose text is an error and not an answer', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([
          delta({ type: 'text_delta', text: 'as far as I got' }),
          success({
            subtype: 'error_max_budget_usd',
            is_error: true,
            result: 'Budget of $1.00 exceeded',
          }),
        ])
      );

      expect(outcome.text).toBe('as far as I got');
    });

    /**
     * Also measured live: summarised thinking arrives as fragments -- "I",
     * then " notice the WR filter…" -- and the ticker replaces its reasoning
     * line per delta, so a member saw "I". Deltas accumulate within one
     * thinking block and the buffer resets when the next block starts.
     */
    test('accumulates thinking within a block and resets at the next one', async () => {
      const { events, sink } = recorder();
      const thinkingStart = (): Message => ({
        type: 'stream_event',
        session_id: 's1',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      });

      await runAsk(
        REQUEST,
        sink,
        stream([
          thinkingStart(),
          delta({ type: 'thinking_delta', thinking: 'I' }),
          delta({ type: 'thinking_delta', thinking: ' notice the WR filter' }),
          thinkingStart(),
          delta({ type: 'thinking_delta', thinking: 'Second thought' }),
          success(),
        ])
      );

      expect(events).toEqual(['think:I', 'think:I notice the WR filter', 'think:Second thought']);
    });

    test('returns the prose it accumulated from text deltas', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([
          delta({ type: 'text_delta', text: 'Jimmy paid ' }),
          delta({ type: 'text_delta', text: '$54.' }),
          success(),
        ])
      );

      expect(outcome.text).toBe('Jimmy paid $54.');
    });

    test('ignores message types it has no use for', async () => {
      const { events, sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([
          { type: 'system', subtype: 'status', session_id: 's1' },
          { type: 'user', session_id: 's1', message: { content: [] } },
          { type: 'stream_event', session_id: 's1', event: { type: 'message_start' } },
          delta({ type: 'text_delta', text: 'ok' }),
          success(),
        ])
      );

      expect(events).toEqual(['text:ok']);
      expect(outcome.text).toBe('ok');
    });
  });

  describe('the ledger', () => {
    test('reads cost from total_cost_usd and turns from num_turns', async () => {
      const { sink } = recorder();

      await runAsk(REQUEST, sink, stream([success()]));

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          threadId: 't1',
          prompt: 'why did Jimmy get an A+?',
          costUsd: 0.1473,
          numTurns: 9,
          subtype: 'success',
          durationMs: 42000,
        })
      );
    });

    test('names the model from modelUsage, which counts subagent tokens too', async () => {
      const { sink } = recorder();

      await runAsk(REQUEST, sink, stream([success()]));

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-opus-5' })
      );
    });

    test('writes the row on a budget stop as well as on success', async () => {
      const { sink } = recorder();

      await runAsk(
        REQUEST,
        sink,
        stream([
          delta({ type: 'text_delta', text: 'partial' }),
          success({ subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 1.01 }),
        ])
      );

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ subtype: 'error_max_budget_usd', costUsd: 1.01 })
      );
    });

    // query() is documented as throwing after yielding an error result. Without
    // a try/catch the handler dies and the ledger row promised by §6.4 is never
    // written -- which is exactly the run that most needs recording.
    test('a generator that throws after an error result still writes the ledger row', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream(
          [
            toolStart('Read'),
            assistant(),
            delta({ type: 'text_delta', text: 'as far as I got' }),
            success({ subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 1.01 }),
          ],
          new Error('budget exceeded')
        )
      );

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ subtype: 'error_max_budget_usd', costUsd: 1.01 })
      );
      expect(outcome.text).toBe('as far as I got');
      expect(outcome.subtype).toBe('error_max_budget_usd');
      error.mockRestore();
    });

    test('writes a row even when the generator throws before any result at all', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { sink } = recorder();

      const outcome = await runAsk(REQUEST, sink, stream([], new Error('subprocess died')));

      expect(mockRecordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ subtype: 'error_during_execution', costUsd: 0 })
      );
      expect(outcome.error).toMatch(/subprocess died/);
      error.mockRestore();
    });

    test('a failing ledger write does not lose the answer', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockRecordUsage.mockRejectedValue(new Error('postgres down'));
      const { sink } = recorder();

      const outcome = await runAsk(
        REQUEST,
        sink,
        stream([delta({ type: 'text_delta', text: 'the answer' }), success()])
      );

      expect(outcome.text).toBe('the answer');
      error.mockRestore();
    });
  });

  describe('the options it builds', () => {
    const capture = async (
      over: Partial<AskRequest> = {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<any> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let seen: any;
      const { sink } = recorder();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await runAsk({ ...REQUEST, ...over }, sink, ((args: any) => {
        seen = args;
        return (async function* () {
          yield success() as never;
        })();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
      return seen;
    };

    test('sends the question as the prompt', async () => {
      expect((await capture()).prompt).toBe('why did Jimmy get an A+?');
    });

    test('locks the tool surface down the way the design specifies', async () => {
      const options = (await capture()).options;

      expect(options.permissionMode).toBe('dontAsk');
      expect(options.settingSources).toEqual([]);
      expect(options.strictMcpConfig).toBe(true);
      expect(options.cwd).toBe(ASK.DATA_DIR);
      expect(options.tools).toEqual(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);
      expect(options.allowedTools).toContain('mcp__wpfl__*');
    });

    /**
     * The docs' form is `Read(//home/…)`: two slashes, then the path without
     * its own leading slash. DATA_DIR already starts with one, so the rule
     * used to render with three. The CLI's parser happened to tolerate that
     * (it drops one character after `//` and normalises), which is not a
     * contract anybody wrote down (log Stage 14, decision 3).
     */
    test('scopes Read to the data directory in the documented absolute-path form', async () => {
      const options = (await capture()).options;
      const rules: string[] = options.allowedTools as string[];

      expect(rules).toContain(`Read(//${ASK.DATA_DIR.replace(/^\/+/, '')}/**)`);
      for (const rule of rules) expect(rule).not.toContain('///');
    });

    /**
     * `dontAsk` is "deny if not pre-approved", so a tool exposed through
     * `tools` but absent from `allowedTools` is denied on every call. Grep and
     * Glob have to appear here by bare name: design §10.2 records that
     * `Grep(path)` and `Glob(path)` rules are accepted but never consulted, so
     * a path-qualified rule would pre-approve nothing. Confinement is the
     * PreToolUse path guard's job, and it holds regardless.
     */
    test('pre-approves every tool it exposes, or dontAsk denies the ones it missed', async () => {
      const options = (await capture()).options;

      for (const builtin of options.tools as string[]) {
        expect(
          (options.allowedTools as string[]).some(
            (rule: string): boolean => rule === builtin || rule.startsWith(`${builtin}(`)
          )
        ).toBe(true);
      }
    });

    test('pre-approves Grep and Glob by bare name, which is what the JSONL shred is for', async () => {
      const options = (await capture()).options;

      expect(options.allowedTools).toContain('Grep');
      expect(options.allowedTools).toContain('Glob');
    });

    test('asks for partial messages, without which there is no ticker', async () => {
      expect((await capture()).options.includePartialMessages).toBe(true);
    });

    test('carries the model, the budget and the session retention', async () => {
      const options = (await capture()).options;

      expect(options.model).toBe(ASK.MODEL);
      expect(options.maxBudgetUsd).toBe(ASK.MAX_BUDGET_USD);
      expect(options.settings.cleanupPeriodDays).toBe(ASK.SESSION_RETENTION_DAYS);
    });

    test('hands the subprocess a minimal environment, not process.env', async () => {
      process.env.DISCORD_TOKEN = 'discord-secret';
      process.env.POSTGRES_URL = 'postgres://secret';

      const env = (await capture()).options.env;

      expect(env).not.toHaveProperty('DISCORD_TOKEN');
      expect(env).not.toHaveProperty('POSTGRES_URL');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    });

    test('registers the guards and the wpfl server', async () => {
      const options = (await capture()).options;

      expect(options.hooks.PreToolUse).toHaveLength(2);
      expect(options.mcpServers.wpfl).toBeDefined();
    });

    test('resumes only when there is a session to resume', async () => {
      expect((await capture()).options.resume).toBeUndefined();
      expect((await capture({ sessionId: 'prev' })).options.resume).toBe('prev');
    });

    test('splits the system prompt at the cache boundary', async () => {
      const prompt = (await capture()).options.systemPrompt;

      expect(Array.isArray(prompt)).toBe(true);
      expect(prompt).toHaveLength(3);
    });

    test('tells the agent the week ESPN reports, resolved once per run', async () => {
      const prompt = (await capture()).options.systemPrompt as string[];

      expect(prompt[2]).toMatch(/week 7\b/i);
      expect(prompt[2]).toContain('2026 season');
      expect(prompt[2]).toMatch(/from ESPN/i);
    });
  });

  describe('the runtime guards', () => {
    test('reports the queue position when it has to wait', async () => {
      const held = [];
      const { requestSlot } = await import('../../ask/concurrency.js');
      for (let i = 0; i < ASK.MAX_CONCURRENT_QUERIES; i += 1) held.push(await requestSlot().slot);

      const { events, sink } = recorder();
      const running = runAsk(REQUEST, sink, stream([success()]));
      await new Promise((r) => setImmediate(r));

      expect(events).toContain('queued:1');

      held[0].release();
      await running;
    });

    test('releases its slot whether it succeeded or threw', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { sink } = recorder();

      await runAsk(REQUEST, sink, stream([success()]));
      expect(inFlight()).toBe(0);

      await runAsk(REQUEST, sink, stream([], new Error('died')));
      expect(inFlight()).toBe(0);
      error.mockRestore();
    });

    test('returns the session id so the thread can be continued', async () => {
      const { sink } = recorder();

      const outcome = await runAsk(REQUEST, sink, stream([success()]));

      expect(outcome.sessionId).toBe('s1');
    });
  });
});
