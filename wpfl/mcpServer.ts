/**
 * The `wpfl` MCP server: every custom tool the agent gets, in one in-process
 * SDK server so they share the `mcp__wpfl__*` prefix and a single allow rule
 * (design §4.2).
 *
 * In-process means these run inside the bot's own Node process with full access
 * to .env. That is fine: they are our code and do only what we wrote. The agent
 * reaches them through their declared schemas and nothing else.
 */

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { sqlTool } from './sqlTool.js';
import { wpflApiTools } from './wpflApiTools.js';
import { espnTools } from './espnTools.js';
import type { AnyTool } from './toolResult.js';

/**
 * All eight schemas ride in the initial prompt. Tool search is on by default
 * and defers any MCP schema it is not told to keep; loading a deferred one
 * costs a model round trip on a ticker somebody is watching. The SDK's own
 * guidance is to load everything upfront under ten tools, and the eight
 * together serialise to about two thousand tokens, cached after the first
 * turn. Declared once, on the server, rather than per tool (log Stage 14).
 */
export const wpflTools: AnyTool[] = [sqlTool, ...wpflApiTools, ...espnTools];

/**
 * The server's name is also the `mcpServers` key the runner registers it under
 * and the prefix of every tool's full name (`mcp__wpfl__sql`), which is what
 * the allow rule matches. One constant, so the three cannot disagree.
 */
export const WPFL_SERVER = 'wpfl';

export const wpflServer = createSdkMcpServer({
  name: WPFL_SERVER,
  version: '1.0.0',
  alwaysLoad: true,
  instructions:
    "Tools for the WPFL fantasy football league. `sql` reaches ten years of rows and the 2026 draft artifact; the espn_* tools are the only source for the season in progress; expected_wins, optimal_coaching and drafted_points are computed by the league's own history API and must never be worked out by hand.",
  tools: wpflTools,
});
