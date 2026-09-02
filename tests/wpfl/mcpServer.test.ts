import { describe, test, expect } from '@jest/globals';
import { wpflServer, wpflTools } from '../../wpfl/mcpServer.js';

describe('mcpServer', () => {
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
    expect(wpflServer.name).toBe('wpfl');
  });

  test('is an in-process SDK server rather than a spawned one', () => {
    expect(wpflServer.type).toBe('sdk');
    expect(wpflServer.instance).toBeDefined();
  });
});
