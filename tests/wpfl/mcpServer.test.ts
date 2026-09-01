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

  // Tool search defers SDK MCP schemas by default, which costs an extra round
  // trip. The three the agent needs on nearly every question ride along.
  test('exactly three schemas ride in the initial prompt', () => {
    const always: string[] = wpflTools
      .filter((t) => t._meta?.['anthropic/alwaysLoad'] === true)
      .map((t) => t.name)
      .sort();

    expect(always).toEqual(['espn_teams', 'expected_wins', 'sql']);
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
