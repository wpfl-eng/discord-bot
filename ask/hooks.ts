/**
 * The PreToolUse guards and the PostToolUse audit (design §10.2–§10.4).
 *
 * The path guard is the *guarantee*, not the `Read(//DATA_DIR/**)` allow rule.
 * The permissions documentation describes Read rules as covering Grep and Glob
 * on a best-effort basis only, and says a `Grep(path)` or `Glob(path)` rule is
 * accepted but never consulted — while Grep returns file *contents*, which on
 * the bot host reaches ~/discord-bot/.env. Hooks run before every other
 * permission step and a hook deny holds even in bypassPermissions, so this is
 * the only mechanism that cannot be undone by a configuration mistake
 * elsewhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { ASK, FILE_TOOLS, type PathArgument } from './askConfig.js';
import { recordToolException } from './askDb.js';
import { logError } from '../errors/errorHandler.js';

export interface HookContext {
  readonly threadId: string | null;
  readonly userId: string | null;
}

/** No opinion: the call falls through to the ordinary permission rules. */
const PASS: HookJSONOutput = { continue: true };

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Confine Read, Grep and Glob to the data directory.
 *
 * Paths are resolved with realpath rather than normalised as strings, because a
 * symlink inside the data directory pointing out of it is textually inside.
 *
 * Glob's `pattern` is a path too. Measured live (log Stage 14): with no `path`,
 * the CLI's Glob honours an absolute pattern, and `/etc/host*` came straight
 * through a guard that only read `path` and `file_path`. So every path-like
 * argument the call carries is checked, and a call escapes if any one does.
 */
export function createPathGuard(
  context: HookContext,
  dataDir: string = ASK.DATA_DIR
): HookCallback {
  const root: string = realpath(dataDir);

  const inside = (requested: string): boolean => {
    // A home-relative or climbing path has no use inside a flat directory the
    // agent already knows the absolute path of; refused on sight rather than
    // resolved, so nothing depends on how a tool would expand it.
    if (requested.startsWith('~')) return false;
    if (requested.split(/[\\/]/).includes('..')) return false;

    const resolved: string = realpath(path.resolve(dataDir, requested));
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  };

  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return PASS;

    const requested: string[] | null = pathArguments(input.tool_name, input.tool_input);
    // A tool the table does not describe cannot be confined, so it is refused
    // rather than passed on the strength of an empty list.
    if (requested === null) {
      void record(context, input.tool_name, input.tool_input, 'path_guard', null);
      return deny(`I don't know where ${input.tool_name} reads from, so I can't allow it.`);
    }

    // Grep and Glob without a path search the working directory, which is the
    // data directory, so an empty list passes.
    for (const candidate of requested) {
      if (inside(candidate)) continue;
      void record(context, input.tool_name, input.tool_input, 'path_guard', null);
      return deny('I can only read the WPFL data directory.');
    }

    return PASS;
  };
}

/**
 * A host allowlist rather than a blanket refusal of user-pasted links. A member
 * pasting a beat-writer link and asking what to make of it is among the most
 * natural things anyone will do with this feature; denials are recorded so the
 * list grows from evidence about what people actually paste.
 */
export function createWebFetchGuard(context: HookContext): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return PASS;

    const url: unknown = (input.tool_input as { url?: unknown } | null)?.url;
    if (typeof url === 'string' && hostAllowed(url)) return PASS;

    void record(context, input.tool_name, input.tool_input, 'domain_guard', null);
    return deny(
      "I don't open links from hosts I don't know. Tell me what you want to know and I'll look it up."
    );
  };
}

function hostAllowed(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  // Suffix match on a label boundary: `fantasy.espn.com` matches `espn.com`,
  // while `espn.com.evil.io` and `notespn.com` do not.
  return ASK.WEBFETCH_ALLOWED_HOSTS.some(
    (allowed: string): boolean => host === allowed || host.endsWith(`.${allowed}`)
  );
}

/**
 * Records denials and failures only. A successful read of a file the agent was
 * allowed to read is not an event worth a Postgres round trip inside the agent
 * loop — the ticker already showed it to the whole thread, permanently.
 */
export function createAuditHook(context: HookContext): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name === 'PostToolUseFailure') {
      void record(context, input.tool_name, input.tool_input, null, input.error);
      return PASS;
    }

    if (input.hook_event_name === 'PostToolUse') {
      const response = input.tool_response as { isError?: boolean; content?: unknown } | null;
      if (response?.isError === true) {
        void record(
          context,
          input.tool_name,
          input.tool_input,
          null,
          toolResultText(response.content)
        );
      }
    }

    return PASS;
  };
}

export function createHooks(
  context: HookContext,
  dataDir: string = ASK.DATA_DIR
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const audit: HookCallback = createAuditHook(context);

  return {
    PreToolUse: [
      // Built from the same table the runner's allowlist and the guard read,
      // so a file tool added there is confined here without anyone remembering.
      { matcher: FILE_TOOLS.join('|'), hooks: [createPathGuard(context, dataDir)] },
      { matcher: 'WebFetch', hooks: [createWebFetchGuard(context)] },
    ],
    PostToolUse: [{ hooks: [audit] }],
    // PostToolUse does not fire for a tool that threw; this event carries the
    // error string directly.
    PostToolUseFailure: [{ hooks: [audit] }],
  };
}

/**
 * Every path-like argument a call carries, per ASK.PATH_ARGUMENTS. A glob
 * pattern is a path up to its first wildcard: `/etc/host*` searches `/etc`,
 * and `<data dir>/teams/*.json` searches inside. The static prefix is what is
 * checked, so an absolute pattern that stays inside still passes.
 *
 * @returns null for a tool the table does not describe.
 */
function pathArguments(toolName: string, toolInput: unknown): string[] | null {
  const spec: readonly PathArgument[] | undefined = ASK.PATH_ARGUMENTS[toolName];
  if (spec === undefined) return null;

  const args = toolInput as Record<string, unknown> | null;
  const found: string[] = [];
  for (const { key, prefix } of spec) {
    const value: unknown = args?.[key];
    if (typeof value !== 'string' || value === '') continue;
    found.push(prefix === true ? globPrefix(value) : value);
  }
  return found;
}

/** The part of a glob before its first wildcard; empty for `**\/*.json`. */
function globPrefix(pattern: string): string {
  const wildcard: number = pattern.search(/[*?[{]/);
  return wildcard === -1 ? pattern : pattern.slice(0, wildcard);
}

/** The deepest existing ancestor's real path, plus whatever does not exist yet. */
function realpath(target: string): string {
  let head: string = path.resolve(target);
  const tail: string[] = [];

  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail);
    } catch {
      const parent: string = path.dirname(head);
      if (parent === head) return path.resolve(target);
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

/**
 * Not awaited by its callers. The decision never depends on the write, and a
 * serverless round trip on every denied call -- each `sql` refusal the model
 * retries, say -- was paid inside the agent loop while a member watched the
 * ticker. Failures are caught here, so nothing is left to reject unobserved.
 */
async function record(
  context: HookContext,
  toolName: string,
  toolInput: unknown,
  deniedBy: string | null,
  error: string | null
): Promise<void> {
  try {
    await recordToolException({
      threadId: context.threadId,
      userId: context.userId,
      toolName,
      toolInput,
      deniedBy,
      error,
    });
  } catch (writeError: unknown) {
    // Never let bookkeeping kill an answer.
    logError('ask', 'Could not record a tool exception', writeError);
  }
}

/**
 * A tool result's text: a string, or a list of text blocks joined. The same
 * shape arrives on the PostToolUse hook and in the stream's tool_result
 * blocks, so the runner reads it through this too.
 */
export function toolResultText(content: unknown): string {
  const text: string =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? (content as { text?: string }[]).map((block) => block.text ?? '').join(' ')
        : '';
  return text.trim() || 'Tool returned an error.';
}
