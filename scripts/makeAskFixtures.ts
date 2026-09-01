// Regenerate the two /ask artifact fixtures.
//
// Usage:
//   npx tsx scripts/makeAskFixtures.ts
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

import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';

const ARTIFACT_URL = 'https://wpfl-receipts-694ed0.pages.dev/postdraft.json';
const LOCAL_ARTIFACT = '../draft-2026/data/cache/postdraft_2026.json';
const OUT_DIR = 'tests/fixtures';

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
function trim(value: Json, depth: number): Json {
  if (Array.isArray(value)) {
    return value.slice(0, KEEP).map((entry: Json): Json => trim(entry, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const keys: string[] = Object.keys(value);
    const kept: string[] =
      depth >= 2 && keys.length > DICT_IS_COLLECTION_ABOVE ? keys.slice(0, KEEP) : keys;

    const out: { [key: string]: Json } = {};
    for (const key of kept) {
      out[key] = trim(value[key], depth + 1);
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
