import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { agentEnv, credentialConfigured } from '../../ask/askAuth.js';
import { BotError } from '../../errors/BotError.js';

// agentEnv() reads process.env at call time, so these tests set it directly
// rather than mocking a module. The original values are restored afterwards so
// a real .env on the dev box cannot leak between tests or out of this file.
describe('askAuth', () => {
  const original: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/tester';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  /**
   * The cheap check before a run: the `ready` log line and the early "not
   * configured" refusal both read this, so a member is told plainly instead of
   * a subprocess being spawned to fail (log Stage 14, decision 12).
   */
  describe('credentialConfigured', () => {
    test('is false with neither credential', () => {
      expect(credentialConfigured()).toBe(false);
    });

    test('is true with either one', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';
      expect(credentialConfigured()).toBe(true);

      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(credentialConfigured()).toBe(true);
    });

    test('treats an empty value as unset', () => {
      process.env.ANTHROPIC_API_KEY = '';
      expect(credentialConfigured()).toBe(false);
    });
  });

  describe('agentEnv', () => {
    test('prefers ANTHROPIC_API_KEY when both credentials are present', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';

      const env: Record<string, string> = agentEnv();

      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
      expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    });

    test('falls back to CLAUDE_CODE_OAUTH_TOKEN when the API key is absent', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';

      const env: Record<string, string> = agentEnv();

      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test');
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    test('throws a BotError when neither credential is set', () => {
      expect(() => agentEnv()).toThrow(BotError);
    });

    // The member sees userMessage; the operator sees originalError through
    // BotError.toLogObject(). Which variable is missing is an operator's
    // problem, so it belongs on the cause and must stay out of the Discord
    // reply.
    test('names both variables on the cause and neither in the member-facing text', () => {
      let thrown: BotError | undefined;
      try {
        agentEnv();
      } catch (error: unknown) {
        thrown = error as BotError;
      }

      expect(thrown).toBeInstanceOf(BotError);
      expect(thrown?.originalError?.message).toMatch(/ANTHROPIC_API_KEY/);
      expect(thrown?.originalError?.message).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
      expect(thrown?.userMessage).not.toMatch(/ANTHROPIC_API_KEY/);
      expect(thrown?.userMessage).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    });

    test('treats an empty ANTHROPIC_API_KEY as absent rather than as a credential', () => {
      process.env.ANTHROPIC_API_KEY = '';
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';

      const env: Record<string, string> = agentEnv();

      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test');
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    test('carries PATH, HOME and the 1h prompt cache flag', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      const env: Record<string, string> = agentEnv();

      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/tester');
      expect(env.ENABLE_PROMPT_CACHING_1H).toBe('1');
    });

    test('carries no secret beyond the Claude credential', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.DISCORD_TOKEN = 'discord-secret';
      process.env.DISCORD_CLIENT_ID = 'discord-client';
      process.env.POSTGRES_URL = 'postgres://secret';
      process.env.POSTGRES_PASSWORD = 'pg-secret';
      process.env.ESPN_S2 = 'espn-secret';
      process.env.SWID = 'swid-secret';
      process.env.OPEN_API_KEY = 'openai-secret';
      process.env.FINNHUB_API_KEY = 'finnhub-secret';

      const env: Record<string, string> = agentEnv();

      // Named explicitly so a new leak is a failure, not a silent pass.
      for (const key of [
        'DISCORD_TOKEN',
        'DISCORD_CLIENT_ID',
        'POSTGRES_URL',
        'POSTGRES_PASSWORD',
        'ESPN_S2',
        'SWID',
        'OPEN_API_KEY',
        'FINNHUB_API_KEY',
      ]) {
        expect(env).not.toHaveProperty(key);
      }

      // And the general rule the list above only samples: the env is exactly
      // the four keys agentEnv is allowed to hand the subprocess.
      expect(Object.keys(env).sort()).toEqual([
        'ANTHROPIC_API_KEY',
        'ENABLE_PROMPT_CACHING_1H',
        'HOME',
        'PATH',
      ]);
    });

    test('throws when PATH is missing, naming it on the cause', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      delete process.env.PATH;

      let thrown: BotError | undefined;
      try {
        agentEnv();
      } catch (error: unknown) {
        thrown = error as BotError;
      }

      expect(thrown).toBeInstanceOf(BotError);
      expect(thrown?.originalError?.message).toMatch(/PATH/);
    });
  });
});
