import { describe, test, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.unstable_mockModule('../../ask/askDb.js', () => ({
  recordToolException: jest.fn(),
}));

const { createPathGuard, createWebFetchGuard, createAuditHook, createHooks } =
  await import('../../ask/hooks.js');
const askDb = await import('../../ask/askDb.js');
const { ASK } = await import('../../ask/askConfig.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRecord = askDb.recordToolException as any;

const CONTEXT = { threadId: 't1', userId: 'u1' };

type Decision = {
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
};

let dataDir: string;
let outside: string;

const preToolUse = (toolName: string, toolInput: unknown): never =>
  ({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'tu1',
  }) as never;

const call = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hook: any,
  toolName: string,
  toolInput: unknown
): Promise<Decision> =>
  (await hook(preToolUse(toolName, toolInput), 'tu1', {
    signal: new AbortController().signal,
  })) as Decision;

const denied = (d: Decision): boolean => d.hookSpecificOutput?.permissionDecision === 'deny';

describe('hooks', () => {
  beforeAll(() => {
    const parent: string = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-hooks-'));
    dataDir = path.join(parent, 'data');
    outside = path.join(parent, 'secrets');
    fs.mkdirSync(path.join(dataDir, 'teams'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'INDEX.md'), '# index\n');
    fs.writeFileSync(path.join(dataDir, 'teams', 'aj-boorde.json'), '{}');
    fs.writeFileSync(path.join(outside, '.env'), 'DISCORD_TOKEN=hunter2\n');
    // A symlink that lives inside the data dir but points out of it.
    fs.symlinkSync(outside, path.join(dataDir, 'escape'));
  });

  afterAll(() => {
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecord.mockResolvedValue(undefined);
  });

  describe('the path guard', () => {
    const guard = (): ReturnType<typeof createPathGuard> => createPathGuard(CONTEXT, dataDir);

    test('allows a read inside the data directory', async () => {
      const decision = await call(guard(), 'Read', {
        file_path: path.join(dataDir, 'teams', 'aj-boorde.json'),
      });

      expect(denied(decision)).toBe(false);
    });

    test('allows a path that does not exist yet, if it is inside', async () => {
      const decision = await call(guard(), 'Read', {
        file_path: path.join(dataDir, 'market', 'curve.json'),
      });

      expect(denied(decision)).toBe(false);
    });

    test('denies an absolute path outside the data directory', async () => {
      expect(denied(await call(guard(), 'Read', { file_path: '/etc/passwd' }))).toBe(true);
    });

    test('denies a `..` traversal out of the data directory', async () => {
      const decision = await call(guard(), 'Read', {
        file_path: path.join(dataDir, '..', 'secrets', '.env'),
      });

      expect(denied(decision)).toBe(true);
    });

    // The reason the guard resolves with realpath rather than normalising the
    // string: this path is textually inside the data directory.
    test('denies a symlink inside the data directory that points out of it', async () => {
      const decision = await call(guard(), 'Read', {
        file_path: path.join(dataDir, 'escape', '.env'),
      });

      expect(denied(decision)).toBe(true);
    });

    test('denies a Grep whose path escapes -- Grep returns file contents', async () => {
      expect(denied(await call(guard(), 'Grep', { pattern: 'TOKEN', path: outside }))).toBe(true);
    });

    test('denies a Glob whose path escapes', async () => {
      expect(denied(await call(guard(), 'Glob', { pattern: '*', path: '/etc' }))).toBe(true);
    });

    /**
     * Measured live on 2026-09-02 (log Stage 14): with no `path`, the CLI's
     * Glob honours an absolute pattern. `/etc/host*` came back with
     * /etc/hosts, /etc/hostname and five more, straight through a hook that
     * only ever looked at `path` and `file_path`. Names rather than contents,
     * but an agent that can list the host is not what §10.2 promises.
     */
    describe("Glob's pattern is a path too", () => {
      test('denies an absolute pattern that escapes, with no path argument', async () => {
        expect(denied(await call(guard(), 'Glob', { pattern: '/etc/host*' }))).toBe(true);
      });

      test('denies a pattern that climbs out with ..', async () => {
        expect(denied(await call(guard(), 'Glob', { pattern: '../secrets/*' }))).toBe(true);
      });

      test('denies a pattern anchored at the home directory', async () => {
        expect(denied(await call(guard(), 'Glob', { pattern: '~/discord-bot/.env' }))).toBe(true);
      });

      test('denies an absolute pattern outside even when the path argument is inside', async () => {
        expect(
          denied(await call(guard(), 'Glob', { pattern: `${outside}/**`, path: dataDir }))
        ).toBe(true);
      });

      // The model, told its working directory, sometimes writes the absolute
      // form of a pattern that never leaves it. A flat deny on absolute
      // patterns would refuse that.
      test('allows an absolute pattern that stays inside the data directory', async () => {
        expect(denied(await call(guard(), 'Glob', { pattern: `${dataDir}/teams/*.json` }))).toBe(
          false
        );
      });

      test('allows relative patterns, which cannot leave a confined search root', async () => {
        expect(denied(await call(guard(), 'Glob', { pattern: 'teams/*.json' }))).toBe(false);
        expect(denied(await call(guard(), 'Glob', { pattern: '**/*.jsonl' }))).toBe(false);
      });

      test('records the denial as the path guard, like every other escape', async () => {
        await call(guard(), 'Glob', { pattern: '/etc/host*' });

        expect(mockRecord).toHaveBeenCalledWith(
          expect.objectContaining({ toolName: 'Glob', deniedBy: 'path_guard' })
        );
      });
    });

    test('allows a Grep with no path, which searches the working directory', async () => {
      expect(denied(await call(guard(), 'Grep', { pattern: 'Boorde' }))).toBe(false);
    });

    test('allows a relative path that stays inside', async () => {
      expect(denied(await call(guard(), 'Read', { file_path: 'teams/aj-boorde.json' }))).toBe(
        false
      );
    });

    test('denies a relative path that climbs out', async () => {
      expect(denied(await call(guard(), 'Read', { file_path: '../secrets/.env' }))).toBe(true);
    });

    test('the refusal is written to be shown to a league member', async () => {
      const decision = await call(guard(), 'Read', { file_path: '/etc/passwd' });

      expect(decision.hookSpecificOutput?.permissionDecisionReason).toMatch(/WPFL data/i);
      expect(decision.hookSpecificOutput?.permissionDecisionReason).not.toContain('/etc/passwd');
    });

    test('records the denial with denied_by so the audit trail survives', async () => {
      await call(guard(), 'Read', { file_path: '/etc/passwd' });

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 't1',
          userId: 'u1',
          toolName: 'Read',
          deniedBy: 'path_guard',
        })
      );
    });

    test('records nothing when the call is allowed', async () => {
      await call(guard(), 'Read', { file_path: path.join(dataDir, 'INDEX.md') });

      expect(mockRecord).not.toHaveBeenCalled();
    });

    test('a failing audit write does not block the denial', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockRecord.mockRejectedValue(new Error('postgres down'));

      expect(denied(await call(guard(), 'Read', { file_path: '/etc/passwd' }))).toBe(true);
      error.mockRestore();
    });
  });

  describe('the WebFetch domain guard', () => {
    const guard = (): ReturnType<typeof createWebFetchGuard> => createWebFetchGuard(CONTEXT);

    test('allows a host on the list', async () => {
      expect(
        denied(await call(guard(), 'WebFetch', { url: 'https://www.espn.com/nfl/story' }))
      ).toBe(false);
    });

    test('allows a subdomain of a listed host', async () => {
      expect(denied(await call(guard(), 'WebFetch', { url: 'https://fantasy.espn.com/x' }))).toBe(
        false
      );
    });

    test('allows the artifact host and the WPFL API', async () => {
      expect(denied(await call(guard(), 'WebFetch', { url: ASK.ARTIFACT_URL }))).toBe(false);
      expect(
        denied(await call(guard(), 'WebFetch', { url: 'https://wpflapi.azurewebsites.net/api/x' }))
      ).toBe(false);
    });

    test('denies a host that is not on the list', async () => {
      expect(denied(await call(guard(), 'WebFetch', { url: 'https://pastebin.com/raw/x' }))).toBe(
        true
      );
    });

    // A suffix match on the whole hostname would pass these. It must not.
    test('denies a lookalike that merely ends with a listed name', async () => {
      expect(denied(await call(guard(), 'WebFetch', { url: 'https://espn.com.evil.io/x' }))).toBe(
        true
      );
      expect(denied(await call(guard(), 'WebFetch', { url: 'https://notespn.com/x' }))).toBe(true);
    });

    test('denies a malformed URL rather than guessing', async () => {
      expect(denied(await call(guard(), 'WebFetch', { url: 'not a url' }))).toBe(true);
      expect(denied(await call(guard(), 'WebFetch', {}))).toBe(true);
    });

    test('the refusal is phrased to be relayed to the member', async () => {
      const decision = await call(guard(), 'WebFetch', { url: 'https://pastebin.com/raw/x' });

      expect(decision.hookSpecificOutput?.permissionDecisionReason).toMatch(/link/i);
    });

    test('records the denial with denied_by, so the allowlist can grow from evidence', async () => {
      await call(guard(), 'WebFetch', { url: 'https://pastebin.com/raw/x' });

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'WebFetch', deniedBy: 'domain_guard' })
      );
    });
  });

  describe('the audit hook', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fire = async (input: any): Promise<unknown> =>
      createAuditHook(CONTEXT)(input, 'tu1', { signal: new AbortController().signal });

    test('writes nothing for a call that succeeded -- the ticker already showed it', async () => {
      await fire({
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { file_path: 'INDEX.md' },
        tool_response: { content: [{ type: 'text', text: 'ok' }] },
        tool_use_id: 'tu1',
      });

      expect(mockRecord).not.toHaveBeenCalled();
    });

    test('writes a row when a tool result came back as an error', async () => {
      await fire({
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__wpfl__sql',
        tool_input: { query: 'SELECT nope' },
        tool_response: { isError: true, content: [{ type: 'text', text: 'no such column' }] },
        tool_use_id: 'tu1',
      });

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'mcp__wpfl__sql', deniedBy: null })
      );
    });

    test('writes a row when the tool failed outright', async () => {
      await fire({
        hook_event_name: 'PostToolUseFailure',
        tool_name: 'WebFetch',
        tool_input: { url: 'https://espn.com/x' },
        error: 'socket hang up',
        tool_use_id: 'tu1',
      });

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'WebFetch', error: 'socket hang up', deniedBy: null })
      );
    });

    test('a failing audit write logs and continues rather than killing the answer', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockRecord.mockRejectedValue(new Error('postgres down'));

      await expect(
        fire({
          hook_event_name: 'PostToolUseFailure',
          tool_name: 'WebFetch',
          tool_input: {},
          error: 'boom',
          tool_use_id: 'tu1',
        })
      ).resolves.toBeDefined();
      error.mockRestore();
    });
  });

  /**
   * The guard used to know `file_path`, `path` and Glob's `pattern` by name,
   * in an if-chain, while the config promised that a tool added to the file
   * tools was confined automatically. A fourth tool naming its path anything
   * else would have matched the guard and passed on an empty list. The path
   * arguments are a table now, the file tools derive from it, and a tool with
   * no entry is refused rather than waved through.
   */
  describe('the path-argument table', () => {
    test('denies a tool it has no entry for, rather than passing it on an empty list', async () => {
      const decision = await call(createPathGuard(CONTEXT, dataDir), 'NotebookRead', {
        notebook_path: '/etc/passwd',
      });

      expect(denied(decision)).toBe(true);
      expect(decision.hookSpecificOutput?.permissionDecisionReason).toMatch(/NotebookRead/);
    });

    test('the file tools are exactly the table, in its order', async () => {
      const { FILE_TOOLS, ASK } = await import('../../ask/askConfig.js');

      expect(FILE_TOOLS).toEqual(Object.keys(ASK.PATH_ARGUMENTS));
      expect(FILE_TOOLS).toEqual(['Read', 'Grep', 'Glob']);
    });
  });

  describe('the assembled hook configuration', () => {
    test('guards the three file tools and WebFetch before they run', () => {
      const hooks = createHooks(CONTEXT, dataDir);

      expect(hooks.PreToolUse?.[0].matcher).toBe('Read|Grep|Glob');
      expect(hooks.PreToolUse?.[1].matcher).toBe('WebFetch');
    });

    test('audits both the error result and the outright failure', () => {
      const hooks = createHooks(CONTEXT, dataDir);

      expect(hooks.PostToolUse?.[0].hooks).toHaveLength(1);
      expect(hooks.PostToolUseFailure?.[0].hooks).toHaveLength(1);
    });
  });
});
