import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shred } from '../../wpfl/shredder.js';
import {
  guardStatement,
  runSql,
  tableNames,
  resetSqlDatabase,
  sqlTool,
  type SqlResult,
} from '../../wpfl/sqlTool.js';
import { ASK } from '../../ask/askConfig.js';

describe('sqlTool', () => {
  describe('the statement guard', () => {
    const allowed: string[] = [
      'SELECT 1',
      'select owner from teams',
      '  SELECT owner FROM teams  ',
      'SELECT owner FROM teams;',
      'SELECT owner FROM teams;   ',
      'WITH x AS (SELECT 1 AS n) SELECT n FROM x',
      '-- a comment first\nSELECT 1',
      '/* block comment */ SELECT 1',
      "SELECT * FROM wpfl_draft_history WHERE owner = 'AJ Boorde'",
      // The tool's own description tells the agent to run these.
      'DESCRIBE teams',
      'describe wpfl_player_scores',
      'SUMMARIZE teams',
    ];

    for (const statement of allowed) {
      test(`allows ${JSON.stringify(statement)}`, () => {
        expect(guardStatement(statement)).toBeNull();
      });
    }

    const rejected: [string, string][] = [
      ["COPY teams TO '/tmp/out.csv'", 'COPY'],
      ["ATTACH '/etc/passwd' AS x", 'ATTACH'],
      ['INSTALL httpfs', 'INSTALL'],
      ['LOAD httpfs', 'LOAD'],
      ['PRAGMA database_list', 'PRAGMA'],
      ['SET enable_external_access=true', 'SET'],
      ['CREATE TABLE x (a INT)', 'CREATE'],
      ['INSERT INTO teams VALUES (1)', 'INSERT'],
      ["UPDATE teams SET owner = 'x'", 'UPDATE'],
      ['DELETE FROM teams', 'DELETE'],
      ['DROP TABLE teams', 'DROP'],
      ['CALL pragma_version()', 'CALL'],
      ["EXPORT DATABASE '/tmp/x'", 'EXPORT'],
    ];

    for (const [statement, keyword] of rejected) {
      test(`rejects ${keyword}`, () => {
        expect(guardStatement(statement)).not.toBeNull();
      });
    }

    // DuckDB executes every statement it is given -- measured: running
    // "SELECT 1; DELETE FROM probe" emptied the table. So this rule is the
    // control, not a second layer of one.
    test('rejects a second statement hidden behind a SELECT', () => {
      expect(guardStatement('SELECT 1; DROP TABLE teams')).not.toBeNull();
      expect(guardStatement('SELECT 1; DELETE FROM teams')).not.toBeNull();
      expect(guardStatement('SELECT 1;SELECT 2')).not.toBeNull();
    });

    test('tolerates exactly one trailing semicolon and no more', () => {
      expect(guardStatement('SELECT 1;')).toBeNull();
      expect(guardStatement('SELECT 1;;')).not.toBeNull();
    });

    // The guard must reject statements, not text. A keyword inside a string
    // literal or an identifier is data.
    test('does not reject a keyword appearing inside a string literal', () => {
      expect(guardStatement("SELECT * FROM teams WHERE owner = 'Drop Table Guy'")).toBeNull();
      expect(guardStatement("SELECT 'copy that' AS note")).toBeNull();
      expect(guardStatement("SELECT * FROM t WHERE quip LIKE '%; DELETE FROM x%'")).toBeNull();
    });

    test('does not reject a column or alias whose name contains a keyword', () => {
      expect(guardStatement('SELECT dropped_players FROM teams')).toBeNull();
      expect(guardStatement('SELECT count(*) AS insertions FROM teams')).toBeNull();
      expect(guardStatement('SELECT setting FROM teams')).toBeNull();
    });

    test('rejects an empty or non-select statement outright', () => {
      expect(guardStatement('')).not.toBeNull();
      expect(guardStatement('   ')).not.toBeNull();
      expect(guardStatement('EXPLAIN SELECT 1')).not.toBeNull();
    });

    test('says what it wants, so the agent can correct itself', () => {
      expect(guardStatement('DROP TABLE teams')).toMatch(/SELECT|WITH/i);
    });
  });

  describe('running queries against a real shred', () => {
    let dataDir: string;

    beforeAll(() => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-sql-'));
      const artifact: unknown = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/postdraft-published.json'), 'utf8')
      );
      shred(artifact, dataDir);

      // A stand-in for the cached WPFL decade, so the cross-source join is real.
      fs.mkdirSync(path.join(dataDir, 'wpfl'), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'wpfl', 'draft_history.jsonl'),
        [
          '{"owner":"AJ Boorde","player":"CeeDee Lamb","season":2024,"auctionValue":75,"playerNflPosition":"WR"}',
          '{"owner":"Nixon Ball","player":"Ja\'Marr Chase","season":2024,"auctionValue":69,"playerNflPosition":"WR"}',
          '{"owner":"AJ Boorde","player":"Bijan Robinson","season":2023,"auctionValue":50,"playerNflPosition":"RB"}',
        ].join('\n') + '\n'
      );
      fs.writeFileSync(
        path.join(dataDir, 'wpfl', 'player_scores.jsonl'),
        [
          '{"owner":"AJ Boorde","player":"CeeDee Lamb","season":2024,"week":1,"points":21.4}',
          '{"owner":"AJ Boorde","player":"CeeDee Lamb","season":2024,"week":2,"points":11.5}',
          '{"owner":"Nixon Ball","player":"Ja\'Marr Chase","season":2024,"week":1,"points":30.2}',
        ].join('\n') + '\n'
      );
      resetSqlDatabase();
    });

    afterAll(() => {
      resetSqlDatabase();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('materializes a table per shred file plus the cached decade', async () => {
      const names: string[] = await tableNames(dataDir);

      expect(names).toContain('teams');
      expect(names).toContain('league_board');
      expect(names).toContain('league_dossiers');
      expect(names).toContain('history_seasons');
      expect(names).toContain('wpfl_draft_history');
      expect(names).toContain('wpfl_player_scores');
    });

    /**
     * The row cap is applied by wrapping the agent's statement in
     * `SELECT * FROM (...) LIMIT n`. Joined on one line, a statement ending in
     * a line comment swallowed the closing paren and the LIMIT:
     * `SELECT * FROM (SELECT 1 -- note) LIMIT 201` is
     * `Parser Error: syntax error at end of input` on DuckDB 1.5.5. Models end
     * SQL with a trailing comment all the time.
     */
    test('runs a statement that ends in a line comment', async () => {
      const result: SqlResult = await runSql(
        'SELECT owner FROM teams ORDER BY owner -- alphabetical',
        dataDir
      );

      expect(result.rows.length).toBeGreaterThan(0);
    });

    test('runs a statement whose last line is a comment after a newline', async () => {
      const result: SqlResult = await runSql('SELECT owner FROM teams\n-- trailing', dataDir);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    /**
     * The sql tool's description says "or DESCRIBE <table> for its columns".
     * The guard accepted only SELECT and WITH, so it refused the one thing the
     * description told the agent to reach for when it did not know a shape.
     */
    test('describes a table, which is what its own description promises', async () => {
      const result: SqlResult = await runSql('DESCRIBE teams', dataDir);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(Object.keys(result.rows[0])).toContain('column_name');
    });

    test('summarizes a table', async () => {
      const result: SqlResult = await runSql('SUMMARIZE teams', dataDir);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    test('still refuses to write, even spelled as a DESCRIBE-shaped statement', () => {
      expect(guardStatement('DESCRIBE teams; DROP TABLE teams')).not.toBeNull();
      expect(guardStatement('DELETE FROM teams')).not.toBeNull();
    });

    test('answers a plain query over the artifact', async () => {
      const result: SqlResult = await runSql('SELECT owner FROM teams ORDER BY owner', dataDir);

      expect(result.rows.map((r) => r.owner)).toEqual([
        'AJ Boorde',
        'David Evans',
        'Jimmy Simpson',
      ]);
      expect(result.truncated).toBe(false);
    });

    test('joins the artifact to the cached decade -- the reason this tool exists', async () => {
      const result: SqlResult = await runSql(
        `SELECT d.owner, d.player, d.auctionValue AS price, round(sum(p.points), 1) AS scored
         FROM wpfl_draft_history d
         JOIN wpfl_player_scores p ON p.player = d.player AND p.season = d.season
         WHERE d.playerNflPosition = 'WR'
         GROUP BY d.owner, d.player, d.auctionValue
         ORDER BY price DESC`,
        dataDir
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({ player: 'CeeDee Lamb', scored: 32.9 });
    });

    test('returns integers as JSON-safe values rather than throwing on BigInt', async () => {
      const result: SqlResult = await runSql('SELECT count(*) AS n FROM teams', dataDir);

      expect(() => JSON.stringify(result.rows)).not.toThrow();
      expect(String(result.rows[0].n)).toBe('3');
    });

    test('unwraps a nested struct instead of exposing DuckDB internals', async () => {
      const result: SqlResult = await runSql('SELECT owner, grade FROM teams LIMIT 1', dataDir);
      const grade = result.rows[0].grade as Record<string, unknown>;

      expect(grade).not.toHaveProperty('entries');
      expect(grade).toHaveProperty('letter');
    });

    test('caps the rows returned and says it truncated', async () => {
      const result: SqlResult = await runSql(
        `SELECT * FROM range(${ASK.SQL_ROW_LIMIT + 50})`,
        dataDir
      );

      expect(result.rows).toHaveLength(ASK.SQL_ROW_LIMIT);
      expect(result.truncated).toBe(true);
    });

    test('refuses a guarded statement without touching the database', async () => {
      await expect(runSql('DROP TABLE teams', dataDir)).rejects.toThrow(/SELECT|WITH/i);

      // Still there.
      const result: SqlResult = await runSql('SELECT count(*) AS n FROM teams', dataDir);
      expect(String(result.rows[0].n)).toBe('3');
    });

    describe('lockdown', () => {
      test('cannot read a file off the disk', async () => {
        await expect(
          runSql("SELECT * FROM read_json_auto('/etc/passwd')", dataDir)
        ).rejects.toThrow(/disabled|permission/i);
      });

      test('cannot glob the filesystem', async () => {
        await expect(runSql("SELECT * FROM glob('/etc/*')", dataDir)).rejects.toThrow(
          /disabled|permission/i
        );
      });

      test('cannot re-enable external access through a subquery', async () => {
        await expect(runSql("SELECT * FROM read_text('/etc/hostname')", dataDir)).rejects.toThrow(
          /disabled|permission/i
        );
      });
    });
  });

  describe('the guard and the description agree', () => {
    test('every statement the tool description promises, the guard actually allows', () => {
      // This exact mismatch shipped: the description told the agent to reach
      // for DESCRIBE when it did not know a table's shape, while the guard's
      // regex accepted only SELECT and WITH and refused it. The two lists are
      // now generated from one declaration; this asserts they stay agreed.
      const described: string = sqlTool.description ?? '';
      const clause = /must start with ([^;]+);/.exec(described);
      expect(clause).not.toBeNull();

      const promised: string[] = (clause as RegExpExecArray)[1]
        .split(/,| or /)
        .map((word: string): string => word.trim())
        .filter((word: string): boolean => word !== '');

      expect(promised.length).toBeGreaterThan(1);
      for (const starter of promised) {
        expect(guardStatement(`${starter} teams`)).toBeNull();
      }
    });

    test('a statement starting with something no list mentions is refused', () => {
      expect(guardStatement('EXPLAIN SELECT 1')).toMatch(/Only read-only queries/);
    });
  });

  describe('when the materialized database is rebuilt', () => {
    let dataDir: string;

    beforeAll(() => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-sql-stamp-'));
      fs.writeFileSync(path.join(dataDir, 'meta.json'), '{"season":2026}');
      fs.writeFileSync(path.join(dataDir, 'alpha.json'), '{"n":1}');
      fs.writeFileSync(path.join(dataDir, 'INDEX.md'), '# index\n');
      resetSqlDatabase();
    });

    afterAll(() => {
      resetSqlDatabase();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('touching INDEX.md does not throw the database away', async () => {
      // artifactSync touches INDEX.md on the `unchanged` path, to restart the
      // staleness window without re-fetching. Keying the cache on that mtime
      // meant a sync which had just concluded nothing changed discarded ~11 MB
      // of materialized database, and the next question rebuilt it inside a
      // member's turn. Deleting the source proves the answer came from the
      // cache and not from a rebuild.
      // Integers come back as strings; getRowObjectsJson keeps full precision.
      expect((await runSql('SELECT n FROM alpha', dataDir)).rows).toEqual([{ n: '1' }]);

      fs.rmSync(path.join(dataDir, 'alpha.json'));
      const later = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(dataDir, 'INDEX.md'), later, later);

      expect((await runSql('SELECT n FROM alpha', dataDir)).rows).toEqual([{ n: '1' }]);
    });

    test('a real shred, which rewrites meta.json, does rebuild it', async () => {
      const later = new Date(Date.now() + 120_000);
      fs.utimesSync(path.join(dataDir, 'meta.json'), later, later);

      await expect(runSql('SELECT n FROM alpha', dataDir)).rejects.toThrow(/alpha/);
    });
  });

  describe('the MCP tool definition', () => {
    test('is named sql and always rides in the initial prompt', () => {
      expect(sqlTool.name).toBe('sql');
      expect(sqlTool._meta?.['anthropic/alwaysLoad']).toBe(true);
    });

    test('the description lists the tables, so the agent never guesses a name', () => {
      expect(sqlTool.description).toContain('wpfl_draft_history');
      expect(sqlTool.description).toContain('wpfl_player_scores');
      expect(sqlTool.description).toContain('teams');
    });

    test('the description says the decade is here and the artifact is not the whole story', () => {
      expect(sqlTool.description).toMatch(/read-only|SELECT/i);
    });
  });

  /**
   * The connection owns a native DuckDB instance holding the whole
   * materialized dataset, so a rebuild has to close the one it replaces. It
   * used to close it on the spot, which is `closeSync()` under whatever query
   * happened to be running when somebody else's question triggered a reshred.
   *
   * Measured against DuckDB 1.5.5: that does not throw and does not reject --
   * the in-flight query's promise never settles at all, `interrupt()` on the
   * closed connection does not rescue it, and the stranded native thread goes
   * on to block process exit. In the bot that is a member's question wedged
   * until QUERY_TIMEOUT_MS, holding one of the two concurrency slots the whole
   * time.
   */
  describe('when a rebuild lands during a query', () => {
    let dataDir: string;

    beforeAll(() => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-sql-race-'));
      fs.writeFileSync(path.join(dataDir, 'meta.json'), '{"season":2026}');
      fs.writeFileSync(path.join(dataDir, 'alpha.json'), '{"n":1}');
      resetSqlDatabase();
    });

    afterAll(() => {
      resetSqlDatabase();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('the query in flight keeps the connection it is reading through', async () => {
      expect((await runSql('SELECT n FROM alpha', dataDir)).rows).toEqual([{ n: '1' }]);

      const order: string[] = [];
      // ~340 ms of real work on a DuckDB background thread, against a rebuild
      // of this two-file directory that measures ~15 ms. The margin is what
      // keeps the overlap below reliable rather than lucky.
      const inFlight: Promise<SqlResult> = runSql(
        'SELECT count(*) AS c FROM range(2000000000)',
        dataDir
      ).then((result: SqlResult): SqlResult => {
        order.push('query');
        return result;
      });

      // Somebody else's question reshreds: meta.json's mtime moves, so the
      // next caller materializes a new database and retires this one.
      const later = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(dataDir, 'meta.json'), later, later);
      await tableNames(dataDir);
      order.push('rebuild');

      expect((await inFlight).rows).toEqual([{ c: '2000000000' }]);
      // Not vacuous: the rebuild really did land while the query was running.
      expect(order).toEqual(['rebuild', 'query']);
    }, 20_000);
  });
});
