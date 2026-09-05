import { describe, test, expect } from '@jest/globals';
import { buildTable, type TableInput } from '../../pictures/tableSvg.js';
import { FALLBACK } from '../../pictures/shared.js';
import { ASK } from '../../ask/askConfig.js';
import { OWNERS, refusalOf, valueOf } from './fixtures.js';

function rows(count: number = 4): Record<string, unknown>[] {
  return OWNERS.slice(0, count).map(
    (owner: string, i: number): Record<string, unknown> => ({
      owner,
      'avg $': String(21.2 - i * 3),
      titles: String(3 - i),
    })
  );
}

function input(over: Partial<TableInput> = {}): TableInput {
  return {
    title: 'QB spend by owner',
    rows: rows(),
    highlight: 'AJ Boorde',
    owners: OWNERS,
    ...over,
  };
}

describe('buildTable', () => {
  test('draws a header from the aliases and one row per result row, in order', () => {
    const svg: string = valueOf(buildTable(input()));

    expect(svg.startsWith('<svg')).toBe(true);
    for (const header of ['owner', 'avg $', 'titles']) expect(svg).toContain(`>${header}<`);
    expect(svg.indexOf('Nixon Ball')).toBeLessThan(svg.indexOf('Forrest Britton'));
    expect(svg.indexOf('Forrest Britton')).toBeLessThan(svg.indexOf('AJ Boorde'));
  });

  test('formats numbers with grouping and at most two decimals, never truncating them', () => {
    const svg: string = valueOf(
      buildTable(input({ rows: [{ owner: 'AJ Boorde', pts: '1806.164', n: '138' }] }))
    );
    expect(svg).toContain('>1,806.16<');
    expect(svg).toContain('>138<');
  });

  test('right-aligns numeric columns and left-aligns text', () => {
    const svg: string = valueOf(buildTable(input()));
    const cell = (text: string): string =>
      svg.slice(svg.lastIndexOf('<text', svg.indexOf(`>${text}<`)), svg.indexOf(`>${text}<`));
    expect(cell('Nixon Ball')).toContain('text-anchor="start"');
    expect(cell('21.2')).toContain('text-anchor="end"');
  });

  test('highlights the asker when exactly one column holds owner names and one row is theirs', () => {
    const svg: string = valueOf(buildTable(input()));
    expect(svg).toContain('class="highlight"');
    expect((svg.match(/class="highlight"/g) ?? []).length).toBe(1);
  });

  test('does not highlight when the asker is absent, appears twice, or two columns hold owners', () => {
    expect(valueOf(buildTable(input({ highlight: 'Doug Black' })))).not.toContain('highlight');

    const twice = [...rows(2), { owner: 'AJ Boorde', 'avg $': '1', titles: '0' }, rows(3)[2]];
    expect(valueOf(buildTable(input({ rows: twice })))).not.toContain('highlight');

    const matchups = [{ winner: 'AJ Boorde', loser: 'Todd Ellis', margin: '4.8' }];
    expect(valueOf(buildTable(input({ rows: matchups })))).not.toContain('highlight');
  });

  test('cuts a long text cell with an ellipsis and escapes markup', () => {
    const long = 'x'.repeat(ASK.PICTURES.LABEL_MAX_CHARS + 5);
    const svg: string = valueOf(
      buildTable(input({ rows: [{ owner: long, note: '<b>&"', pts: '1' }] }))
    );
    expect(svg).toContain('…');
    expect(svg).not.toContain(long);
    expect(svg).toContain('&lt;b&gt;&amp;&quot;');
  });

  test('grows past the design width to fit its columns, up to the table ceiling', () => {
    const narrow = valueOf(buildTable(input()));
    expect(narrow).toContain(`width="${ASK.PICTURES.WIDTH}"`);

    const wide = valueOf(
      buildTable(
        input({
          rows: [
            {
              owner: 'Forrest Britton',
              'first alias here': '1000000.5',
              'second alias xx': '1000000.5',
              'third alias xxx': '1000000.5',
            },
          ],
        })
      )
    );
    const width: number = Number(/width="(\d+)"/.exec(wide)?.[1]);
    expect(width).toBeGreaterThan(ASK.PICTURES.WIDTH);
    expect(width).toBeLessThanOrEqual(ASK.PICTURES.TABLE_MAX_WIDTH);
  });

  describe('refusals, each naming the fallback', () => {
    test('no rows', () => {
      const text = refusalOf(buildTable(input({ rows: [] })));
      expect(text).toMatch(/no rows/i);
      expect(text).toContain(FALLBACK);
    });

    test('too many rows, too many columns', () => {
      const tall = Array.from({ length: ASK.PICTURES.ROWS_MAX + 1 }, (_, i) => ({
        owner: `o${i}`,
        n: '1',
      }));
      expect(refusalOf(buildTable(input({ rows: tall })))).toContain(String(ASK.PICTURES.ROWS_MAX));

      const wide: Record<string, unknown> = { owner: 'AJ Boorde' };
      for (let i = 0; i < ASK.PICTURES.COLUMNS_MAX; i += 1) wide[`c${i}`] = '1';
      expect(refusalOf(buildTable(input({ rows: [wide] })))).toContain(
        String(ASK.PICTURES.COLUMNS_MAX)
      );
    });

    test('a long alias and a long title', () => {
      const alias = 'a'.repeat(ASK.PICTURES.ALIAS_MAX_CHARS + 1);
      expect(refusalOf(buildTable(input({ rows: [{ [alias]: '1' }] })))).toMatch(/alias/i);
      expect(
        refusalOf(buildTable(input({ title: 't'.repeat(ASK.PICTURES.TITLE_MAX_CHARS + 1) })))
      ).toMatch(/title/i);
    });

    test('a table wider than the ceiling', () => {
      const row: Record<string, unknown> = {};
      for (let i = 0; i < ASK.PICTURES.COLUMNS_MAX; i += 1) {
        row[`alias number ${i}xx`] = 'x'.repeat(ASK.PICTURES.LABEL_MAX_CHARS);
      }
      expect(refusalOf(buildTable(input({ rows: [row] })))).toMatch(/wide/i);
    });
  });
});
