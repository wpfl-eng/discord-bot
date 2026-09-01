/**
 * Shred the draft-2026 post-draft artifact into per-unit files under a target
 * directory.
 *
 * The published artifact is ~935 KB on a single line -- `wc -l` returns 0,
 * because deploy.sh writes it with Python's json.dump. Grep matches that one
 * line and returns the whole file, and a whole-file Read costs ~216,000
 * tokens. Shredding turns "why did Jimmy's grade come out A+?" into two reads
 * of a few KB (design §3.2).
 *
 * The policy is tolerant and loud (§3.6). An unknown body is shredded
 * generically and flagged, because aborting would leave the bot answering
 * confidently from the previous, older shred -- the exact failure the rule was
 * written to prevent. Only a *required* body that is missing or has changed
 * container type aborts.
 */

import fs from 'node:fs';
import path from 'node:path';

type Json = unknown;
type JsonDict = Record<string, Json>;

interface BodyPlan {
  /** `single` writes one file at the root; `dict` one file per key; `list-by-owner` one file per team. */
  readonly kind: 'single' | 'dict' | 'list-by-owner';
  readonly required: boolean;
  /** Keys of a `dict` body written as JSONL instead of JSON. */
  readonly jsonl?: readonly string[];
}

const BODY_PLANS: Record<string, BodyPlan> = {
  meta: { kind: 'single', required: true },
  teams: { kind: 'list-by-owner', required: true },
  league: { kind: 'dict', required: true, jsonl: ['dossiers'] },
  news: { kind: 'dict', required: true, jsonl: ['players'] },
  history: { kind: 'dict', required: true },
  night: { kind: 'dict', required: false },
  market: { kind: 'dict', required: false },
};

/** Not a body: deploy.sh publishes `{"available": True, **art}` to mirror the FastAPI shape. */
const IGNORED_KEYS: ReadonlySet<string> = new Set(['available']);

/**
 * Mirrors ../draft-2026/backend/analysis/artifact.py DEAD_KEYS. Kept here
 * because the bot host does not have draft-2026 on it. Sync when it changes.
 *
 * These are analysis draft-2026 has deliberately retired but which are still
 * present in the published build. A tolerant shredder would happily shred them
 * and the agent would cite retired work as current.
 */
const DEAD_KEYS: ReadonlySet<string> = new Set([
  'league.grade_board',
  'league.ridgeline',
  'league.season_intro',
  'night.clock',
]);

export interface ShredFile {
  /** Path relative to the shred root, e.g. `teams/aj-boorde.json`. */
  readonly path: string;
  readonly bytes: number;
}

export interface ShredResult {
  readonly files: ShredFile[];
  /** Top-level bodies with no plan, shredded generically. */
  readonly undocumented: string[];
  /** Retired keys skipped by name. */
  readonly deadKeys: string[];
  /** Keys skipped because they are not bodies at all. */
  readonly ignored: string[];
}

class ShredAbort extends Error {}

export function shred(artifact: Json, targetDir: string): ShredResult {
  if (!isDict(artifact)) {
    throw new ShredAbort('The artifact is not an object.');
  }

  for (const [body, plan] of Object.entries(BODY_PLANS)) {
    if (plan.required && !(body in artifact)) {
      throw new ShredAbort(`Required body \`${body}\` is missing from the artifact.`);
    }
  }

  const files: ShredFile[] = [];
  const undocumented: string[] = [];
  const deadKeys: string[] = [];
  const ignored: string[] = [];

  const root: string = path.resolve(targetDir);
  const write = (relative: string, contents: string): void => {
    const full: string = path.resolve(root, relative);
    // Belt to safeName's braces: nothing is written outside the shred root,
    // whatever the artifact called its keys.
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
      throw new ShredAbort(`Refusing to write \`${relative}\` outside the shred directory.`);
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
    files.push({ path: relative, bytes: fs.statSync(full).size });
  };

  for (const [body, value] of Object.entries(artifact)) {
    if (IGNORED_KEYS.has(body)) {
      ignored.push(body);
      continue;
    }

    const plan: BodyPlan | undefined = BODY_PLANS[body];
    if (plan === undefined) {
      console.warn(
        `[ASK] Artifact body \`${body}\` has no shred plan. Shredding it generically and flagging it in INDEX.md.`
      );
      undocumented.push(body);
      shredGenerically(body, value, write);
      continue;
    }

    switch (plan.kind) {
      case 'single':
        requireDict(body, value);
        write(`${safeName(body)}.json`, JSON.stringify(value));
        break;

      case 'list-by-owner':
        requireList(body, value);
        for (const entry of value) {
          const owner: Json = isDict(entry) ? entry.owner : undefined;
          if (typeof owner !== 'string' || owner.trim() === '') {
            throw new ShredAbort(
              `A \`${body}\` entry has no string \`owner\` to name its file after.`
            );
          }
          write(`${safeName(body)}/${slug(owner)}.json`, JSON.stringify(entry));
        }
        break;

      case 'dict': {
        requireDict(body, value);
        const asJsonl: ReadonlySet<string> = new Set(plan.jsonl ?? []);
        for (const [key, member] of Object.entries(value)) {
          if (DEAD_KEYS.has(`${body}.${key}`)) {
            deadKeys.push(`${body}.${key}`);
            continue;
          }
          if (asJsonl.has(key) && isDict(member)) {
            write(`${safeName(body)}/${safeName(key)}.jsonl`, toJsonl(member));
          } else {
            write(`${safeName(body)}/${safeName(key)}.json`, JSON.stringify(member));
          }
        }
        break;
      }
    }
  }

  return { files, undocumented, deadKeys, ignored };
}

/** Dict becomes one file per key, anything else a single file (design §3.6). */
function shredGenerically(
  body: string,
  value: Json,
  write: (relative: string, contents: string) => void
): void {
  if (isDict(value)) {
    for (const [key, member] of Object.entries(value)) {
      write(`${safeName(body)}/${safeName(key)}.json`, JSON.stringify(member));
    }
    return;
  }
  write(`${safeName(body)}.json`, JSON.stringify(value));
}

/**
 * One JSON object per line, each carrying its own key, so a grep hit is a whole
 * self-contained record. This is what turns Grep from useless into surgical on
 * the two 180 KB+ keyed collections.
 */
function toJsonl(collection: JsonDict): string {
  const lines: string[] = Object.entries(collection).map(([key, value]) =>
    JSON.stringify(isDict(value) ? { key, ...value } : { key, value })
  );
  return `${lines.join('\n')}\n`;
}

/**
 * One artifact key to one safe path component.
 *
 * Body and key names come out of a JSON document fetched over the network and
 * were being handed straight to path.join, so a key of `../../authorized_keys`
 * wrote outside the shred root. Owner names were already slugged; nothing else
 * was. Every real key -- `spend_race`, `hall_of_fame`, `board_intro` -- is
 * unchanged by this, so no existing filename moves.
 */
function safeName(name: string): string {
  const cleaned: string = name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^\.+/, '');
  return cleaned === '' ? '_' : cleaned;
}

/** Canonical WPFL owner spelling to a filename: `AJ Boorde` -> `aj-boorde`. */
function slug(owner: string): string {
  return owner
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isDict(value: Json): value is JsonDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireDict(body: string, value: Json): asserts value is JsonDict {
  if (!isDict(value)) {
    throw new ShredAbort(
      `Body \`${body}\` changed container type: expected an object, got ${describe(value)}.`
    );
  }
}

function requireList(body: string, value: Json): asserts value is Json[] {
  if (!Array.isArray(value)) {
    throw new ShredAbort(
      `Body \`${body}\` changed container type: expected a list, got ${describe(value)}.`
    );
  }
}

function describe(value: Json): string {
  if (Array.isArray(value)) return 'a list';
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}
