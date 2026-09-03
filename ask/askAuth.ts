/**
 * Credential resolution and the subprocess environment for the /ask agent.
 *
 * Auth is deliberately swappable: ANTHROPIC_API_KEY is preferred and
 * CLAUDE_CODE_OAUTH_TOKEN is the fallback, so moving between a metered API key
 * and a subscription token is one environment variable on the host and never a
 * code change (design §2, §10.1).
 */

import fs from 'node:fs';
import path from 'node:path';
import { APIError } from '../errors/BotError.js';
import { ASK } from './askConfig.js';

/**
 * Whether a run could authenticate at all. Cheap, so both entry points check
 * it before spawning anything, and `ready` logs when it is false.
 */
export function credentialConfigured(): boolean {
  return (
    (process.env.ANTHROPIC_API_KEY ?? '') !== '' ||
    (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '') !== ''
  );
}

/**
 * The Claude Code subprocess gets exactly these keys and nothing else.
 *
 * Spreading `process.env` would hand it DISCORD_TOKEN, POSTGRES_*, ESPN_S2 and
 * SWID. Claude has no shell so it could not read them today, but there is no
 * reason for them to be in that process at all, and a future change that adds a
 * shell would otherwise quietly become a credential leak.
 *
 * HOME is the agent's own directory, not the bot user's. The runtime reads
 * HOME for a login profile and, finding one, appends that account's email to
 * every turn's context as "the user's" -- and the agent attributed it to the
 * member it was answering. The production host has no such profile; a dev box
 * does, and one `claude login` on the host would have made it so there too.
 *
 * @param home where the subprocess keeps its sessions; created if missing.
 * @throws {APIError} when no Claude credential or PATH is set, or `home` is
 *   the data directory or inside it, where the path guard would let any member
 *   Read every other member's sessions.
 */
export function agentEnv(home: string = ASK.AGENT_HOME): Record<string, string> {
  const apiKey: string | undefined = process.env.ANTHROPIC_API_KEY;
  const credential: Record<string, string> = apiKey
    ? { ANTHROPIC_API_KEY: apiKey }
    : {
        CLAUDE_CODE_OAUTH_TOKEN: required(
          'CLAUDE_CODE_OAUTH_TOKEN',
          NOT_CONFIGURED,
          // The log names both, since either would have done.
          'Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set'
        ),
      };

  return {
    PATH: required('PATH'),
    HOME: agentHome(home),
    // Correct the moment auth moves to ANTHROPIC_API_KEY; a no-op on a
    // subscription token, which already gets the 1h TTL on its own turns.
    ENABLE_PROMPT_CACHING_1H: '1',
    ...credential,
  };
}

/** What a member reads when there is no credential: the refusal and the thrown error say the same thing. */
export const NOT_CONFIGURED =
  "I'm not configured to answer questions yet — nobody has given me a Claude credential.";

/** The agent's HOME, existing and outside the data directory. */
function agentHome(home: string): string {
  const resolved: string = path.resolve(home);
  const dataDir: string = path.resolve(ASK.DATA_DIR);
  if (resolved === dataDir || resolved.startsWith(`${dataDir}${path.sep}`)) {
    throw new APIError(
      "I'm not configured to answer questions yet.",
      { step: 'agentEnv' },
      new Error(
        `WPFL_AGENT_HOME (${resolved}) must not be the data directory (${dataDir}) or inside it`
      )
    );
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  return resolved;
}

/**
 * @param message what the member reads; never names a variable.
 * @param cause what the log reads; does.
 */
function required(
  name: string,
  message: string = "I'm not configured to answer questions yet.",
  cause: string = `${name} is not set`
): string {
  const value: string | undefined = process.env[name];
  if (!value) {
    throw new APIError(message, { step: 'agentEnv' }, new Error(cause));
  }
  return value;
}
