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
import { createSqlTool, runSql } from './sqlTool.js';
import { wpflApiTools } from './wpflApiTools.js';
import { createEspnTools } from './espnTools.js';
import { createPolymarketLinesTool } from './polymarketLines.js';
import { createPictureTools } from '../pictures/tools.js';
import type { PictureCollector } from '../pictures/collector.js';
import type { LiveStore } from './liveTables.js';
import type { AnyTool } from './toolResult.js';
import { espnClientFromEnv, getCurrentPeriod } from '../helpers/espnPeriod.js';
import type { Client as EspnClient } from 'espn-fantasy-football-api/node.js';

/** The ESPN client the Polymarket tool reads the week's schedule from; the ESPN tools build the same one. */
function espnClient(): EspnClient {
  const client: EspnClient | null = espnClientFromEnv();
  if (client === null) {
    throw new Error('ESPN credentials are not configured (LEAGUE_ID, ESPN_S2, SWID).');
  }
  return client;
}

/**
 * The nine league tools. `sql`, the four ESPN tools and the Polymarket tool
 * are built per run because they share that run's live tables
 * (wpfl/liveTables.ts): a fetch fills them and `sql` reads them. The three
 * history-API tools are the same object every run. The tool text is identical
 * from run to run, so the prompt cache still hits; only the closures differ.
 *
 * All eleven schemas ride in the initial prompt. Tool search is on by default
 * and defers any MCP schema it is not told to keep; loading a deferred one
 * costs a model round trip on a ticker somebody is watching. The server is
 * declared `alwaysLoad`, and the eleven together serialise to about three
 * thousand tokens, cached after the first turn. Declared once, on the
 * server, rather than per tool (log Stage 14).
 */
export function createLeagueTools(store: LiveStore): AnyTool[] {
  return [
    createSqlTool(store),
    ...wpflApiTools,
    ...createEspnTools(store),
    createPolymarketLinesTool(store, { client: espnClient, period: getCurrentPeriod }),
  ];
}

/**
 * The server's name is also the `mcpServers` key the runner registers it under
 * and the prefix of every tool's full name (`mcp__wpfl__sql`), which is what
 * the allow rule matches. One constant, so the three cannot disagree.
 */
export const WPFL_SERVER = 'wpfl';

/**
 * A server for one run: the run's picture collector and its live tables are
 * what the closures differ by. The tool schemas are identical text from run
 * to run, so the prompt cache still hits.
 */
export function createWpflServer(
  collector: PictureCollector,
  store: LiveStore
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: WPFL_SERVER,
    version: '1.0.0',
    alwaysLoad: true,
    timeout: ASK.MCP_TOOL_TIMEOUT_MS,
    instructions:
      "Tools for the WPFL fantasy football league. `sql` reaches ten years of rows and the 2026 draft artifact; the espn_* tools are the only source for the season in progress, and each call also fills a live_* table that `sql`, `chart` and `table` can read in the same run; expected_wins, optimal_coaching and drafted_points are computed by the league's own history API and must never be worked out by hand; polymarket_lines is Polymarket's price on each NFL game of the week and fills live_lines; `chart` and `table` draw a query's rows as a picture and hand back a token for the answer.",
    tools: [
      ...createLeagueTools(store),
      ...createPictureTools(collector, {
        runSql: (sql: string) => runSql(sql, ASK.DATA_DIR, store),
      }),
    ],
  });
}
