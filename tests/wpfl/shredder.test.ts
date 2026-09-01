import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shred, type ShredResult } from '../../wpfl/shredder.js';

type Artifact = Record<string, unknown>;

const FIXTURES: string = path.join(process.cwd(), 'tests', 'fixtures');

function loadFixture(name: string): Artifact {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Artifact;
}

describe('shredder', () => {
  let dir: string;
  let published: Artifact;
  let next: Artifact;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-shred-'));
    published = loadFixture('postdraft-published.json');
    next = loadFixture('postdraft-next.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const exists = (relative: string): boolean => fs.existsSync(path.join(dir, relative));
  const read = (relative: string): string => fs.readFileSync(path.join(dir, relative), 'utf8');

  describe('both real shapes shred', () => {
    test('shreds the currently published shape', () => {
      const result: ShredResult = shred(published, dir);
      expect(result.files.length).toBeGreaterThan(30);
    });

    test('shreds the shape the next publish will have', () => {
      const result: ShredResult = shred(next, dir);
      expect(result.files.length).toBeGreaterThan(30);
    });
  });

  describe('the deploy wrapper', () => {
    test('ignores `available` by name rather than shredding it', () => {
      const result: ShredResult = shred(published, dir);

      expect(exists('available.json')).toBe(false);
      expect(result.ignored).toContain('available');
      expect(result.undocumented).not.toContain('available');
    });
  });

  describe('dead keys', () => {
    test('skips every retired key by name and records it', () => {
      const result: ShredResult = shred(published, dir);

      expect(exists('league/grade_board.json')).toBe(false);
      expect(exists('league/ridgeline.json')).toBe(false);
      expect(exists('league/season_intro.json')).toBe(false);
      expect(exists('night/clock.json')).toBe(false);

      expect(result.deadKeys.sort()).toEqual([
        'league.grade_board',
        'league.ridgeline',
        'league.season_intro',
        'night.clock',
      ]);
    });

    test('reports no dead keys for the shape that has already dropped them', () => {
      const result: ShredResult = shred(next, dir);
      expect(result.deadKeys).toEqual([]);
    });
  });

  describe('planned layout', () => {
    test('writes meta as a single file at the root', () => {
      shred(published, dir);

      expect(exists('meta.json')).toBe(true);
      const meta: Record<string, unknown> = JSON.parse(read('meta.json')) as Record<string, unknown>;
      expect(meta.season).toBe(2026);
      expect(meta.generated).toBe('2026-08-28 21:20');
    });

    test('writes one team file per owner, named by a slug of the canonical spelling', () => {
      shred(published, dir);

      const owners: string[] = (published.teams as { owner: string }[]).map((t) => t.owner);
      expect(owners).toContain('AJ Boorde');

      expect(exists('teams/aj-boorde.json')).toBe(true);
      const team: { owner: string } = JSON.parse(read('teams/aj-boorde.json')) as { owner: string };
      expect(team.owner).toBe('AJ Boorde');

      const written: string[] = fs.readdirSync(path.join(dir, 'teams'));
      expect(written).toHaveLength(owners.length);
    });

    test('writes one file per key for each dict body', () => {
      shred(published, dir);

      expect(exists('league/standings.json')).toBe(true);
      expect(exists('league/board.json')).toBe(true);
      expect(exists('history/seasons.json')).toBe(true);
      expect(exists('history/record_book.json')).toBe(true);
      expect(exists('news/wire.json')).toBe(true);
      expect(exists('night/spend_race.json')).toBe(true);
    });

    test('writes the optional market body only when it is present', () => {
      shred(published, dir);
      expect(exists('market')).toBe(false);

      const fresh: string = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-shred-'));
      try {
        shred(next, fresh);
        expect(fs.existsSync(path.join(fresh, 'market/curve.json'))).toBe(true);
        expect(fs.existsSync(path.join(fresh, 'night/acts.json'))).toBe(true);
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
      }
    });

    test('reports the byte size of every file it wrote, and every one exists', () => {
      const result: ShredResult = shred(published, dir);

      for (const file of result.files) {
        const full: string = path.join(dir, file.path);
        expect(fs.existsSync(full)).toBe(true);
        expect(file.bytes).toBe(fs.statSync(full).size);
      }
    });
  });

  describe('jsonl collections', () => {
    test('writes one line per entry, carrying the key so grep can find it', () => {
      shred(published, dir);

      expect(exists('league/dossiers.jsonl')).toBe(true);
      expect(exists('league/dossiers.json')).toBe(false);

      const entries: Record<string, unknown> = published.league as Record<string, unknown>;
      const dossiers: Record<string, unknown> = entries.dossiers as Record<string, unknown>;
      const names: string[] = Object.keys(dossiers);

      const lines: string[] = read('league/dossiers.jsonl').trimEnd().split('\n');
      expect(lines).toHaveLength(names.length);

      const first: { key: string } = JSON.parse(lines[0]) as { key: string };
      expect(first.key).toBe(names[0]);
      // Every line must be self-contained: one grep hit is one whole record.
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    test('writes news.players as jsonl too', () => {
      shred(published, dir);

      const news: Record<string, unknown> = published.news as Record<string, unknown>;
      const players: Record<string, unknown> = news.players as Record<string, unknown>;

      expect(exists('news/players.jsonl')).toBe(true);
      const lines: string[] = read('news/players.jsonl').trimEnd().split('\n');
      expect(lines).toHaveLength(Object.keys(players).length);
    });

    test('merges the value onto the key rather than nesting it', () => {
      shred(published, dir);

      const line: string = read('league/dossiers.jsonl').split('\n')[0];
      const record: Record<string, unknown> = JSON.parse(line) as Record<string, unknown>;

      expect(Object.keys(record)).toContain('risk');
      expect(Object.keys(record)).toContain('price_2026');
    });
  });

  describe('tolerant and loud', () => {
    test('shreds an unknown body generically and flags it instead of throwing', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const withRace: Artifact = { ...published, race: { week: 1, leaders: [{ owner: 'AJ Boorde' }] } };

      const result: ShredResult = shred(withRace, dir);

      expect(result.undocumented).toContain('race');
      expect(exists('race/week.json')).toBe(true);
      expect(exists('race/leaders.json')).toBe(true);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test('writes an unknown list body to a single file', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const withList: Artifact = { ...published, ledger: [{ id: 1 }, { id: 2 }] };

      const result: ShredResult = shred(withList, dir);

      expect(result.undocumented).toContain('ledger');
      expect(exists('ledger.json')).toBe(true);
      warn.mockRestore();
    });
  });

  describe('abort conditions', () => {
    for (const body of ['meta', 'teams', 'league', 'news', 'history']) {
      test(`throws when the required body \`${body}\` is absent`, () => {
        const broken: Artifact = { ...published };
        delete broken[body];

        expect(() => shred(broken, dir)).toThrow(new RegExp(body));
      });
    }

    test('throws when teams arrives as a dict instead of a list', () => {
      const broken: Artifact = { ...published, teams: { 'aj-boorde': {} } };

      expect(() => shred(broken, dir)).toThrow(/teams/);
    });

    test('throws when league arrives as a list instead of a dict', () => {
      const broken: Artifact = { ...published, league: [1, 2, 3] };

      expect(() => shred(broken, dir)).toThrow(/league/);
    });

    test('throws when meta arrives as a scalar', () => {
      const broken: Artifact = { ...published, meta: 'nope' };

      expect(() => shred(broken, dir)).toThrow(/meta/);
    });

    test('throws when a team carries no owner to name its file after', () => {
      const teams: unknown[] = [...(published.teams as unknown[])];
      teams[0] = { team_id: 1 };
      const broken: Artifact = { ...published, teams };

      expect(() => shred(broken, dir)).toThrow(/owner/);
    });

    test('does not throw when the optional body night is absent', () => {
      const withoutNight: Artifact = { ...published };
      delete withoutNight.night;

      expect(() => shred(withoutNight, dir)).not.toThrow();
    });
  });
});
