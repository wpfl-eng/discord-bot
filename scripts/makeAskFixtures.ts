// Regenerate the /ask fixtures: the two artifact shapes, plus one recorded
// response per WPFL aggregate endpoint and per ESPN client method.
//
// Usage:
//   npx tsx scripts/makeAskFixtures.ts
//
// Each source is independent. A source whose prerequisite is missing --
// draft-2026 not checked out, no ESPN credentials in .env -- is skipped with a
// message rather than failing the run, so this is usable on any box.
//
// The shredder cannot be written test-first without a fixture, and a
// hand-written fixture encodes what the design document *claims* the artifact
// looks like -- which is exactly how the first draft of that document went
// wrong (design §3.1a). So the fixtures are generated from the two real
// builds, and this script is committed so they can be regenerated when
// draft-2026's shape moves.
//
// Two fixtures, because the bot must survive both shapes:
//
//   postdraft-published.json  the live URL today: `available`, the four
//                             DEAD_KEYS, no `market`
//   postdraft-next.json       draft-2026's local build, i.e. the shape after
//                             the next deploy: `market`, `night.acts`, no
//                             dead keys
//
// Truncation preserves every key and every container type and cuts collections
// down to a few entries. The remaining ~1.8 MB of the real files is repetition
// of shapes already covered, and committing it would make these the two
// largest files in the repo by a wide margin (design §13.2).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import pkg from 'espn-fantasy-football-api/node.js';

const { Client } = pkg;

const ARTIFACT_URL = 'https://wpfl-receipts-694ed0.pages.dev/postdraft.json';
const LOCAL_ARTIFACT = '../draft-2026/data/cache/postdraft_2026.json';
const OUT_DIR = 'tests/fixtures';
const ASK_API = 'https://wpflapi.azurewebsites.net/api';

/** Entries kept from any list, and from any dict judged to be a collection. */
const KEEP = 3;

/**
 * A dict with more keys than this is a keyed collection (league.dossiers has
 * 196, news.players 182, news.reads 57) rather than structure. Structure dicts
 * in this artifact top out at 20 keys (a team object), so the gap is wide and
 * the threshold does not need to be precise.
 */
const DICT_IS_COLLECTION_ABOVE = 30;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * @param depth 0 is the artifact root, 1 its bodies, 2 the shred units.
 *   Dicts are never truncated above depth 2: at depth 0 the keys are bodies and
 *   at depth 1 they are the files the shredder writes, and dropping either
 *   would produce a fixture that no longer exercises the shredder.
 */
function trim(value: Json, depth: number, keep: number = KEEP): Json {
  if (Array.isArray(value)) {
    return value.slice(0, keep).map((entry: Json): Json => trim(entry, depth + 1, keep));
  }

  if (value !== null && typeof value === 'object') {
    const keys: string[] = Object.keys(value);
    const kept: string[] =
      depth >= 2 && keys.length > DICT_IS_COLLECTION_ABOVE ? keys.slice(0, keep) : keys;

    const out: { [key: string]: Json } = {};
    for (const key of kept) {
      out[key] = trim(value[key], depth + 1, keep);
    }
    return out;
  }

  return value;
}

async function fetchPublished(): Promise<Json> {
  const response: Response = await fetch(ARTIFACT_URL);
  if (!response.ok) {
    throw new Error(`${ARTIFACT_URL} returned ${response.status}`);
  }
  console.log(`published etag ${response.headers.get('etag') ?? 'none'}`);
  return (await response.json()) as Json;
}

function readLocal(): Json {
  const resolved: string = path.resolve(LOCAL_ARTIFACT);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `${resolved} not found. postdraft-next.json can only be regenerated on a box that has draft-2026 checked out.`
    );
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8')) as Json;
}

async function write(name: string, artifact: Json): Promise<void> {
  const target: string = path.join(OUT_DIR, name);
  // Formatted rather than minified, so a shape change is legible in a diff --
  // a fixture nobody can read is a fixture nobody notices drifting. Run through
  // prettier with the repo's own config so regenerating never dirties the tree.
  const config: prettier.Options | null = await prettier.resolveConfig(target);
  const formatted: string = await prettier.format(JSON.stringify(artifact), {
    ...config,
    filepath: target,
  });
  fs.writeFileSync(target, formatted);
  console.log(`${target}  ${fs.statSync(target).size} B`);
}

const published: Json = await fetchPublished();
const local: Json = readLocal();

await write('postdraft-published.json', trim(published, 0));

// deploy.sh publishes `{"available": True, **art}`, so the next published file
// carries the wrapper too. The fixture represents what the bot will fetch, not
// what sits on AJ's disk.
await write('postdraft-next.json', {
  available: true,
  ...(trim(local, 0) as { [k: string]: Json }),
});

// ---------------------------------------------------------------------------
// Recorded tool responses (design §13.3's carve-outs)
//
// The WPFL aggregates and the ESPN methods get their interfaces designed
// against a real payload rather than against a guess: the aggregates' row shape
// is the API's, not ours, and the ESPN fork's return shapes are documented
// nowhere -- the blank-team-name finding came only from reading one.
// ---------------------------------------------------------------------------

const WPFL_RECORDINGS: readonly (readonly [string, string])[] = [
  [
    'wpfl-expected-wins.json',
    `${ASK_API}/expectedwins?seasonMin=2024&seasonMax=2024&weekMin=1&weekMax=17&includePlayoffs=false`,
  ],
  ['wpfl-optimal-coaching.json', `${ASK_API}/optimalcoaching/pointsfor/2024?week=16`],
  [
    'wpfl-drafted-points.json',
    `${ASK_API}/draft/draftedpoints?seasonMin=2024&seasonMax=2024&weekMax=15`,
  ],
];

for (const [name, url] of WPFL_RECORDINGS) {
  const response: Response = await fetch(url);
  if (!response.ok) {
    console.log(`skipped ${name}: ${url} returned ${response.status}`);
    continue;
  }
  // One row per owner, so these are small enough to keep whole.
  await write(name, (await response.json()) as Json);
}

const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
if (LEAGUE_ID === undefined || ESPN_S2 === undefined || SWID === undefined) {
  console.log('skipped the ESPN recordings: LEAGUE_ID, ESPN_S2 or SWID is not set');
} else {
  const client = new Client({ leagueId: Number.parseInt(LEAGUE_ID, 10) });
  client.setCookies({ espnS2: ESPN_S2, SWID });
  const seasonId: number = new Date().getFullYear();

  // Trimmed to a few entries each: 837 free agents and 14 full rosters are the
  // same shape repeated, and the interface is what these are recorded for.
  // Two entries each. Enough to show that a field is a list; a transaction
  // action carries the whole 13 KB team object, so three of everything is far
  // more than the shape needs.
  const KEEP_ESPN = 2;
  // The fork's typings are interfaces, which do not structurally satisfy the
  // recursive Json index signature. These payloads are plain JSON off the wire.
  const asJson = (value: unknown): Json => value as Json;
  await write(
    'espn-teams.json',
    trim(asJson(await client.getTeamsAtWeek({ seasonId, scoringPeriodId: 1 })), 0, KEEP_ESPN)
  );
  await write(
    'espn-boxscores.json',
    trim(
      asJson(await client.getBoxscoreForWeek({ seasonId, matchupPeriodId: 1, scoringPeriodId: 1 })),
      0,
      KEEP_ESPN
    )
  );
  await write(
    'espn-free-agents.json',
    trim(asJson(await client.getFreeAgents({ seasonId, scoringPeriodId: 1 })), 0, KEEP_ESPN)
  );
  // One topic, one action. Every action embeds the *raw* ESPN team object --
  // 8.8 KB of roster the tool never reads past `team.id` -- so two of them cost
  // 90 KB to record one field layout.
  await write('espn-transactions.json', trim(asJson(await client.getRecentActivity({ seasonId })), 0, 1));
}
