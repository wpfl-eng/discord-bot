import { describe, test, expect, jest } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createPictureTools, type PictureDeps } from '../../pictures/tools.js';
import { createCollector, tokenFor, type PictureCollector } from '../../pictures/collector.js';
import { FALLBACK } from '../../pictures/shared.js';
import { ASK } from '../../ask/askConfig.js';
import type { SqlResult } from '../../wpfl/sqlTool.js';

const OWNERS: readonly string[] = ['AJ Boorde', 'Todd Ellis', 'Nixon Ball'];

const ROWS: Record<string, unknown>[] = [
  { owner: 'Todd Ellis', pts: '1806.16' },
  { owner: 'AJ Boorde', pts: '1351.9' },
  { owner: 'Nixon Ball', pts: '1300' },
];

interface Harness {
  readonly collector: PictureCollector;
  readonly deps: PictureDeps;
  readonly chart: (args: Record<string, unknown>) => Promise<CallToolResult>;
  readonly table: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

function harness(over: Partial<PictureDeps> = {}): Harness {
  const collector = createCollector('AJ Boorde');
  const deps: PictureDeps = {
    runSql: jest.fn(async (): Promise<SqlResult> => ({ rows: ROWS, truncated: false })),
    renderSvg: jest.fn(async (): Promise<string> => '<svg/>'),
    rasterise: jest.fn(async (): Promise<Buffer | null> => Buffer.from('png-bytes')),
    owners: OWNERS,
    enabled: true,
    ...over,
  };
  const tools = createPictureTools(collector, deps);
  const call =
    (name: string) =>
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const tool = tools.find((t) => t.name === name);
      if (tool === undefined) throw new Error(`no tool ${name}`);
      return (await tool.handler(args as never, {} as never)) as CallToolResult;
    };
  return { collector, deps, chart: call('chart'), table: call('table') };
}

function text(result: CallToolResult): string {
  return result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

describe('the chart tool', () => {
  const request = {
    sql: 'SELECT owner, pts FROM t ORDER BY pts DESC',
    kind: 'bar',
    title: 'Points',
    x: 'owner',
    y: 'pts',
  };

  test('runs the SQL, draws the rows, and returns the token with the rows', async () => {
    const h = harness();
    const result = await h.chart(request);

    expect(result.isError).not.toBe(true);
    expect(h.deps.runSql).toHaveBeenCalledWith(request.sql);
    expect(h.collector.pictures).toHaveLength(1);
    const picture = h.collector.pictures[0];
    expect(picture.kind).toBe('bar');
    expect(picture.png.toString()).toBe('png-bytes');
    expect(picture.alt).toContain('Points');
    expect(text(result)).toContain(tokenFor(picture.id));
    expect(text(result)).toContain('end of the body');
    expect(text(result)).toContain(JSON.stringify(ROWS));
    expect(text(result)).toContain('"n":3');
  });

  test('a builder refusal comes back as a tool error naming the fallback, and draws nothing', async () => {
    const h = harness();
    const result = await h.chart({ ...request, sql: 'SELECT owner, pts FROM t' });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/ORDER BY/);
    expect(text(result)).toContain(FALLBACK);
    expect(h.deps.renderSvg).not.toHaveBeenCalled();
    expect(h.collector.pictures).toHaveLength(0);
  });

  test('a truncated result is refused', async () => {
    const h = harness({
      runSql: jest.fn(async (): Promise<SqlResult> => ({ rows: ROWS, truncated: true })),
    });
    const result = await h.chart(request);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(String(ASK.SQL_ROW_LIMIT));
  });

  test('the per-answer ceiling refuses before running any SQL', async () => {
    const h = harness();
    for (let i = 0; i < ASK.PICTURES.PER_ANSWER; i += 1) await h.chart(request);
    (h.deps.runSql as jest.Mock).mockClear();

    const result = await h.chart(request);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(String(ASK.PICTURES.PER_ANSWER));
    expect(h.deps.runSql).not.toHaveBeenCalled();
  });

  test('the switch refuses before running any SQL', async () => {
    const h = harness({ enabled: false });
    const result = await h.chart(request);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/switched off/);
    expect(h.deps.runSql).not.toHaveBeenCalled();
  });

  test('a host that cannot draw refuses with the fallback', async () => {
    const h = harness({ rasterise: jest.fn(async (): Promise<Buffer | null> => null) });
    const result = await h.chart(request);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(FALLBACK);
    expect(h.collector.pictures).toHaveLength(0);
  });

  test('a renderer that throws is a refusal, not a crash', async () => {
    const h = harness({
      renderSvg: jest.fn(async (): Promise<string> => {
        throw new Error('Pictures are unavailable on this host.');
      }),
    });
    const result = await h.chart(request);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('unavailable');
  });

  test("a refused statement is the sql engine's own refusal, thrown the way sql throws it", async () => {
    const h = harness({
      runSql: jest.fn(async (): Promise<SqlResult> => {
        throw new Error('Only read-only queries are allowed.');
      }),
    });
    await expect(h.chart({ ...request, sql: 'DELETE FROM t' })).rejects.toThrow(/read-only/);
  });
});

describe('the table tool', () => {
  test('draws the rows with the asker highlighted and returns the token with the rows', async () => {
    const h = harness();
    const result = await h.table({
      sql: 'SELECT owner, pts FROM t ORDER BY 2 DESC',
      title: 'Points',
    });

    expect(result.isError).not.toBe(true);
    expect(h.collector.pictures).toHaveLength(1);
    expect(h.collector.pictures[0].kind).toBe('table');
    // The grid goes straight to sharp; Vega is not involved.
    expect(h.deps.renderSvg).not.toHaveBeenCalled();
    const svg: string = (h.deps.rasterise as jest.Mock).mock.calls[0][0] as string;
    expect(svg).toContain('class="highlight"');
    expect(text(result)).toContain(tokenFor(h.collector.pictures[0].id));
    expect(text(result)).toContain(JSON.stringify(ROWS));
  });

  test('refuses past the column ceiling', async () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i <= ASK.PICTURES.COLUMNS_MAX; i += 1) wide[`c${i}`] = '1';
    const h = harness({
      runSql: jest.fn(async (): Promise<SqlResult> => ({ rows: [wide], truncated: false })),
    });
    const result = await h.table({ sql: 'SELECT 1', title: 'Wide' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(String(ASK.PICTURES.COLUMNS_MAX));
  });
});

describe('descriptions', () => {
  test('both tools state their ceilings from config and the fallback shape', () => {
    const tools = createPictureTools(createCollector('AJ Boorde'), harness().deps);
    const chart = tools.find((t) => t.name === 'chart');
    const table = tools.find((t) => t.name === 'table');
    if (chart === undefined || table === undefined) throw new Error('missing tool');

    expect(chart.description).toContain(String(ASK.PICTURES.REGRESSION_MIN_POINTS));
    expect(chart.description).toContain(String(ASK.PICTURES.ROWS_MAX));
    expect(chart.description).toMatch(/pie/i);
    expect(table.description).toContain(String(ASK.PICTURES.COLUMNS_MAX));
    expect(table.description).toContain(String(ASK.RANKING_MAX_LINES));
  });
});
