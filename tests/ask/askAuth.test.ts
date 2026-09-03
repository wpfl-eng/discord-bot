import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentEnv, credentialConfigured } from '../../ask/askAuth.js';
import { ASK } from '../../ask/askConfig.js';
import { BotError } from '../../errors/BotError.js';

// agentEnv(agentHome) reads process.env at call time, so these tests set it directly
// rather than mocking a module. The original values are restored afterwards so
// a real .env on the dev box cannot leak between tests or out of this file.
describe('askAuth', () => {
  const original: NodeJS.ProcessEnv = { ...process.env };
  // The subprocess's HOME, passed explicitly so a test never creates the real
  // agent home on the box it runs on.
  let agentHome: string;

  beforeAll(() => {
    agentHome = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ask-auth-')), 'agent-home');
  });

  afterAll(() => {
    fs.rmSync(path.dirname(agentHome), { recursive: true, force: true });
  });

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

      const env: Record<string, string> = agentEnv(agentHome);

      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
      expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    });

    test('falls back to CLAUDE_CODE_OAUTH_TOKEN when the API key is absent', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';

      const env: Record<string, string> = agentEnv(agentHome);

      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test');
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    test('throws a BotError when neither credential is set', () => {
      expect(() => agentEnv(agentHome)).toThrow(BotError);
    });

    // The member sees userMessage; the operator sees originalError through
    // BotError.toLogObject(). Which variable is missing is an operator's
    // problem, so it belongs on the cause and must stay out of the Discord
    // reply.
    test('names both variables on the cause and neither in the member-facing text', () => {
      let thrown: BotError | undefined;
      try {
        agentEnv(agentHome);
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

      const env: Record<string, string> = agentEnv(agentHome);

      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test');
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    test("carries PATH, the agent's own HOME and the 1h prompt cache flag", () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      const env: Record<string, string> = agentEnv(agentHome);

      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe(agentHome);
      expect(env.ENABLE_PROMPT_CACHING_1H).toBe('1');
    });

    // The Claude Code runtime reads HOME for a login profile and, finding one,
    // appends the account's email to every turn's context. The bot user's HOME
    // on a dev box has one, and the agent attributed that email to the member
    // it was answering. So the subprocess gets a HOME that is nobody's.
    test("gives the subprocess a HOME of its own, never the bot user's", () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';

      const env: Record<string, string> = agentEnv(agentHome);

      expect(env.HOME).toBe(agentHome);
      expect(env.HOME).not.toBe(process.env.HOME);
      expect(fs.statSync(agentHome).isDirectory()).toBe(true);
    });

    test('creates the agent home when it is missing', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';
      const fresh: string = path.join(agentHome, 'nested', 'home');
      expect(fs.existsSync(fresh)).toBe(false);

      agentEnv(fresh);

      expect(fs.statSync(fresh).isDirectory()).toBe(true);
    });

    // Sessions and the login profile live under HOME. Inside the data
    // directory they would be one Read away from any member.
    test('refuses an agent home that is, or is inside, the data directory', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';

      for (const home of [path.join(ASK.DATA_DIR, 'home'), ASK.DATA_DIR]) {
        let thrown: BotError | undefined;
        try {
          agentEnv(home);
        } catch (error: unknown) {
          thrown = error as BotError;
        }
        expect(thrown).toBeInstanceOf(BotError);
        expect(thrown?.originalError?.message).toMatch(/data directory/i);
        expect(thrown?.userMessage).not.toMatch(/data directory|WPFL_/i);
      }
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

      const env: Record<string, string> = agentEnv(agentHome);

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
        agentEnv(agentHome);
      } catch (error: unknown) {
        thrown = error as BotError;
      }

      expect(thrown).toBeInstanceOf(BotError);
      expect(thrown?.originalError?.message).toMatch(/PATH/);
    });
  });
});
