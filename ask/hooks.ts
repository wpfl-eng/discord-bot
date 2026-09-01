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
import { ASK } from './askConfig.js';
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
 */
export function createPathGuard(
  context: HookContext,
  dataDir: string = ASK.DATA_DIR
): HookCallback {
  const root: string = realpath(dataDir);

  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return PASS;

    const requested: string | undefined = pathArgument(input.tool_input);
    // Grep and Glob without a path search the working directory, which is the
    // data directory.
    if (requested === undefined) return PASS;

    const resolved: string = realpath(path.resolve(dataDir, requested));
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) return PASS;

    await record(context, input.tool_name, input.tool_input, 'path_guard', null);
    return deny('I can only read the WPFL data directory.');
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

    await record(context, input.tool_name, input.tool_input, 'domain_guard', null);
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
      await record(context, input.tool_name, input.tool_input, null, input.error);
      return PASS;
    }

    if (input.hook_event_name === 'PostToolUse') {
      const response = input.tool_response as { isError?: boolean } | null;
      if (response?.isError === true) {
        await record(
          context,
          input.tool_name,
          input.tool_input,
          null,
          describeError(input.tool_response)
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
      // Built from the same list askRunner exposes, so a file tool added there
      // is confined here automatically rather than by anyone remembering.
      { matcher: ASK.FILE_TOOLS.join('|'), hooks: [createPathGuard(context, dataDir)] },
      { matcher: 'WebFetch', hooks: [createWebFetchGuard(context)] },
    ],
    PostToolUse: [{ hooks: [audit] }],
    // PostToolUse does not fire for a tool that threw; this event carries the
    // error string directly.
    PostToolUseFailure: [{ hooks: [audit] }],
  };
}

/** Read, Grep and Glob name their path argument differently. */
function pathArgument(toolInput: unknown): string | undefined {
  const args = toolInput as { file_path?: unknown; path?: unknown } | null;
  const value: unknown = args?.file_path ?? args?.path;
  return typeof value === 'string' && value !== '' ? value : undefined;
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
    // Never let bookkeeping block a denial or kill an answer.
    logError('ask', 'Could not record a tool exception', writeError);
  }
}

function describeError(response: unknown): string {
  const content = (response as { content?: { text?: string }[] } | null)?.content;
  return (
    content
      ?.map((block) => block.text ?? '')
      .join(' ')
      .trim() || 'Tool returned an error.'
  );
}
