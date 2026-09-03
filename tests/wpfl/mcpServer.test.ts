import { describe, test, expect } from '@jest/globals';
import { wpflServer, wpflTools, WPFL_SERVER } from '../../wpfl/mcpServer.js';
import { STATIC_PROMPT } from '../../ask/systemPrompt.js';
import { generateIndex } from '../../wpfl/indexGenerator.js';
import { CACHE_SOURCES, tableName } from '../../wpfl/layout.js';

describe('mcpServer', () => {
  /**
   * The prompt and INDEX.md route the agent to tools by name, in prose, and
   * nothing else ties those names to the registrations. A renamed tool would
   * leave both pointing at one that does not exist, silently.
   */
  describe('the names the prose uses are registered', () => {
    const registered: string[] = wpflTools.map((t) => t.name);

    test('the system prompt names every tool, in backticks', () => {
      for (const name of registered) {
        expect(STATIC_PROMPT).toContain(`\`${name}\``);
      }
    });

    test("INDEX.md's routing table names only registered tools", () => {
      const index: string = generateIndex({
        shred: { files: [], undocumented: [], deadKeys: [], ignored: [] },
        asOf: {
          generated: null,
          factsAsOf: null,
          newsAsOf: null,
          etag: null,
          cacheFetchedAt: null,
        },
      });
      const routing: string = index.slice(index.indexOf('## Which source'));
      // Backticked snake_case words are tool names or cached tables; `espn_*`
      // is a family and WebSearch, /ewins and the like do not match the
      // pattern. The tables are the ones the cache derives, so a routing row
      // cannot name a table the database would not have either.
      const tables: string[] = Object.values(CACHE_SOURCES).map((file: string): string =>
        tableName('wpfl', file)
      );
      const named: string[] = [...routing.matchAll(/`([a-z][a-z_]*)`/g)]
        .map((m) => m[1])
        .filter((name: string): boolean => !tables.includes(name));

      expect(named.length).toBeGreaterThan(3);
      for (const name of named) expect(registered).toContain(name);
    });
  });

  test('registers exactly the eight tools the design specifies', () => {
    expect(wpflTools.map((t) => t.name).sort()).toEqual([
      'drafted_points',
      'espn_boxscores',
      'espn_free_agents',
      'espn_teams',
      'espn_transactions',
      'expected_wins',
      'optimal_coaching',
      'sql',
    ]);
  });

  test('every tool name is unique, so no allow rule is ambiguous', () => {
    const names: string[] = wpflTools.map((t) => t.name);

    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * Tool search is on by default and defers every MCP schema it is not told
   * to keep, and loading a deferred one costs a model round trip. The SDK's
   * own guidance: with fewer than ten tools, load everything upfront. The
   * server-level flag stamps every registered tool, which is where the SDK
   * reads it from, so that is what is asserted -- not the definitions.
   */
  test('every schema rides in the initial prompt, none deferred behind tool search', () => {
    const registered = (
      wpflServer.instance as unknown as {
        _registeredTools: Record<string, { _meta?: Record<string, unknown> }>;
      }
    )._registeredTools;

    for (const definition of wpflTools) {
      expect(registered[definition.name]?._meta?.['anthropic/alwaysLoad']).toBe(true);
    }
  });

  test('no definition carries its own alwaysLoad flag, so there is one place to look', () => {
    for (const definition of wpflTools) {
      expect(definition._meta?.['anthropic/alwaysLoad']).toBeUndefined();
    }
  });

  test('every tool has a description substantial enough to route on', () => {
    for (const definition of wpflTools) {
      expect(definition.description.length).toBeGreaterThan(80);
    }
  });

  test('is named wpfl, so every tool is reachable as mcp__wpfl__*', () => {
    // The one constant the server name, the runner's mcpServers key and the
    // allow rule are all built from.
    expect(WPFL_SERVER).toBe('wpfl');
    expect(wpflServer.name).toBe(WPFL_SERVER);
  });

  test('is an in-process SDK server rather than a spawned one', () => {
    expect(wpflServer.type).toBe('sdk');
    expect(wpflServer.instance).toBeDefined();
  });
});
