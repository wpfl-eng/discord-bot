/**
 * The `wpfl` MCP server: every custom tool the agent gets, in one in-process
 * SDK server so they share the `mcp__wpfl__*` prefix and a single allow rule
 * (design §4.2).
 *
 * In-process means these run inside the bot's own Node process with full access
 * to .env. That is fine: they are our code and do only what we wrote. The agent
 * reaches them through their declared schemas and nothing else.
 */

import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import { ASK } from '../ask/askConfig.js';
import { sqlTool } from './sqlTool.js';
import { wpflApiTools } from './wpflApiTools.js';
import { espnTools } from './espnTools.js';
import { createPictureTools } from '../pictures/tools.js';
import type { PictureCollector } from '../pictures/collector.js';
import type { AnyTool } from './toolResult.js';

/**
 * The eight league tools, the same on every run. The two picture tools are
 * built per run, because they close over that run's collector.
 *
 * All ten schemas ride in the initial prompt. Tool search is on by default
 * and defers any MCP schema it is not told to keep; loading a deferred one
 * costs a model round trip on a ticker somebody is watching. The SDK's own
 * guidance is to load everything upfront at ten tools or fewer, and the ten
 * together serialise to about twenty-five hundred tokens, cached after the
 * first turn. Declared once, on the server, rather than per tool (log
 * Stage 14).
 */
export const wpflTools: AnyTool[] = [sqlTool, ...wpflApiTools, ...espnTools];

/**
 * The server's name is also the `mcpServers` key the runner registers it under
 * and the prefix of every tool's full name (`mcp__wpfl__sql`), which is what
 * the allow rule matches. One constant, so the three cannot disagree.
 */
export const WPFL_SERVER = 'wpfl';

/**
 * A server for one run. The tool schemas are identical text from run to
 * run, so the prompt cache still hits; only the picture tools' closure
 * differs.
 */
export function createWpflServer(collector: PictureCollector): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: WPFL_SERVER,
    version: '1.0.0',
    alwaysLoad: true,
    timeout: ASK.MCP_TOOL_TIMEOUT_MS,
    instructions:
      "Tools for the WPFL fantasy football league. `sql` reaches ten years of rows and the 2026 draft artifact; the espn_* tools are the only source for the season in progress; expected_wins, optimal_coaching and drafted_points are computed by the league's own history API and must never be worked out by hand; `chart` and `table` draw a query's rows as a picture and hand back a token for the answer.",
    tools: [...wpflTools, ...createPictureTools(collector)],
  });
}
