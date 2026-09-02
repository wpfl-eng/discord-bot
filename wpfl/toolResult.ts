/**
 * What every custom tool hands back, and the one type their collections share.
 */

import type { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * A tool definition's handler is contravariant in its own schema, so a
 * heterogeneous collection of them cannot be typed more precisely than the
 * library types its own `tools` option. Taken from that option rather than
 * spelled as `SdkMcpToolDefinition<any>` -- the same `any`, but through an
 * alias it resolved the handler's argument to an index signature and every
 * concrete tool stopped being assignable.
 */
export type AnyTool = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>[number];

/** One text block. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Rows as indented JSON. An empty result says so, so it is not read as zeroes. */
export function toToolResult(rows: readonly unknown[]): CallToolResult {
  return textResult(
    rows.length === 0 ? 'No rows for those parameters.' : JSON.stringify(rows, null, 1)
  );
}
