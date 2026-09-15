/**
 * Generate INDEX.md from what the shred actually wrote.
 *
 * This is the single highest-leverage artifact in the design: it is what lets
 * the agent open two files instead of forty. It is regenerated on every shred
 * and never hand-edited, so it cannot drift -- the file map is built from the
 * ShredResult, which means it can never describe a file that is not there
 * (design §3.4).
 *
 * The glossary constants live here rather than in their own module because
 * INDEX.md is their only consumer and they are rendered in the same pass. They
 * are copied from draft-2026 rather than read from it: the bot host does not
 * have that repository on it.
 */

import path from 'node:path';
import { PER_OWNER_BODIES, type ShredFile, type ShredResult } from './shredder.js';
import type { SourceExtents } from './historyCache.js';
import { CACHE_SOURCES, tableName, type AsOf } from './layout.js';
import { LIVE_TABLES, LIVE_TABLE_NAMES, type LiveTableName } from './liveTables.js';
import { wpflMembers } from '../constants/wpflMembers.js';

export interface IndexInput {
  readonly shred: ShredResult;
  /**
   * The as-of dates and the build's etag, read back from the staged files by
   * the same reader the prompt and /ask-admin use -- not from the artifact
   * object -- so the three can never disagree about what is on disk.
   */
  readonly asOf: AsOf;
  /**
   * The cache files actually present when this was generated, each with where
   * its rows run, read from the file on disk (null when it held nothing to
   * scan). Not what the refresh set out to fetch -- what is on disk, which is
   * what the `sql` tool will find: a season whose fetch failed leaves
   * player_scores.jsonl unwritten, and INDEX.md must not then advertise the
   * table. Where the rows run is what replaces "the history API stops at
   * 2025", a year that was wrong the moment the API gained a current-season
   * row, and wrong again every August.
   */
  readonly wpflCache?: Readonly<Record<string, SourceExtents | null>>;
}

/** One cached source: its file, the table it becomes, and what the agent is told about it. */
interface CachedSource {
  readonly file: string;
  readonly table: string;
  readonly description: string;
  /**
   * The traps in this table, written as rules rather than figures -- "the
   * budget has changed", never "$200 to $1,000 in 2023" -- so that nothing
   * here goes stale the way "the history API stops at 2025" did. Anything
   * that is a figure is read from the file's extents instead.
   */
  readonly notes: (extents: SourceExtents | null | undefined) => readonly string[];
}

/**
 * The cache files this feature knows how to describe. The table names are
 * derived the way `sql` derives them, so INDEX.md cannot advertise a name the
 * database would not have.
 */
const CACHED_DECADE: readonly CachedSource[] = [
  {
    file: CACHE_SOURCES.draftHistory,
    table: tableName('wpfl', CACHE_SOURCES.draftHistory),
    description: 'Every auction pick, one row per player per season.',
    notes: (): string[] => [
      '`auctionValue` is null before 2016, the snake-draft years; a spend query starts there.',
    ],
  },
  {
    file: CACHE_SOURCES.matchups,
    table: tableName('wpfl', CACHE_SOURCES.matchups),
    description:
      'Every regular-season head-to-head result, with both scores and the margin. The API publishes no playoff games.',
    notes: (): string[] => [
      "`winner` and `loser` are written on every row. A tie has null for both, so `COUNT(winner)` counts wins only; an owner's games are the rows where they are `teamA` or `teamB`.",
    ],
  },
  {
    file: CACHE_SOURCES.playerScores,
    table: tableName('wpfl', CACHE_SOURCES.playerScores),
    description:
      'Every weekly player score, with roster slot — the only way to ask what a drafted player went on to do.',
    notes: (extents): string[] => [
      `Seasons stop at different weeks${coverage(extents)}. Compare seasons per week, not per season, or the comparison is of coverage. \`rosterSlot\` BE is the bench and IR is injured reserve; everything else started.`,
    ],
  },
  {
    file: CACHE_SOURCES.transactions,
    table: tableName('wpfl', CACHE_SOURCES.transactions),
    description:
      'Every waiver bid and free-agent move, one row per attempt, with the bid, the result, and the players added and dropped.',
    notes: (): string[] => [
      "Spend means `result = 'Processed'`. Every other result is a failed bid that still carries its `bidAmount`, so a sum without that filter overstates spend badly. A processed row with `bidAmount` 0 is a free pickup.",
      "The FAAB budget has changed between seasons, so dollars do not compare across eras: compare on `percentOfBudget`, and read a season's budget as `bidAmount / percentOfBudget * 100`.",
      "Week 1 includes pre-season moves. The API's `manager` filter is the `owner` column here.",
    ],
  },
];

/** ": 2015: 13, 2016: 16, …" from the file's own extents, or nothing when there are none to read. */
function coverage(extents: SourceExtents | null | undefined): string {
  const seasons: [string, number][] = Object.entries(extents?.latestWeekBySeason ?? {});
  if (seasons.length === 0) return '';
  return `: ${seasons.map(([season, week]) => `${season}: ${week}`).join(', ')}`;
}

/** One line per file, keyed by shred-relative path. Team files share a description. */
const FILE_DESCRIPTIONS: Record<string, string> = {
  'meta.json':
    'Report header: season, when it was generated, total auction dollars spent, and the risk model used to discount projections.',

  'league/standings.json':
    'Simulated 2026 season per owner from 3,000 sims: mean wins, mean points, playoff odds, title odds, expected finish.',
  'league/board.json':
    'Every one of the 196 auction sales in order, with price, model worth, edge, projected and risk-adjusted points.',
  'league/dossiers.jsonl':
    'One line per drafted player: 2026 price, prior-season auction history, projection and risk breakdown, and scouting facts. Grep this by player name.',
  'league/market.json':
    'Auction dollars by position for 2026 against the career baseline: share of spend and top-5 average price.',
  'league/superlatives.json':
    'Draft-night awards -- biggest overpay, best value and the rest -- each with the sale it cites.',
  'league/story.json': 'The spend curve of the night, 2026 against prior seasons.',
  'league/runs.json':
    'Positional runs: where a cluster of one position started, how long it lasted, what it cost.',
  'league/rivalries.json': 'Head-to-head bidding history between every pair of owners.',
  'league/playoff_field.json':
    'The most likely six-team playoff fields and how often each came up in simulation.',
  'league/name_rankings.json': 'Team names of 2026 ranked on craft, with the reasoning.',
  'league/intro.json': 'Prose introduction to the league section.',
  'league/board_intro.json': 'Prose introduction to the auction board.',

  'news/as_of.json': 'The date the news layer stops. Nothing after this date is in the artifact.',
  'news/window_days.json': 'How many days of news the wire layer covers.',
  'news/players.jsonl':
    'One line per player in the news: heat score, latest item, and a dated timeline of everything the wire said. Grep this by player name.',
  'news/teams.json':
    'Per owner: which of their players are flagged, a heat score, and an injury count.',
  'news/wire.json': 'The wire grouped by kind -- injury watch, signings, trending adds and drops.',
  'news/reads.json': 'A one-line read on each player carrying real uncertainty.',
  'news/team_lines.json': 'A one-paragraph read on each owner’s camp situation.',
  'news/intro.json': 'Prose introduction to the news layer.',

  'night/spend_race.json':
    'Cumulative spend by each owner after every sale -- the budget race across the night.',
  'night/strip.json': 'Every sale in order: position, price, player, buyer.',
  'night/annotations.json': 'Marked moments in the sale order -- records, firsts, lasts.',
  'night/stepper.json': 'A guided walk through the night in numbered beats.',
  'night/sankey.json': 'Dollar flow from owners to positions.',
  'night/beeswarm.json': 'Every sale positioned by price, for shape rather than detail.',
  'night/autopsy.json':
    'How well the valuation model held up historically -- walk-forward error by season.',
  'night/acts.json': 'The night split into acts, with what defined each.',

  'history/seasons.json':
    'One row per owner-season since 2016: record, points for and against, seed, final rank, whether they won it.',
  'history/bump.json': 'Each owner’s finishing rank by season -- the shape of a career.',
  'history/dynasty.json':
    'Career totals per owner: titles, wins, losses, playoff appearances, average and best finish, luck wins.',
  'history/money.json': 'Auction dollars by position by season across the decade.',
  'history/hall_of_fame.json': 'The biggest sales and the extremes of league history.',
  'history/arcs.json': 'One player’s price across every season they were bought.',
  'history/champions.json': 'Champion and team name for every season.',
  'history/identities.json': 'Every team name each owner has worn, by season.',
  'history/churn.json': 'Acquisitions and trades per owner per season -- who works the wire.',
  'history/record_book.json':
    'League records through 2025: highest and lowest team weeks, margins, streaks.',
  'history/skill_luck.json':
    'All-play win percentage against actual wins, separating skill from schedule luck.',

  'market/meta.json': 'Coverage of the decade market study: seasons, picks, how many matched.',
  'market/curve.json': 'What a dollar bought, by position and price tier, across the decade.',
  'market/persistence.json': 'Whether positional value held up out of sample.',
  'market/hindsight.json': 'The best and worst buys of the decade priced with hindsight.',
  'market/fingerprints.json': 'Each owner’s decade-long auction style as measurable traits.',
  'market/champions.json': 'What the ten title teams had in common at the auction.',
  'market/recalibration.json': 'How widening the player pool changed the model.',
  'market/usage.json': 'Snap share, target share and touches for drafted players.',
  'market/prose.json': 'The written findings of the market study.',

  // The race body: draft-2026's in-season analysis, rebuilt every Tuesday.
  // The page it renders is https://wpfl-receipts-694ed0.pages.dev/#/race.
  'race/thru_week.json': 'The last completed NFL week the race body covers. Everything under race/ is as of this week.',
  'race/updated.json': 'When draft-2026 last rebuilt the race body (league time).',
  'race/report_card_benchmark_vs_actual.json':
    'One row per owner: record and points so far, then three playoff-odds figures that must not be confused -- `benchmark_playoff_odds` is the sealed draft-night forecast (the risk model), `week0_playoff_odds` is the same auction rosters re-simulated on the in-season yardstick before a snap, `playoff_odds_now` is this week. The page moves from week 0 to now; a sealed-to-now move mixes two rulers. Also mean wins and title odds at each point.',
  'race/report_card_odds_history.json':
    "One row per owner: parallel lists `weeks`, `playoff`, `title`, `mean_wins` -- the odds path week by week, week 0 first. UNNEST with positional joins, or read the file.",
  'race/roi_board.json':
    'Every one of the 196 auction receipts settling: price, points banked while the drafter started him, points while rostered, the full-season shadow total, dollars per started point, WAR, and a `verdict` (steal / fair / burning / shelf) with its `verdict_edge`. Shelf means never started.',
  'race/roi_teams.json': 'Per owner: auction dollars spent and the started points those picks have banked.',
  'race/ledgers_luck.json':
    'Per owner: record, all-play expected wins, and `luck` (wins minus expected). `weeks` holds each week\'s points, all-play fraction and result.',
  'race/ledgers_coaching.json':
    'Per owner: actual points, the optimal lineup\'s points from what the roster scored, and `bench_left` (the gap). `weeks` per week. Computed from ESPN box scores; the IR slot never counts.',
  'race/attribution_teams.json':
    'Per owner: started points split by how each player arrived -- drafted, waiver, fa (free agency), trade -- in `totals` and per week.',
  'race/weeks.json':
    'One recap card per completed week: every result with margin, the superlatives (top and low score, closest, blowout, best player week, points left on the bench) and the audited prose (intro, quips, one line per matchup).',
  'race/preview_week.json': 'The week the preview prices: the next one.',
  'race/preview_matchups.json':
    "Next week's games. `win_prob` is the home side's chance, priced from the best legal lineup of ESPN's projections for that week; each side carries `projected` (ours), `espn_projected` and `espn_win_prob` (ESPN's own call as of Tuesday), `playoff_odds` now, `odds_delta` since last week, and `playoff_if_win` / `playoff_if_lose` (what the game is worth).",
  'race/preview_game_of_the_week.json': 'Index into preview_matchups of the game of the week: stakes times closeness.',
  'race/preview_fallbacks.json': 'How many rostered players were priced from their season average because ESPN had no week line.',
  'race/calibration.json':
    'The forecast scoreboard, once a called week has been played: games scored, `ours` and `espn` each with a Brier score on the home win and a mean absolute error on projected totals. Null until Week 2 is played.',
  'race/schedule_ahead.json':
    "Per owner: games left and the mean strength of the remaining opponents against the league average (`vs_league`, points a week, positive is a harder road).",
  'race/records_watch.json': 'Any 2026 performance entering an all-time top five in the record book. Empty when nothing has.',
  'race/shapley_teams.json':
    "Per owner: total wins credited and each player's Shapley share of them -- who is carrying whom. A player earns credit only in weeks he cracked a legal lineup.",
  'race/wire_week.json': 'The week the wire snapshot was taken.',
  'race/wire_trending_add.json': 'Sleeper\'s most-added players over the last week, with who owns them here (null is a free agent).',
  'race/wire_trending_drop.json': 'Sleeper\'s most-dropped players over the last week, with who owns them here.',
  'race/wire_headlines.json': 'Recent headlines from the news wire, with source and date.',
  'race/wire_injury_report.json': "Drafted players with an injury designation, ESPN's status exactly.",
  'race/annotations_dossiers.jsonl':
    "One line per drafted player, keyed by the board's spelling: his weekly points with the drafter and whether he started, plus a career consistency profile. Grep this by player name.",
};

/** One line per per-owner body; its files are the 14 owners and share it. */
const PER_OWNER_DESCRIPTIONS: Record<string, string> = {
  teams:
    'One owner’s full post-draft file: grade and its components, spend, roster with per-player worth and edge, forecast, schedule, nomination behaviour, and the written verdict.',
};

const UNDOCUMENTED =
  'Undocumented — this body has no shred plan, so nobody has written a description for it. Read it before trusting it.';

/** Terms an outsider would misread. Copied from draft-2026; the bot host does not have it. */
const GLOSSARY: readonly (readonly [string, string])[] = [
  ['worth', 'What the valuation model says a player was worth in auction dollars.'],
  ['market', 'What the room actually paid, or would have -- the market price, as against `worth`.'],
  ['edge', '`worth` minus price. Positive is a bargain, negative is an overpay.'],
  [
    'grade.composite',
    'A team grade on 0-1, weighting projected starter points most heavily and value second. `grade.letter` is this on a letter scale.',
  ],
  [
    'skill_luck',
    'All-play win percentage (how an owner would have done against everyone every week) against actual wins. The gap is schedule luck.',
  ],
  [
    'hindsight',
    'What a player would have been worth if the room had known the season’s results in advance. `surplus` is that minus what they paid.',
  ],
  [
    'fingerprints',
    'An owner’s decade-long auction style as numbers: early-money share, spend concentration (gini), top bid, dollar-player rate, how often they buy their own nominations.',
  ],
  [
    'week 0',
    'The auction rosters re-simulated the in-season way (raw rest-of-season projections) before a snap was played. The sealed draft-night forecast used the risk model instead, so the two are different rulers; the race page measures every move from week 0 and keeps the sealed number beside it.',
  ],
  [
    'verdict',
    'On the ROI board: steal, fair or burning by quartiles of `verdict_edge` -- a receipt\'s WAR minus the median among started picks in its price band ($1, $2-3, $4-9, $10-19, $20-39, $40+). Shelf means the drafter never started him.',
  ],
  ['banked', 'Points a drafted player scored in weeks his drafter started him. `banked_rostered` counts any week on the roster; `shadow_total` the whole season regardless of roster.'],
  ['WAR', 'Wins above replacement in this league\'s own currency: how much a started week moved the win probability against the slot\'s replacement level.'],
  ['all-play', 'A week\'s score against every other team\'s: 13-0 is a clean sweep. `expected_wins` sums the fraction; `luck` is wins minus that.'],
  ['bench_left', 'Points the optimal lineup would have scored above the lineup actually started -- the coaching ledger\'s burn.'],
  ['swing', 'In the preview: `playoff_if_win` minus `playoff_if_lose`, what Sunday is worth in playoff odds.'],
  ['Brier', 'The scoreboard\'s score for a probability call: the mean squared gap between the probability and what happened, 0 perfect, 0.25 a coin flip. Lower is better.'],
];

export function generateIndex(input: IndexInput): string {
  const { shred, asOf } = input;

  const sections: string[] = [
    header(asOf),
    fileMap(shred),
    tables(),
    cachedDecade(asOf.cacheFetchedAt, input.wpflCache),
    skipped(shred),
    absent(shred),
    undocumented(shred),
    glossary(),
    roster(),
    routing(shred),
  ];

  return sections.filter((section: string): boolean => section !== '').join('\n\n');
}

function header(asOf: AsOf): string {
  return [
    '# WPFL data index',
    '',
    'Generated on every shred from what was actually written. Never hand-edited.',
    '',
    `- Artifact generated: **${asOf.generated ?? 'unknown'}**`,
    `- Facts as of: **${asOf.factsAsOf ?? 'unknown'}**`,
    `- News as of: **${asOf.newsAsOf ?? 'unknown'}**`,
    `- Artifact etag: **${asOf.etag ?? 'unknown'}**`,
    `- WPFL history cache fetched: **${asOf.cacheFetchedAt ?? 'unknown'}**`,
    ...(asOf.raceThruWeek !== null && asOf.raceThruWeek !== undefined
      ? [
          `- Race body: **thru week ${asOf.raceThruWeek}**, rebuilt **${asOf.raceUpdated ?? 'unknown'}**`,
          '',
          'The draft-era bodies of this artifact (teams, league, news, night, history,',
          'market) froze on draft night, and the news layer stops on the date above.',
          'The `race/` files are the season so far, rebuilt every Tuesday through the',
          'week named above: standings, luck, the bench, every auction receipt settling,',
          "the playoff odds and next week's preview. Anything since that rebuild -- the",
          'week in play, lineups now, injuries this week -- must come from the ESPN tools',
          'or the web, never from these files.',
        ]
      : [
          '',
          'This artifact is a **post-draft** report. It froze on draft night, and the',
          'news layer stops on the date above. Anything about the 2026 season in',
          'progress -- results, records, injuries since that date -- must come from the',
          'ESPN tools or the web, never from these files.',
        ]),
  ].join('\n');
}

function fileMap(shred: ShredResult): string {
  const lines: string[] = ['## Files'];
  let directory = '';

  for (const file of [...shred.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const dir: string = path.dirname(file.path);
    const perOwner: boolean = PER_OWNER_BODIES.includes(dir);
    if (dir !== directory) {
      directory = dir;
      lines.push('', `### ${dir === '.' ? 'root' : `${dir}/`}`, '');
      const note: string | undefined = DIRECTORY_NOTES[dir];
      if (note !== undefined) lines.push(note, '');
      if (perOwner) {
        // Fourteen files, one shape: the table, its columns and what a file
        // holds are said once above them rather than fourteen times beside
        // them. The description alone was 3 KB of repetition in a file the
        // agent reads on every question.
        lines.push(
          `One \`sql\` table, \`${tableName(null, dir)}\`, with one row per file below. Columns: ${columnList(file.columns)}.`,
          '',
          `Each file: ${describeFile(file.path)}`,
          ''
        );
      }
    }
    const description: string = perOwner ? '' : ` — ${describeFile(file.path)}`;
    const columns: string =
      perOwner || file.columns.length === 0 ? '' : ` — columns: ${columnList(file.columns)}`;
    lines.push(`- \`${file.path}\` — ${bytes(file.bytes)}${description}${columns}`);
  }

  return lines.join('\n');
}

/** Wide tables are cut here; the rest is a DESCRIBE away, and the point is the common names. */
const COLUMNS_SHOWN = 24;

function columnList(columns: readonly string[]): string {
  // A "column" with a space in it is a player's or an owner's name: the file
  // is an object keyed by name, and listing 24 of 57 names told the agent
  // nothing a DESCRIBE would not, at 700 characters a line.
  if (columns.some((column: string): boolean => /\s/.test(column))) {
    return `keyed by name, ${columns.length} keys (DESCRIBE the table)`;
  }
  const shown: readonly string[] = columns.slice(0, COLUMNS_SHOWN);
  const rest: number = columns.length - shown.length;
  return `\`${shown.join(', ')}\`${rest > 0 ? ` and ${rest} more (DESCRIBE the table)` : ''}`;
}

/** A line under a directory heading, for what its files share and no file line can say. */
const DIRECTORY_NOTES: Record<string, string> = {
  history:
    'Auction era only: these files start with the first auction season, 2016. For anything earlier, `wpfl_matchups` and `wpfl_draft_history` reach back to 2010.',
  race:
    'The season in progress as the league\'s own analysis publishes it every Tuesday (draft-2026\'s runbook), rendered at https://wpfl-receipts-694ed0.pages.dev/#/race. As of `race/thru_week.json` and `race/updated.json`: complete for every finished week, silent on the week in play -- this week\'s scores, lineups and injuries are the `espn_*` tools. Three playoff-odds figures live here and must be named for what they are: the sealed draft-night forecast, week 0 (the same rosters on the season\'s ruler), and now.',
};

/**
 * The naming rule the `sql` tool applies, stated where the agent reads first.
 * It lived only in the tool description, and the first live question guessed
 * `teams_aj_boorde` from the file listing.
 */
function tables(): string {
  const perOwner: string = PER_OWNER_BODIES.map((body: string): string => `\`${body}/\``).join(
    ', '
  );
  return [
    '## Every file is also a table',
    '',
    'The `sql` tool loads every file above as a DuckDB table named `<directory>_<file>`',
    'without the extension: `league/board.json` is `league_board`, `news/players.jsonl` is',
    `\`news_players\`, \`meta.json\` is \`meta\`. The per-owner directories (${perOwner}) are one`,
    'table each, named for the directory, with one row per owner. Column names are the ones',
    'listed beside each file, exactly; nested objects are STRUCTs, reached with a dot',
    '(`grade.letter`). When a column is not listed, `DESCRIBE <table>` before selecting it --',
    'a guessed name is a failed call and a wasted turn.',
  ].join('\n');
}

function describeFile(relative: string): string {
  const [directory] = relative.split('/');
  if (PER_OWNER_BODIES.includes(directory))
    return PER_OWNER_DESCRIPTIONS[directory] ?? UNDOCUMENTED;
  return FILE_DESCRIPTIONS[relative] ?? UNDOCUMENTED;
}

/**
 * The cached WPFL decade lives in `wpfl/` inside the shred root but is not part
 * of ShredResult, so the file map above cannot see it. Without this section the
 * agent is told to read INDEX.md before guessing at a filename, and INDEX.md
 * never mentions the largest dataset it has.
 *
 * Rendered from the files that are actually there, not from a fixed list. This
 * section used to name all three tables unconditionally, which meant a single
 * failed player-scores season -- the file then never written -- left INDEX.md
 * telling the agent to plan a ten-year query around a table `sql` would report
 * as missing. That is precisely the drift this module exists to make
 * impossible, and it was the one section not generated from what was written.
 */
function cachedDecade(
  fetchedAt: string | null,
  cache: Readonly<Record<string, SourceExtents | null>> = {}
): string {
  const present: readonly CachedSource[] = CACHED_DECADE.filter(({ file }) => file in cache);
  const missing: readonly CachedSource[] = CACHED_DECADE.filter(({ file }) => !(file in cache));
  const tables = (rows: readonly CachedSource[]): string =>
    rows.map(({ table }) => `\`${table}\``).join(', ');

  const lines: string[] = ['## The cached WPFL decade', ''];

  if (present.length === 0) {
    lines.push(
      `The ten-year history cache has not been built. ${tables(CACHED_DECADE)}`,
      'are unavailable this run — say so rather than answering a ten-year',
      'question from the artifact alone.'
    );
    return lines.join('\n');
  }

  lines.push(
    `${fetchedAt === null ? 'Fetched' : `Fetched ${fetchedAt}`} from the league's history API and written`,
    'to `wpfl/` as JSONL. Reachable **only through the `sql` tool** — one table each,',
    'and far too many rows to read as files. `season` and `week` are integers in',
    'every table, and positions and NFL team codes are trimmed and upper-cased,',
    'whatever the API sent. Where the rows end, and the columns, are read from the',
    'files:',
    '',
    '| Table | What it holds | Rows run | Columns |',
    '| --- | --- | --- | --- |',
    ...present.map(
      ({ file, table, description }) =>
        `| \`${table}\` | ${description} | ${describeExtents(cache[file])} | ${columnsCell(cache[file])} |`
    ),
    '',
    'Reading these tables:',
    '',
    // The traps a model falls into silently, one line per table, only for the
    // tables that are actually there.
    ...present.flatMap(({ file, table, notes }) =>
      notes(cache[file]).map((note: string): string => `- \`${table}\`: ${note}`)
    )
  );

  if (missing.length > 0) {
    lines.push(
      '',
      `**Not available this run:** ${tables(missing)}.`,
      'That fetch failed and the file was not written. Say so rather than',
      'answering as if the table were there.'
    );
  }

  return lines.join('\n');
}

function describeExtents(extents: SourceExtents | null | undefined): string {
  if (extents === null || extents === undefined) return 'unknown';
  const seasons: string =
    extents.seasonMin === extents.seasonMax
      ? `${extents.seasonMin}`
      : `${extents.seasonMin}–${extents.seasonMax}`;
  return extents.latestWeek === null
    ? seasons
    : `${seasons}, latest week ${extents.latestWeek} of ${extents.seasonMax}`;
}

function skipped(shred: ShredResult): string {
  if (shred.ignored.length === 0 && shred.deadKeys.length === 0) return '';

  const lines: string[] = ['## Not in this shred, on purpose'];

  for (const key of shred.ignored) {
    lines.push(
      `- \`${key}\` — not a body. draft-2026's deploy script wraps the artifact with it to mirror the shape its frontend expects.`
    );
  }
  for (const key of shred.deadKeys) {
    lines.push(
      `- \`${key}\` — retired analysis. draft-2026 no longer maintains it; do not cite it.`
    );
  }

  return lines.join('\n');
}

/** Planned keys that were null in the artifact: named so nobody reads their absence as a missing file. */
function absent(shred: ShredResult): string {
  if (shred.absent.length === 0) return '';
  return [
    '## Absent this week',
    '',
    'Planned keys that were null in the artifact, so no file was written. The',
    'race body carries `calibration` as null until a called week has been played.',
    '',
    ...shred.absent.map((key: string): string => `- \`${key}\``),
  ].join('\n');
}


function undocumented(shred: ShredResult): string {
  if (shred.undocumented.length === 0) return '';

  return [
    '## Undocumented bodies',
    '',
    'These appeared in the artifact with no shred plan. They were written out',
    'generically and nobody has described them. Treat them as unverified.',
    '',
    ...shred.undocumented.map((body: string): string => `- \`${body}\``),
  ].join('\n');
}

function glossary(): string {
  return [
    '## Glossary',
    '',
    ...GLOSSARY.map(([term, definition]) => `- \`${term}\` — ${definition}`),
  ].join('\n');
}

function roster(): string {
  return [
    '## Owners',
    '',
    'These 14 spellings are canonical. The artifact and the WPFL history API are',
    'keyed by them exactly. Never invent or abbreviate one.',
    '',
    ...wpflMembers.map((m) => `- ${m.owner} (ESPN team ${m.espnId})`),
  ].join('\n');
}

/** "`live_matchups` and `live_lineups` from `espn_boxscores`, ..." -- from the declaration, so a rename cannot leave this behind. */
function liveTablesProse(): string {
  const byTool = new Map<string, LiveTableName[]>();
  for (const name of LIVE_TABLE_NAMES) {
    const tool: string = LIVE_TABLES[name].tool;
    byTool.set(tool, [...(byTool.get(tool) ?? []), name]);
  }
  return [...byTool.entries()]
    .map(
      ([tool, names]: [string, LiveTableName[]]): string =>
        `${names.map((name: LiveTableName): string => `\`${name}\``).join(' and ')} from \`${tool}\``
    )
    .join(', ');
}

function routing(shred: ShredResult): string {
  const hasRace: boolean = shred.files.some((file: ShredFile): boolean =>
    file.path.startsWith('race/')
  );
  return [
    '## Which source answers which question',
    '',
    '| Question is about | Source |',
    '| --- | --- |',
    '| The 2026 draft, prices, grades, rosters as drafted | These files |',
    ...(hasRace
      ? [
          "| The season so far as analysed each Tuesday: standings with all-play and luck, points left on the bench, the ROI board and its verdicts, the report card (sealed forecast, week 0, odds now), next week's preview with ESPN's call beside ours and what the game is worth, win shares, the forecast scoreboard, the wire | The `race/` files (`race_*` tables), as of the race stamp in the header; the page is https://wpfl-receipts-694ed0.pages.dev/#/race |",
        ]
      : []),
    "| Who an owner plays each week, and the draft-night sim's odds for it | `teams.schedule`, a list per owner: UNNEST it in the `sql` tool. Frozen on draft night, like the rest of these files |",
    "| A matchup this week: ESPN's projected totals and win probability, current week only, with per-player projections, then the live scores, each starter's game status, whether the matchup is decided, and each side's optimal lineup so far | `espn_boxscores` |",
    '| League history, past seasons | These files, or the `sql` tool |',
    '| Ten years of prices, matchups or player scores | The `sql` tool |',
    '| Expected wins, optimal coaching, drafted points | `expected_wins`, `optimal_coaching`, `drafted_points` |',
    '| The 2026 season in progress -- records, scores, rosters, transactions | The `espn_*` tools |',
    `| The season in progress as rows to join or draw | The live tables, each filled by its own tool's call in the same run and empty until then: ${liveTablesProse()} |`,
    "| Who is favoured in an NFL game this week, the spread and total, how the line has moved, and where and when the money showed up | `polymarket_lines`, Polymarket's prices, not a sportsbook's |",
    '| Waiver bids, adds and drops in past seasons | `wpfl_transactions` in the `sql` tool; the season in progress is `espn_transactions` |',
    '| NFL news, injuries or results since the news date above | `WebSearch` / `WebFetch` |',
    '',
    'Two hard rules:',
    '',
    '1. **The WPFL history API lags the live season.** Its rows end where the cached',
    '   decade above says, days or weeks behind the games. For anything about the',
    '   season in progress use the ESPN tools, and treat any current-season rows in',
    '   the cache as possibly incomplete.',
    '2. **Never compute expected wins, optimal points or drafted points by hand**',
    '   from cached rows. Call `expected_wins`, `optimal_coaching` or',
    '   `drafted_points`. The league already publishes these figures through',
    '   `/ewins` and `/optimal`, and yours must be the same figure.',
  ].join('\n');
}

function columnsCell(extents: SourceExtents | null | undefined): string {
  return extents === null || extents === undefined || extents.columns.length === 0
    ? 'unknown'
    : `\`${extents.columns.join(', ')}\``;
}

function bytes(count: number): string {
  return `${count.toLocaleString('en-US')} B`;
}
