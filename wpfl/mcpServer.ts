/**
 * The `wpfl` MCP server: every custom tool the agent gets, in one in-process
 * SDK server so they share the `mcp__wpfl__*` prefix and a single allow rule
 * (design §4.2).
 *
 * In-process means these run inside the bot's own Node process with full access
 * to .env. That is fine: they are our code and do only what we wrote. The agent
 * reaches them through their declared schemas and nothing else.
 */

import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { sqlTool } from './sqlTool.js';
import { wpflApiTools } from './wpflApiTools.js';
import { espnTools } from './espnTools.js';

/**
 * Tool search defers SDK MCP tool schemas by default, so with eight tools most
 * questions would pay an extra round trip. `sql`, `espn_teams` and
 * `expected_wins` are declared alwaysLoad at their definitions, which puts
 * their schemas in the initial prompt; the rest stay deferred.
 */
// See the note in wpflApiTools.ts on why this collection is typed as the
// library types its own.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wpflTools: SdkMcpToolDefinition<any>[] = [sqlTool, ...wpflApiTools, ...espnTools];

export const wpflServer = createSdkMcpServer({
  name: 'wpfl',
  version: '1.0.0',
  instructions:
    "Tools for the WPFL fantasy football league. `sql` reaches ten years of rows and the 2026 draft artifact; the espn_* tools are the only source for the season in progress; expected_wins, optimal_coaching and drafted_points are computed by the league's own history API and must never be worked out by hand.",
  tools: wpflTools,
});
