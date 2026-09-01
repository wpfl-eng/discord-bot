import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shred, type ShredResult } from '../../wpfl/shredder.js';
import { generateIndex } from '../../wpfl/indexGenerator.js';
import { wpflMembers } from '../../constants/wpflMembers.js';

type Artifact = Record<string, unknown>;

const ETAG = '75c67b38d2787f62bc10047932af0353';

describe('indexGenerator', () => {
  let dir: string;
  let artifact: Artifact;
  let result: ShredResult;
  let index: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-index-'));
    artifact = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/postdraft-published.json'), 'utf8')
    ) as Artifact;
    result = shred(artifact, dir);
    index = generateIndex({
      shred: result,
      artifact,
      etag: ETAG,
      wpflCacheFetchedAt: new Date('2026-08-31T12:00:00Z'),
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('the file map cannot describe files that are not there', () => {
    test('lists every file the shred actually wrote', () => {
      for (const file of result.files) {
        expect(index).toContain(file.path);
      }
    });

    test('every path it mentions exists on disk', () => {
      const mentioned: string[] = [...index.matchAll(/`([^`]+\.jsonl?)`/g)].map((m) => m[1]);

      expect(mentioned.length).toBeGreaterThan(30);
      for (const relative of mentioned) {
        expect(fs.existsSync(path.join(dir, relative))).toBe(true);
      }
    });

    test('gives every file a size and a description', () => {
      for (const line of index.split('\n')) {
        const match: RegExpMatchArray | null = line.match(/^- `([^`]+\.jsonl?)`(.*)$/);
        if (match === null) continue;
        // "<size> B" plus prose, on the same line as the path.
        expect(match[2]).toMatch(/\d[\d,]* B/);
        expect(match[2].replace(/[\d,]+ B/, '').replace(/[—\-·|]/g, '').trim().length).toBeGreaterThan(10);
      }
    });
  });

  describe('header', () => {
    test('carries every as-of date and the etag', () => {
      expect(index).toContain('2026-08-28 21:20'); // meta.generated
      expect(index).toContain('2026-08-28'); // meta.facts_as_of and news.as_of
      expect(index).toContain(ETAG);
      expect(index).toContain('2026-08-31'); // WPFL cache fetch date
    });

    test('says plainly that the artifact is a post-draft report', () => {
      expect(index).toMatch(/post-draft/i);
      expect(index).toMatch(/ESPN|web/);
    });

    test('reports an unknown etag rather than printing null', () => {
      const withoutEtag: string = generateIndex({
        shred: result,
        artifact,
        etag: null,
        wpflCacheFetchedAt: null,
      });

      expect(withoutEtag).not.toContain('null');
      expect(withoutEtag).toMatch(/unknown/i);
    });
  });

  describe('what was skipped', () => {
    test('names `available` as the deploy wrapper rather than leaving it unexplained', () => {
      expect(index).toContain('available');
      expect(index).toMatch(/deploy/i);
    });

    test('names every dead key and says it is retired', () => {
      for (const dead of ['league.grade_board', 'league.ridgeline', 'league.season_intro', 'night.clock']) {
        expect(index).toContain(dead);
      }
      expect(index).toMatch(/retired/i);
    });

    test('calls out an undocumented body explicitly', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const fresh: string = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-index-'));
      try {
        const withRace: Artifact = { ...artifact, race: { week: 1 } };
        const raceResult: ShredResult = shred(withRace, fresh);
        const raceIndex: string = generateIndex({
          shred: raceResult,
          artifact: withRace,
          etag: ETAG,
          wpflCacheFetchedAt: null,
        });

        expect(raceIndex).toContain('race');
        expect(raceIndex).toMatch(/undocumented/i);
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
        warn.mockRestore();
      }
    });

    test('has no undocumented section when everything was recognised', () => {
      expect(result.undocumented).toEqual([]);
      expect(index).not.toMatch(/undocumented/i);
    });
  });

  describe('glossary', () => {
    test('defines the artifact terms an outsider would misread', () => {
      for (const term of ['worth', 'edge', 'composite', 'skill_luck', 'hindsight', 'fingerprints', 'market']) {
        expect(index).toContain(term);
      }
    });
  });

  describe('owner roster', () => {
    test('lists all 14 canonical spellings so the agent never invents one', () => {
      for (const member of wpflMembers) {
        expect(index).toContain(member.owner);
      }
    });
  });

  describe('source routing', () => {
    test('states that the WPFL history API stops at 2025', () => {
      expect(index).toContain('2025');
      expect(index).toMatch(/2026/);
    });

    test('forbids hand-computing expected wins and optimal coaching', () => {
      expect(index).toContain('expected_wins');
      expect(index).toContain('optimal_coaching');
      expect(index).toMatch(/never|do not|don't/i);
    });
  });
});
