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
import { ASK } from '../ask/askConfig.js';
import { espnClientFromEnv } from '../helpers/espnPeriod.js';
import { getCurrentNFLSeason } from '../helpers/utils.js';
import { errorMessage } from '../errors/errorHandler.js';
import { fetchJsonArray, fetchWithTimeout, type HttpResponse } from '../wpfl/wpflHttp.js';

// The URLs come from askConfig rather than being restated here. The whole point
// of this script is that the fixtures match what the bot actually fetches, and a
// forked copy of a host is exactly how it would stop being true -- silently,
// with the tests still green against a source production no longer reads.
const ARTIFACT_URL: string = ASK.ARTIFACT_URL;
const LOCAL_ARTIFACT = '../draft-2026/data/cache/postdraft_2026.json';
const OUT_DIR = 'tests/fixtures';
const ASK_API: string = ASK.WPFL_API_BASE;

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

/**
 * ESPN member ids are `{GUID}` strings -- the SWID half of ESPN's cookie pair,
 * and a persistent identifier of one league member -- and they ride on every
 * team object the fork returns, as `owners` and `primaryOwner`. Nothing in the
 * bot reads them, and a fixture in a public repository must not carry one.
 * Every string of that shape, anywhere in a recording, becomes the zero GUID,
 * so the shape the parsers see is unchanged.
 */
const MEMBER_ID =
  /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;
const REDACTED_MEMBER_ID = '{00000000-0000-0000-0000-000000000000}';

function redact(value: Json): Json {
  if (typeof value === 'string') return MEMBER_ID.test(value) ? REDACTED_MEMBER_ID : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, member] of Object.entries(value)) out[key] = redact(member);
    return out;
  }
  return value;
}

async function fetchPublished(): Promise<Json> {
  const response: HttpResponse = await fetchWithTimeout(ARTIFACT_URL, fetch, 'The artifact fetch');
  if (!response.ok) {
    throw new Error(`${ARTIFACT_URL} returned ${response.status}`);
  }
  console.log(`published etag ${response.headers?.get('etag') ?? 'none'}`);
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
  // Redacted first, every recording, so no source can reintroduce a member id.
  const config: prettier.Options | null = await prettier.resolveConfig(target);
  const formatted: string = await prettier.format(JSON.stringify(redact(artifact)), {
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

const WPFL_RECORDINGS: readonly (readonly [string, string, number?])[] = [
  [
    'wpfl-expected-wins.json',
    `${ASK_API}/expectedwins?seasonMin=2024&seasonMax=2024&weekMin=1&weekMax=17&includePlayoffs=false`,
  ],
  ['wpfl-optimal-coaching.json', `${ASK_API}/optimalcoaching/pointsfor/2024?week=16`],
  [
    'wpfl-drafted-points.json',
    `${ASK_API}/draft/draftedpoints?seasonMin=2024&seasonMax=2024&weekMax=15`,
  ],
  // The range and window forms the tools now expose, recorded so the shape the
  // API sums into -- one row per owner carrying both bounds -- is on file.
  [
    'wpfl-expected-wins-range.json',
    `${ASK_API}/expectedwins?seasonMin=2023&seasonMax=2025&weekMin=1&weekMax=14&includePlayoffs=true`,
  ],
  [
    'wpfl-drafted-points-window.json',
    `${ASK_API}/draft/draftedpoints?seasonMin=2024&seasonMax=2024&weekMin=5&weekMax=8`,
  ],
  // The one row-shaped endpoint recorded: the cache renames `manager` and the
  // wire type in types/api.ts documents this shape, so a change in it should
  // show in a diff. Six seasons are ~2,000 rows; a few are kept.
  ['wpfl-transactions.json', `${ASK_API}/transactions?seasonMin=2024&seasonMax=2024`, KEEP],
];

for (const [name, url, keep] of WPFL_RECORDINGS) {
  // The bot's own fetch path, so a recording is of what the bot would see.
  // One row per owner, so these are small enough to keep whole unless told.
  try {
    const rows: Json[] = await fetchJsonArray<Json>(url, {}, fetch);
    await write(name, keep === undefined ? rows : rows.slice(0, keep));
  } catch (error: unknown) {
    console.log(`skipped ${name}: ${errorMessage(error)}`);
  }
}

const client = espnClientFromEnv();
if (client === null) {
  console.log('skipped the ESPN recordings: LEAGUE_ID, ESPN_S2 or SWID is not set');
} else {
  // Not getFullYear(): in January and February that names a season ESPN has no
  // data for, and the recording would be of an empty league.
  const seasonId: number = getCurrentNFLSeason();

  // Two entries each: 837 free agents and 14 full rosters are the same shape
  // repeated, the interface is what these are recorded for, and a transaction
  // action carries a whole team object.
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
  await write(
    'espn-transactions.json',
    trim(asJson(await client.getRecentActivity({ seasonId })), 0, 1)
  );
}
