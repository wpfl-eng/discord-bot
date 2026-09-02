/**
 * Credential resolution and the subprocess environment for the /ask agent.
 *
 * Auth is deliberately swappable: ANTHROPIC_API_KEY is preferred and
 * CLAUDE_CODE_OAUTH_TOKEN is the fallback, so moving between a metered API key
 * and a subscription token is one environment variable on the host and never a
 * code change (design §2, §10.1).
 */

import { APIError } from '../errors/BotError.js';

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
 * @throws {APIError} when no Claude credential, PATH or HOME is set.
 */
export function agentEnv(): Record<string, string> {
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
    HOME: required('HOME'),
    // Correct the moment auth moves to ANTHROPIC_API_KEY; a no-op on a
    // subscription token, which already gets the 1h TTL on its own turns.
    ENABLE_PROMPT_CACHING_1H: '1',
    ...credential,
  };
}

/** What a member reads when there is no credential: the refusal and the thrown error say the same thing. */
export const NOT_CONFIGURED =
  "I'm not configured to answer questions yet — nobody has given me a Claude credential.";

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
