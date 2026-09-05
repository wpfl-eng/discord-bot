/**
 * The season in progress as SQL tables, for one run.
 *
 * The `sql` database is built once per shred from files, and the picture
 * tools accept only SQL, so nothing an `espn_*` tool returned could be joined
 * to the artifact or drawn: on the week of the first live matchup question,
 * every picture of ESPN's own projections was impossible, and the one way to
 * make one was to retype the figures into a literal, which the picture rule
 * forbids. Each ESPN tool now also writes its rows, flattened, into a store
 * that lives exactly as long as the run; every `sql`, `chart` and `table`
 * call creates the filled tables as temp tables on its own connection first.
 *
 * Verified on DuckDB 1.5.5: a temp table is visible only to the connection
 * that created it, and creating one is allowed after `lock_configuration`.
 * Two runs in flight therefore never see each other's rows, and the shared
 * materialized database is never written.
 *
 * The store is filled from the *whole* fetch, before the tool's owner filter
 * is applied to what the model reads: both ESPN tools fetch the league and
 * filter afterwards, so this costs nothing and a "rank the league" over a
 * live table is never a two-row ranking because the model asked about two.
 *
 * A table exists only once its tool has run this run. A query that names one
 * earlier gets the engine's missing-table error, rewritten in sqlTool.ts to
 * name the tool that fills it. A thread follow-up is a new run with an empty
 * store, which is right: live scores change during games.
 */

import type { DuckDBConnection } from '@duckdb/node-api';
import type {
  FreeAgentSummary,
  LineupEntry,
  MatchupSummary,
  RosterEntry,
  TeamSummary,
  TransactionSummary,
} from './espnTools.js';

export type Row = Record<string, unknown>;

export type LiveColumnType = 'INTEGER' | 'DOUBLE' | 'VARCHAR' | 'BOOLEAN';

export interface LiveTable {
  /** Column name to DuckDB type, in table order; also the `from_json` structure. */
  readonly columns: Readonly<Record<string, LiveColumnType>>;
  /** The tool whose call fills it, named in the missing-table error. */
  readonly tool: string;
  /** Rows for one week replace that week's; otherwise a fetch replaces the table. */
  readonly byWeek: boolean;
}

/**
 * The six tables, declared once. The description of each ESPN tool, the
 * missing-table error, INDEX.md's routing row and the materializer all read
 * this, so a renamed column cannot leave one of them behind.
 */
export const LIVE_TABLES = {
  /** One row per side per week, so it joins to `teams` and the decade on owner. */
  live_matchups: {
    columns: {
      week: 'INTEGER',
      owner: 'VARCHAR',
      opponent: 'VARCHAR',
      home: 'BOOLEAN',
      score: 'DOUBLE',
      opponent_score: 'DOUBLE',
      projected: 'DOUBLE',
      opponent_projected: 'DOUBLE',
      win_prob: 'DOUBLE',
    },
    tool: 'espn_boxscores',
    byWeek: true,
  },
  /** One row per player per side per week; `slot` is the lineup slot, not the position. */
  live_lineups: {
    columns: {
      week: 'INTEGER',
      owner: 'VARCHAR',
      player: 'VARCHAR',
      slot: 'VARCHAR',
      points: 'DOUBLE',
      projected: 'DOUBLE',
      injury_status: 'VARCHAR',
    },
    tool: 'espn_boxscores',
    byWeek: true,
  },
  live_standings: {
    columns: {
      owner: 'VARCHAR',
      espn_id: 'INTEGER',
      wins: 'INTEGER',
      losses: 'INTEGER',
      ties: 'INTEGER',
      playoff_seed: 'INTEGER',
      points_for: 'DOUBLE',
      points_against: 'DOUBLE',
    },
    tool: 'espn_teams',
    byWeek: false,
  },
  live_rosters: {
    columns: {
      owner: 'VARCHAR',
      player: 'VARCHAR',
      position: 'VARCHAR',
      nfl_team: 'VARCHAR',
      injury_status: 'VARCHAR',
      percent_owned: 'DOUBLE',
    },
    tool: 'espn_teams',
    byWeek: false,
  },
  live_free_agents: {
    columns: {
      player: 'VARCHAR',
      position: 'VARCHAR',
      nfl_team: 'VARCHAR',
      percent_owned: 'DOUBLE',
      percent_change: 'DOUBLE',
      auction_value_avg: 'DOUBLE',
      injured: 'BOOLEAN',
    },
    tool: 'espn_free_agents',
    byWeek: false,
  },
  live_transactions: {
    columns: {
      date: 'VARCHAR',
      action: 'VARCHAR',
      owner: 'VARCHAR',
      to_owner: 'VARCHAR',
      player: 'VARCHAR',
      bid_amount: 'INTEGER',
    },
    tool: 'espn_transactions',
    byWeek: false,
  },
} as const satisfies Record<string, LiveTable>;

export type LiveTableName = keyof typeof LIVE_TABLES;

export const LIVE_TABLE_NAMES: readonly LiveTableName[] = Object.keys(
  LIVE_TABLES
) as LiveTableName[];

export function isLiveTableName(name: string): name is LiveTableName {
  return Object.prototype.hasOwnProperty.call(LIVE_TABLES, name);
}

/** The tables a tool fills, for its description and the routing row. */
export function tablesFilledBy(tool: string): LiveTableName[] {
  return LIVE_TABLE_NAMES.filter((name: LiveTableName): boolean => LIVE_TABLES[name].tool === tool);
}

/** `owner, opponent, home, ...` for a description. */
export function columnsProse(name: LiveTableName): string {
  return Object.keys(LIVE_TABLES[name].columns).join(', ');
}

export interface FilledTable {
  readonly name: LiveTableName;
  readonly rows: readonly Row[];
}

export interface LiveStore {
  /** Replace the table's rows. For a table keyed by week, use `replaceWeek`. */
  replace(table: LiveTableName, rows: readonly Row[]): void;
  /** Replace one week's rows and keep the other weeks'. */
  replaceWeek(table: LiveTableName, week: number, rows: readonly Row[]): void;
  has(table: LiveTableName): boolean;
  /** Every table filled this run, in declaration order, each with all its rows. */
  filled(): FilledTable[];
}

export function createLiveStore(): LiveStore {
  // Table -> partition key -> rows. The key is the week for a table keyed by
  // week and a single fixed key otherwise, so both shapes are one structure.
  const tables = new Map<LiveTableName, Map<string, readonly Row[]>>();
  const WHOLE = '*';

  function partitions(table: LiveTableName): Map<string, readonly Row[]> {
    let existing: Map<string, readonly Row[]> | undefined = tables.get(table);
    if (existing === undefined) {
      existing = new Map();
      tables.set(table, existing);
    }
    return existing;
  }

  return {
    replace(table: LiveTableName, rows: readonly Row[]): void {
      if (LIVE_TABLES[table].byWeek) {
        throw new Error(`${table} is keyed by week; use replaceWeek.`);
      }
      tables.set(table, new Map([[WHOLE, rows]]));
    },
    replaceWeek(table: LiveTableName, week: number, rows: readonly Row[]): void {
      if (!LIVE_TABLES[table].byWeek) {
        throw new Error(`${table} is not keyed by week; use replace.`);
      }
      partitions(table).set(String(week), rows);
    },
    has(table: LiveTableName): boolean {
      return tables.has(table);
    },
    filled(): FilledTable[] {
      return LIVE_TABLE_NAMES.filter((name: LiveTableName): boolean => tables.has(name)).map(
        (name: LiveTableName): FilledTable => ({
          name,
          rows: [...(tables.get(name) ?? new Map<string, readonly Row[]>()).values()].flat(),
        })
      );
    },
  };
}

// ---- flatteners: one ESPN summary in, rows in the declared columns out ----

export function standingsRows(teams: readonly TeamSummary[]): Row[] {
  return teams.map(
    (team: TeamSummary): Row => ({
      owner: team.owner,
      espn_id: team.espnId,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      playoff_seed: team.playoffSeed,
      points_for: team.pointsFor,
      points_against: team.pointsAgainst,
    })
  );
}

export function rosterRows(teams: readonly TeamSummary[]): Row[] {
  return teams.flatMap((team: TeamSummary): Row[] =>
    team.roster.map(
      (entry: RosterEntry): Row => ({
        owner: team.owner,
        player: entry.name,
        position: entry.position,
        nfl_team: entry.proTeam,
        injury_status: entry.injuryStatus,
        percent_owned: entry.percentOwned,
      })
    )
  );
}

/**
 * One row per side. A matchup with no away team (a bye) is one row with a
 * null opponent, so the owner still appears for the week.
 */
export function matchupRows(week: number, matchups: readonly MatchupSummary[]): Row[] {
  return matchups.flatMap((matchup: MatchupSummary): Row[] => {
    const home: Row = {
      week,
      owner: matchup.homeOwner,
      opponent: matchup.awayOwner,
      home: true,
      score: matchup.homeScore,
      opponent_score: matchup.awayScore,
      projected: matchup.homeProjected,
      opponent_projected: matchup.awayProjected,
      win_prob: matchup.homeWinProbability,
    };
    if (matchup.awayOwner === null) return [home];
    const away: Row = {
      week,
      owner: matchup.awayOwner,
      opponent: matchup.homeOwner,
      home: false,
      score: matchup.awayScore,
      opponent_score: matchup.homeScore,
      projected: matchup.awayProjected,
      opponent_projected: matchup.homeProjected,
      win_prob: matchup.awayWinProbability,
    };
    return [home, away];
  });
}

export function lineupRows(week: number, matchups: readonly MatchupSummary[]): Row[] {
  const side = (owner: string | null, lineup: readonly LineupEntry[]): Row[] =>
    owner === null
      ? []
      : lineup.map(
          (entry: LineupEntry): Row => ({
            week,
            owner,
            player: entry.name,
            slot: entry.position,
            points: entry.points,
            projected: entry.projected,
            injury_status: entry.injuryStatus,
          })
        );
  return matchups.flatMap((matchup: MatchupSummary): Row[] => [
    ...side(matchup.homeOwner, matchup.home),
    ...side(matchup.awayOwner, matchup.away),
  ]);
}

export function freeAgentRows(agents: readonly FreeAgentSummary[]): Row[] {
  return agents.map(
    (agent: FreeAgentSummary): Row => ({
      player: agent.name,
      position: agent.position,
      nfl_team: agent.proTeam,
      percent_owned: agent.percentOwned,
      percent_change: agent.percentChange,
      auction_value_avg: agent.auctionValueAverage,
      injured: agent.isInjured,
    })
  );
}

export function transactionRows(moves: readonly TransactionSummary[]): Row[] {
  return moves.map(
    (move: TransactionSummary): Row => ({
      date: move.date,
      action: move.action,
      owner: move.owner,
      to_owner: move.toOwner,
      player: move.player,
      bid_amount: move.bidAmount,
    })
  );
}

// ---- materializing ----

/**
 * Create every filled table as a temp table on this connection.
 *
 * Typed DDL first, so an empty table still has its columns, then the rows as
 * one bound JSON parameter read through `from_json` with the declared
 * structure: no literal is built from a value, so a player named O'Brien
 * cannot break the statement, and every column arrives typed rather than
 * inferred.
 */
export async function materializeLive(
  connection: DuckDBConnection,
  store: LiveStore
): Promise<void> {
  for (const { name, rows } of store.filled()) {
    const table: LiveTable = LIVE_TABLES[name];
    const ddl: string = Object.entries(table.columns)
      .map(([column, type]: [string, LiveColumnType]): string => `${column} ${type}`)
      .join(', ');
    await connection.run(`CREATE TEMP TABLE ${name} (${ddl})`);
    if (rows.length === 0) continue;
    // `[{"week":"INTEGER",...}]` -- the structure from_json wants, from the same declaration.
    const structure: string = JSON.stringify([table.columns]);
    await connection.run(
      `INSERT INTO ${name} SELECT * FROM (SELECT unnest(from_json(?::JSON, '${structure}'), recursive := true))`,
      [JSON.stringify(rows)]
    );
  }
}
