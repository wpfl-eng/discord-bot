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
import type { ShredResult } from './shredder.js';
import { wpflMembers } from '../constants/wpflMembers.js';

export interface IndexInput {
  readonly shred: ShredResult;
  /** The artifact itself, for the as-of dates in its header. */
  readonly artifact: unknown;
  /** Cloudflare etag of the build this shred came from, normalized. */
  readonly etag: string | null;
  /** When the WPFL history cache was last rebuilt, or null if it has not been. */
  readonly wpflCacheFetchedAt: Date | null;
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
};

const TEAM_FILE_DESCRIPTION: string =
  'One owner’s full post-draft file: grade and its components, spend, roster with per-player worth and edge, forecast, schedule, nomination behaviour, and the written verdict.';

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
];

export function generateIndex(input: IndexInput): string {
  const { shred, artifact, etag, wpflCacheFetchedAt } = input;
  const meta: Record<string, unknown> = bodyOf(artifact, 'meta');
  const news: Record<string, unknown> = bodyOf(artifact, 'news');

  const sections: string[] = [
    header(meta, news, etag, wpflCacheFetchedAt),
    fileMap(shred),
    cachedDecade(wpflCacheFetchedAt),
    skipped(shred),
    undocumented(shred),
    glossary(),
    roster(),
    routing(),
  ];

  return sections.filter((section: string): boolean => section !== '').join('\n\n');
}

function header(
  meta: Record<string, unknown>,
  news: Record<string, unknown>,
  etag: string | null,
  wpflCacheFetchedAt: Date | null
): string {
  return [
    '# WPFL data index',
    '',
    'Generated on every shred from what was actually written. Never hand-edited.',
    '',
    `- Artifact generated: **${asText(meta.generated)}**`,
    `- Facts as of: **${asText(meta.facts_as_of)}**`,
    `- News as of: **${asText(news.as_of)}**`,
    `- Artifact etag: **${etag ?? 'unknown'}**`,
    `- WPFL history cache fetched: **${wpflCacheFetchedAt === null ? 'unknown' : wpflCacheFetchedAt.toISOString().slice(0, 10)}**`,
    '',
    'This artifact is a **post-draft** report. It froze on draft night, and the',
    'news layer stops on the date above. Anything about the 2026 season in',
    'progress -- results, records, injuries since that date -- must come from the',
    'ESPN tools or the web, never from these files.',
  ].join('\n');
}

function fileMap(shred: ShredResult): string {
  const lines: string[] = ['## Files'];
  let directory = '';

  for (const file of [...shred.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const dir: string = path.dirname(file.path);
    if (dir !== directory) {
      directory = dir;
      lines.push('', `### ${dir === '.' ? 'root' : `${dir}/`}`, '');
    }
    lines.push(`- \`${file.path}\` — ${bytes(file.bytes)} — ${describeFile(file.path)}`);
  }

  return lines.join('\n');
}

function describeFile(relative: string): string {
  if (relative.startsWith('teams/')) return TEAM_FILE_DESCRIPTION;
  return (
    FILE_DESCRIPTIONS[relative] ??
    'Undocumented — this body has no shred plan, so nobody has written a description for it. Read it before trusting it.'
  );
}

/**
 * The cached WPFL decade lives in `wpfl/` inside the shred root but is not part
 * of ShredResult, so the file map above cannot see it. Without this section the
 * agent is told to read INDEX.md before guessing at a filename, and INDEX.md
 * never mentions the largest dataset it has.
 */
function cachedDecade(fetchedAt: Date | null): string {
  const lines: string[] = ['## The cached WPFL decade', ''];

  if (fetchedAt === null) {
    lines.push(
      'The ten-year history cache has not been built. `wpfl_draft_history`,',
      '`wpfl_matchups` and `wpfl_player_scores` are unavailable this run — say so',
      'rather than answering a ten-year question from the artifact alone.'
    );
    return lines.join('\n');
  }

  lines.push(
    `Fetched ${fetchedAt.toISOString().slice(0, 10)} from the league's history API and written`,
    'to `wpfl/` as JSONL. Reachable **only through the `sql` tool** — one table each,',
    'and far too many rows to read as files:',
    '',
    '| Table | What it holds |',
    '| --- | --- |',
    '| `wpfl_draft_history` | Every auction pick, one row per player per season. |',
    '| `wpfl_matchups` | Every head-to-head result, with both scores and the margin. |',
    '| `wpfl_player_scores` | Every weekly player score, with roster slot — the only way to ask what a drafted player went on to do. |'
  );

  return lines.join('\n');
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

function routing(): string {
  return [
    '## Which source answers which question',
    '',
    '| Question is about | Source |',
    '| --- | --- |',
    '| The 2026 draft, prices, grades, rosters as drafted | These files |',
    '| League history through 2025 | These files, or the `sql` tool |',
    '| Ten years of prices, matchups or player scores | The `sql` tool |',
    '| Expected wins, optimal coaching, drafted points | `expected_wins`, `optimal_coaching`, `drafted_points` |',
    '| The 2026 season in progress -- records, scores, rosters, transactions | The `espn_*` tools |',
    '| NFL news, injuries or results since the news date above | `WebSearch` / `WebFetch` |',
    '',
    'Two hard rules:',
    '',
    '1. **The WPFL history API stops at 2025.** It returns an empty list for 2026',
    '   on every endpoint. For anything in the current season, use the ESPN tools.',
    '2. **Never compute expected wins, optimal points or drafted points by hand**',
    '   from cached rows. Call `expected_wins`, `optimal_coaching` or',
    '   `drafted_points`. The league already publishes these figures through',
    '   `/ewins` and `/optimal`, and yours must be the same figure.',
  ].join('\n');
}

function bodyOf(artifact: unknown, name: string): Record<string, unknown> {
  const root = artifact as Record<string, unknown> | null;
  const body = root?.[name];
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'unknown';
}

function bytes(count: number): string {
  return `${count.toLocaleString('en-US')} B`;
}
