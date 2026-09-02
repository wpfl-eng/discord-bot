import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shred, type ShredResult } from '../../wpfl/shredder.js';
import { generateIndex } from '../../wpfl/indexGenerator.js';
import { readAsOf, type AsOf } from '../../wpfl/layout.js';
import { wpflMembers } from '../../constants/wpflMembers.js';
import { loadFixture } from './support.js';

type Artifact = Record<string, unknown>;

const ETAG = '75c67b38d2787f62bc10047932af0353';

describe('indexGenerator', () => {
  let dir: string;
  let artifact: Artifact;
  let result: ShredResult;
  let asOf: AsOf;
  let index: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-index-'));
    artifact = loadFixture<Artifact>('postdraft-published.json');
    result = shred(artifact, dir);
    // As the sync does: the dates come back off the shredded files, through
    // the same reader the prompt and /ask-admin use.
    asOf = { ...readAsOf(dir), etag: ETAG, cacheFetchedAt: '2026-08-31' };
    index = generateIndex({ shred: result, asOf });
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
        expect(match[2]).toMatch(/\d[\d,]* B/);
        // The fourteen per-owner files share one shape and are described once
        // above the list (below); every other file carries prose on its line.
        if (match[1].startsWith('teams/')) continue;
        expect(
          match[2]
            .replace(/[\d,]+ B/, '')
            .replace(/[—\-·|]/g, '')
            .trim().length
        ).toBeGreaterThan(10);
      }
    });

    // The description used to ride on all fourteen lines: 3 KB of the same
    // sentence in a file the agent reads on every question.
    test('describes the per-owner files once, above them, not fourteen times', () => {
      const teamsSection: string = index.slice(index.indexOf('### teams/'));
      const lines: string[] = teamsSection.split('\n');

      const described: number = lines.filter((line) => line.includes('post-draft file')).length;
      expect(described).toBe(1);
      expect(teamsSection).toMatch(/^Each file: One owner’s full post-draft file/m);
      const teamFiles: number = result.files.filter((f) => f.path.startsWith('teams/')).length;
      expect(teamFiles).toBeGreaterThan(1);
      expect(lines.filter((line) => line.startsWith('- `teams/'))).toHaveLength(teamFiles);
      expect(lines.some((line) => /^- `teams\/[a-z-]+\.json` — [\d,]+ B$/.test(line))).toBe(true);
    });

    // `news/reads.json` is an object keyed by player name, so its "columns"
    // were 24 names and "33 more" -- 700 characters saying nothing DESCRIBE
    // would not.
    test('says a name-keyed file is keyed by name instead of listing the names', () => {
      expect(index).toMatch(/`news\/reads\.json` — .* — columns: keyed by name, \d+ keys/);
      expect(index).not.toMatch(/`news\/reads\.json` — .*Ja'Marr Chase/);
      // A real column list is untouched.
      expect(index).toMatch(/- `league\/board\.json` — .* — columns: `sale_order/);
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
        asOf: { ...asOf, etag: null, cacheFetchedAt: null },
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
      for (const dead of [
        'league.grade_board',
        'league.ridgeline',
        'league.season_intro',
        'night.clock',
      ]) {
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
          asOf: { ...readAsOf(fresh), etag: ETAG },
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
      for (const term of [
        'worth',
        'edge',
        'composite',
        'skill_luck',
        'hindsight',
        'fingerprints',
        'market',
      ]) {
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
    // The literal year is gone: it was wrong the moment the API gained a
    // 2026 row, and wrong again every August after (log Stage 14, decision 11).
    test('says the history API lags the live season, without a hard-coded year', () => {
      expect(index).not.toMatch(/stops at 20\d\d/i);
      expect(index).toMatch(/lags the live season/i);
      expect(index).toMatch(/season in progress/i);
      expect(index).toMatch(/2026/);
    });

    test('forbids hand-computing expected wins and optimal coaching', () => {
      expect(index).toContain('expected_wins');
      expect(index).toContain('optimal_coaching');
      expect(index).toMatch(/never|do not|don't/i);
    });

    // The first live matchup question pulled the whole week's boxscores --
    // seven matchups of zeroes, before kickoff -- for an opponent and a win
    // probability that sit in the artifact's schedule.
    test('routes the schedule and the sim odds to the artifact, not to ESPN', () => {
      expect(index).toMatch(/\| Who an owner plays each week.*\| `teams\.schedule`/);
      expect(index).toMatch(/espn_boxscores` is for scores once a week is played/);
    });
  });
  /**
   * The cached WPFL decade is written into `wpfl/` inside the shred root, but
   * it is not part of ShredResult, so INDEX.md's file map -- the thing the
   * prompt tells the agent to read before guessing at a filename -- listed
   * neither the files nor the fact that they are reachable only through `sql`.
   */
  describe('the cached decade', () => {
    // Present, with nothing scanned: what the sync passes for a file it found but could not read a season from.
    const ALL_CACHED: Record<string, null> = {
      'draft_history.jsonl': null,
      'matchups.jsonl': null,
      'player_scores.jsonl': null,
    };

    test('names the three cached sources and the table each becomes', () => {
      const index: string = generateIndex({ shred: result, asOf, wpflCache: ALL_CACHED });

      expect(index).toContain('wpfl_draft_history');
      expect(index).toContain('wpfl_matchups');
      expect(index).toContain('wpfl_player_scores');
      expect(index).toMatch(/only through the `sql` tool/i);
    });

    test("says where each table's rows end, read from the files themselves", () => {
      const index: string = generateIndex({
        shred: result,
        asOf,
        wpflCache: {
          'draft_history.jsonl': {
            seasonMin: 2010,
            seasonMax: 2025,
            latestWeek: null,
            columns: [],
          },
          'matchups.jsonl': { seasonMin: 2015, seasonMax: 2025, latestWeek: 17, columns: [] },
          'player_scores.jsonl': { seasonMin: 2015, seasonMax: 2026, latestWeek: 3, columns: [] },
        },
      });

      expect(index).toMatch(/wpfl_draft_history.*2010.*2025/);
      expect(index).toMatch(/wpfl_matchups.*2015.*2025.*week 17/);
      expect(index).toMatch(/wpfl_player_scores.*2015.*2026.*week 3/);
    });

    test("lists each cached table's columns, read from its file", () => {
      const index: string = generateIndex({
        shred: result,
        asOf,
        wpflCache: {
          'matchups.jsonl': {
            seasonMin: 2010,
            seasonMax: 2025,
            latestWeek: 14,
            columns: ['week', 'season', 'teamA'],
          },
        },
      });

      expect(index).toMatch(/wpfl_matchups.*\| `week, season, teamA` \|/);
      expect(index).toMatch(/regular-season/);
    });

    /**
     * The first five live questions cost seven failed `sql` calls between
     * them, every one a guessed column name and each a paid turn. The columns
     * come from the shred, so the file map can say them.
     */
    test('says the table rule, and the columns beside every file', () => {
      expect(index).toContain('## Every file is also a table');
      expect(index).toMatch(/`<directory>_<file>`/);
      expect(index).toMatch(/- `league\/board\.json` — .* — columns: `/);
      expect(index).toMatch(
        /One `sql` table, `teams`, with one row per file below\. Columns: `.*owner/
      );
      expect(index).toMatch(/### history\/\n\nAuction era only/);
    });

    test('does not advertise a table whose file was never written', () => {
      // One failed player-scores season means historyCache writes no
      // player_scores.jsonl at all. INDEX.md used to name the table anyway, so
      // the agent would plan a ten-year query around a table `sql` reports as
      // missing -- in a file whose whole premise is that it can only describe
      // what is actually on disk.
      const index: string = generateIndex({
        shred: result,
        asOf,
        wpflCache: { 'draft_history.jsonl': null, 'matchups.jsonl': null },
      });

      expect(index).toContain('| `wpfl_draft_history` |');
      expect(index).toContain('| `wpfl_matchups` |');
      expect(index).not.toContain('| `wpfl_player_scores` |');
      expect(index).toMatch(/Not available this run:.*wpfl_player_scores/);
    });

    test('says so plainly when the cache has never been built', () => {
      const index: string = generateIndex({
        shred: result,
        asOf: { ...asOf, etag: null, cacheFetchedAt: null },
        wpflCache: {},
      });

      expect(index).toMatch(/not been (built|fetched)|unavailable/i);
      expect(index).not.toContain('wpfl_draft_history —');
    });
  });
});
