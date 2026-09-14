import { describe, test, expect } from '@jest/globals';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import {
  LIVE_TABLES,
  LIVE_TABLE_NAMES,
  columnsProse,
  createLiveStore,
  freeAgentRows,
  isLiveTableName,
  lineupRows,
  matchupRows,
  materializeLive,
  rosterRows,
  standingsRows,
  tablesFilledBy,
  transactionRows,
  type LiveStore,
  type LiveTableName,
  type Row,
} from '../../wpfl/liveTables.js';
import { toBoxscores, toFreeAgents, toTeams, toTransactions } from '../../wpfl/espnTools.js';
import { loadFixture } from './support.js';

/**
 * The season in progress as SQL tables for one run: the ESPN tools fill a
 * store, and every query creates the filled tables as temp tables on its own
 * connection (wpfl/liveTables.ts). These cover the store's two fill rules,
 * the flatteners against the recorded ESPN fixtures, and the materializer
 * against the real engine.
 */
describe('liveTables', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams = toTeams(loadFixture<any[]>('espn-teams.json'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchups = toBoxscores(loadFixture<any[]>('espn-boxscores.json'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agents = toFreeAgents(loadFixture<any[]>('espn-free-agents.json'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moves = toTransactions(loadFixture<any[][]>('espn-transactions.json'));

  const columnsOf = (name: LiveTableName): string[] => Object.keys(LIVE_TABLES[name].columns);

  describe('the declaration', () => {
    test('names seven tables, each owned by one tool', () => {
      expect(LIVE_TABLE_NAMES).toEqual([
        'live_matchups',
        'live_lineups',
        'live_standings',
        'live_rosters',
        'live_free_agents',
        'live_transactions',
        'live_lines',
      ]);
      expect(tablesFilledBy('espn_boxscores')).toEqual(['live_matchups', 'live_lineups']);
      expect(tablesFilledBy('espn_teams')).toEqual(['live_standings', 'live_rosters']);
      expect(tablesFilledBy('espn_free_agents')).toEqual(['live_free_agents']);
      expect(tablesFilledBy('espn_transactions')).toEqual(['live_transactions']);
      expect(tablesFilledBy('polymarket_lines')).toEqual(['live_lines']);
    });

    test('only the week-shaped tables are keyed by week', () => {
      expect(LIVE_TABLE_NAMES.filter((name) => LIVE_TABLES[name].byWeek)).toEqual([
        'live_matchups',
        'live_lineups',
        'live_lines',
      ]);
    });

    test('recognises its own names and nothing else', () => {
      expect(isLiveTableName('live_matchups')).toBe(true);
      expect(isLiveTableName('live_scores')).toBe(false);
      expect(isLiveTableName('teams')).toBe(false);
    });

    test('spells the columns for a description in table order', () => {
      expect(columnsProse('live_matchups')).toBe(
        'week, owner, opponent, home, score, opponent_score, projected, opponent_projected, win_prob, decided, result, pending_starters, pending_projected, optimal_points, points_left'
      );
    });
  });

  describe('the store', () => {
    test('starts empty and reports what was filled in declaration order', () => {
      const store: LiveStore = createLiveStore();
      expect(store.filled()).toEqual([]);

      store.replace('live_transactions', [{ action: 'x' }]);
      store.replaceWeek('live_matchups', 1, [{ week: 1 }]);
      store.replace('live_standings', []);

      expect(store.filled().map((t) => t.name)).toEqual([
        'live_matchups',
        'live_standings',
        'live_transactions',
      ]);
      expect(store.has('live_standings')).toBe(true);
      expect(store.has('live_rosters')).toBe(false);
    });

    test('a fetch replaces a table that is not keyed by week', () => {
      const store: LiveStore = createLiveStore();
      store.replace('live_rosters', [{ player: 'a' }, { player: 'b' }]);
      store.replace('live_rosters', [{ player: 'c' }]);

      expect(store.filled()[0].rows).toEqual([{ player: 'c' }]);
    });

    // Week 1 and week 2 boxscores in one run must both be queryable, and a
    // second fetch of week 1 must not double it.
    test('a week replaces its own rows and keeps the other weeks', () => {
      const store: LiveStore = createLiveStore();
      store.replaceWeek('live_lineups', 1, [{ week: 1, player: 'a' }]);
      store.replaceWeek('live_lineups', 2, [{ week: 2, player: 'b' }]);
      store.replaceWeek('live_lineups', 1, [{ week: 1, player: 'c' }]);

      expect(store.filled()[0].rows).toEqual([
        { week: 1, player: 'c' },
        { week: 2, player: 'b' },
      ]);
    });

    test('refuses the wrong fill for the table shape, so a caller cannot lose a week silently', () => {
      const store: LiveStore = createLiveStore();
      expect(() => store.replace('live_matchups', [])).toThrow(/keyed by week/);
      expect(() => store.replaceWeek('live_standings', 1, [])).toThrow(/not keyed by week/);
    });
  });

  describe('the flatteners', () => {
    const shaped = (rows: Row[], name: LiveTableName): void => {
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(Object.keys(row)).toEqual(columnsOf(name));
    };

    test('every flattener writes exactly the declared columns, in order', () => {
      shaped(standingsRows(teams), 'live_standings');
      shaped(rosterRows(teams), 'live_rosters');
      shaped(matchupRows(1, matchups), 'live_matchups');
      shaped(lineupRows(1, matchups), 'live_lineups');
      shaped(freeAgentRows(agents), 'live_free_agents');
      shaped(transactionRows(moves), 'live_transactions');
    });

    test('a matchup is two rows, one per side, each the mirror of the other', () => {
      const rows: Row[] = matchupRows(4, matchups);

      expect(rows).toHaveLength(matchups.length * 2);
      const [home, away] = rows;
      expect(home).toMatchObject({
        week: 4,
        owner: 'Mike Simpson',
        opponent: 'Nixon Ball',
        home: true,
      });
      expect(away).toMatchObject({
        week: 4,
        owner: 'Nixon Ball',
        opponent: 'Mike Simpson',
        home: false,
      });
      expect(away.projected).toBe(home.opponent_projected);
      expect(away.opponent_projected).toBe(home.projected);
      expect(away.score).toBe(home.opponent_score);
    });

    test('a bye is one row with no opponent, so the owner still appears for the week', () => {
      const bye = { ...matchups[0], awayOwner: null, awayScore: null, away: [] };
      const rows: Row[] = matchupRows(1, [bye]);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ owner: 'Mike Simpson', opponent: null, home: true });
      expect(lineupRows(1, [bye])).toHaveLength(bye.home.length);
    });

    test('a lineup row names the owner whose lineup it is, the slot and the position both, and the game status', () => {
      const rows: Row[] = lineupRows(1, matchups);

      expect(rows).toHaveLength(
        matchups.reduce((n: number, m): number => n + m.home.length + m.away.length, 0)
      );
      expect(rows[0]).toMatchObject({
        week: 1,
        owner: 'Mike Simpson',
        player: 'Puka Nacua',
        slot: 'WR',
        position: 'WR',
        injury_status: 'QUESTIONABLE',
        projected: 17.38,
        // No schedule was passed to toBoxscores, so the status is unknown, not final.
        game_status: 'unknown',
      });
    });

    test('a matchup row carries whether it is decided, the result, who is still to play and the optimal figure', () => {
      const [home, away] = matchupRows(1, matchups);
      const [matchup] = matchups;

      expect(home).toMatchObject({
        decided: matchup.decided,
        result: matchup.homeResult,
        pending_starters: matchup.homePendingStarters,
        pending_projected: matchup.homePendingProjected,
        optimal_points: matchup.homeOptimalPoints,
        points_left: matchup.homePointsLeft,
      });
      expect(away).toMatchObject({
        decided: matchup.decided,
        result: matchup.awayResult,
        pending_starters: matchup.awayPendingStarters,
        optimal_points: matchup.awayOptimalPoints,
        points_left: matchup.awayPointsLeft,
      });
    });

    test('standings and rosters carry the owner so both join on it', () => {
      expect(standingsRows(teams)[0]).toMatchObject({
        owner: 'Nixon Ball',
        espn_id: 1,
        wins: 0,
        playoff_seed: 14,
      });
      expect(rosterRows(teams)[0]).toMatchObject({
        owner: 'Nixon Ball',
        player: 'Jeremiyah Love',
        position: 'RB',
        nfl_team: 'ARI',
        injury_status: 'QUESTIONABLE',
        percent_owned: 99.35,
      });
    });

    test('free agents and transactions keep the fields a waiver question sorts on', () => {
      expect(Object.keys(freeAgentRows(agents)[0])).toContain('percent_owned');
      expect(freeAgentRows(agents)[0].injured).toEqual(expect.any(Boolean));
      expect(transactionRows(moves)[0]).toMatchObject({
        date: '2026-08-31 14:34 EDT',
        action: 'FA ADDED',
        owner: 'Jimmy Simpson',
        to_owner: 'Jimmy Simpson',
        player: 'Jaylen Wright',
        bid_amount: 0,
      });
    });
  });

  /**
   * Against the real engine, locked the way sqlTool locks it: the filled
   * tables arrive typed, an empty one keeps its columns, and a second
   * connection on the same instance cannot see them.
   */
  describe('materializing', () => {
    const locked = async (): Promise<DuckDBInstance> => {
      const instance = await DuckDBInstance.create(':memory:');
      const setup: DuckDBConnection = await instance.connect();
      await setup.run(
        `CREATE TABLE teams AS SELECT * FROM (VALUES ('Mike Simpson', 200), ('Nixon Ball', 199)) t(owner, spent)`
      );
      await setup.run('SET enable_external_access=false');
      await setup.run('SET lock_configuration=true');
      setup.closeSync();
      return instance;
    };

    test('creates the filled tables typed, with nulls kept, and joinable to the catalogue', async () => {
      const instance = await locked();
      const connection: DuckDBConnection = await instance.connect();
      try {
        const store: LiveStore = createLiveStore();
        store.replaceWeek('live_matchups', 1, matchupRows(1, matchups));
        store.replace('live_transactions', []);
        await materializeLive(connection, store);

        const described = await connection.runAndReadAll('DESCRIBE live_matchups');
        expect(described.getRowObjectsJson().map((r) => [r.column_name, r.column_type])).toEqual(
          Object.entries(LIVE_TABLES.live_matchups.columns).map(([c, t]) => [c, t])
        );

        const joined = await connection.runAndReadAll(
          'SELECT m.owner, t.spent, m.home FROM live_matchups m JOIN teams t USING (owner) ORDER BY m.owner'
        );
        expect(joined.getRowObjectsJson()).toEqual([
          { owner: 'Mike Simpson', spent: 200, home: true },
          { owner: 'Nixon Ball', spent: 199, home: false },
        ]);

        const empty = await connection.runAndReadAll(
          'SELECT count(*) AS n, max(bid_amount) AS top FROM live_transactions'
        );
        expect(empty.getRowObjectsJson()).toEqual([{ n: '0', top: null }]);

        // The recorded slate is pre-kickoff: ESPN had no projection for it.
        const nulls = await connection.runAndReadAll(
          'SELECT count(*) AS n FROM live_matchups WHERE projected IS NULL'
        );
        expect(Number(nulls.getRowObjectsJson()[0].n)).toBeGreaterThanOrEqual(0);
      } finally {
        connection.closeSync();
        instance.closeSync();
      }
    });

    test('creates nothing for a table the run never filled', async () => {
      const instance = await locked();
      const connection: DuckDBConnection = await instance.connect();
      try {
        await materializeLive(connection, createLiveStore());
        await expect(connection.runAndReadAll('SELECT * FROM live_matchups')).rejects.toThrow(
          /does not exist/
        );
      } finally {
        connection.closeSync();
        instance.closeSync();
      }
    });

    test('a table is visible only to the connection that created it', async () => {
      const instance = await locked();
      const first: DuckDBConnection = await instance.connect();
      const second: DuckDBConnection = await instance.connect();
      try {
        const store: LiveStore = createLiveStore();
        store.replace('live_standings', standingsRows(teams));
        await materializeLive(first, store);

        expect(
          (
            await first.runAndReadAll('SELECT count(*) AS n FROM live_standings')
          ).getRowObjectsJson()
        ).toEqual([{ n: String(teams.length) }]);
        await expect(second.runAndReadAll('SELECT * FROM live_standings')).rejects.toThrow(
          /does not exist/
        );
      } finally {
        first.closeSync();
        second.closeSync();
        instance.closeSync();
      }
    });

    test('a value with a quote in it rides through as data, not as SQL', async () => {
      const instance = await locked();
      const connection: DuckDBConnection = await instance.connect();
      try {
        const store: LiveStore = createLiveStore();
        store.replace('live_free_agents', [
          {
            player: "Ja'Marr O'Brien",
            position: 'WR',
            nfl_team: 'CIN',
            percent_owned: 50.5,
            percent_change: -1.25,
            auction_value_avg: null,
            injured: false,
          },
        ]);
        await materializeLive(connection, store);

        const rows = await connection.runAndReadAll(
          'SELECT player, auction_value_avg FROM live_free_agents'
        );
        expect(rows.getRowObjectsJson()).toEqual([
          { player: "Ja'Marr O'Brien", auction_value_avg: null },
        ]);
      } finally {
        connection.closeSync();
        instance.closeSync();
      }
    });
  });
});
