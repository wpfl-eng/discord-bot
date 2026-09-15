import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeEtag,
  readAsOf,
  readCacheFetchedAt,
  readCacheFormat,
  readEtag,
  tableName,
  cacheDir,
  cacheMarker,
  cacheMarkerText,
  etagFile,
  type AsOf,
} from '../../wpfl/layout.js';

/**
 * The data directory's layout was spelled as literals in six modules, and its
 * two markers each had two readers that parsed them differently: the sync
 * normalized `.etag` and the prompt did not; the sync parsed `.fetched` as an
 * instant and the prompt sliced it as UTC text. One module now builds every
 * path and reads every marker.
 */
describe('layout', () => {
  // Cloudflare returns a weak etag on a compressed response and a strong one
  // otherwise, so the raw strings differ for the same build.
  describe('normalizeEtag', () => {
    test('strips the weak-validator prefix so the same build compares equal', () => {
      expect(normalizeEtag('W/"75c67b38"')).toBe('75c67b38');
      expect(normalizeEtag('"75c67b38"')).toBe('75c67b38');
      expect(normalizeEtag('75c67b38')).toBe('75c67b38');
    });

    test('a weak and a strong etag for one build normalize to the same value', () => {
      expect(normalizeEtag('W/"abc123"')).toBe(normalizeEtag('"abc123"'));
    });

    test('treats absent or empty as unknown', () => {
      expect(normalizeEtag(null)).toBeNull();
      expect(normalizeEtag('')).toBeNull();
      expect(normalizeEtag('W/""')).toBeNull();
    });
  });

  describe('tableName', () => {
    test('names a shredded file after its directory and file, the way sql does', () => {
      expect(tableName('league', 'board.json')).toBe('league_board');
      expect(tableName(null, 'meta.json')).toBe('meta');
      expect(tableName('wpfl', 'player_scores.jsonl')).toBe('wpfl_player_scores');
    });

    test('keeps a name safe for SQL', () => {
      expect(tableName('news', 'as-of.json')).toBe('news_as_of');
    });
  });

  describe('reading the markers', () => {
    let dataDir: string;
    let empty: string;

    beforeAll(() => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-layout-'));
      empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-layout-empty-'));
      fs.mkdirSync(path.join(dataDir, 'news'), { recursive: true });
      fs.mkdirSync(cacheDir(dataDir), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'meta.json'),
        JSON.stringify({ generated: '2026-08-28 21:20', facts_as_of: '2026-08-28' })
      );
      fs.writeFileSync(path.join(dataDir, 'news', 'as_of.json'), '"2026-08-28"');
      // Weak on disk, as it would be if anything ever wrote the wire's value raw.
      fs.writeFileSync(etagFile(dataDir), 'W/"abc123"\n');
      fs.writeFileSync(
        cacheMarker(dataDir),
        cacheMarkerText(new Date('2026-08-31T13:17:32.028Z'), 7)
      );
    });

    afterAll(() => {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(empty, { recursive: true, force: true });
    });

    test('the etag on disk is normalized the way the wire is, so the two compare', () => {
      expect(readEtag(dataDir)).toBe('abc123');
    });

    test('the cache marker is an instant', () => {
      expect(readCacheFetchedAt(dataDir)?.toISOString()).toBe('2026-08-31T13:17:32.028Z');
    });

    test('the cache marker carries the normaliser format that wrote it', () => {
      expect(readCacheFormat(dataDir)).toBe(7);
    });

    /**
     * The marker was a bare instant before the format line existed. Such a
     * marker still reads its instant, and reads as format 0 so the sync
     * treats the rows as written by an unknown normaliser and refetches.
     */
    test('a marker from before the format line reads its instant and format 0', () => {
      const old: string = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-layout-old-'));
      try {
        fs.mkdirSync(cacheDir(old), { recursive: true });
        fs.writeFileSync(cacheMarker(old), '2026-09-02T21:50:00.000Z\n');

        expect(readCacheFetchedAt(old)?.toISOString()).toBe('2026-09-02T21:50:00.000Z');
        expect(readCacheFormat(old)).toBe(0);
      } finally {
        fs.rmSync(old, { recursive: true, force: true });
      }
    });

    test('a missing marker reads as format 0', () => {
      expect(readCacheFormat(path.join(empty, 'nope'))).toBe(0);
    });

    test('reads the dates out of the shred it was given', () => {
      const asOf: AsOf = readAsOf(dataDir);

      expect(asOf).toEqual({
        generated: '2026-08-28 21:20',
        factsAsOf: '2026-08-28',
        newsAsOf: '2026-08-28',
        etag: 'abc123',
        cacheFetchedAt: '2026-08-31',
        // a draft-only shred: the race body is not published yet
        raceThruWeek: null,
        raceUpdated: null,
      });
    });

    test('the cache date is the league-timezone day, not the UTC one', () => {
      // 02:30Z on 1 September is still the evening of 31 August in New York.
      const evening: string = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-layout-evening-'));
      try {
        fs.mkdirSync(cacheDir(evening), { recursive: true });
        fs.writeFileSync(cacheMarker(evening), '2026-09-01T02:30:00.000Z\n');

        expect(readAsOf(evening).cacheFetchedAt).toBe('2026-08-31');
      } finally {
        fs.rmSync(evening, { recursive: true, force: true });
      }
    });

    test('returns nulls rather than throwing when there is no shred yet', () => {
      expect(readAsOf(path.join(empty, 'nope'))).toEqual({
        generated: null,
        factsAsOf: null,
        newsAsOf: null,
        etag: null,
        raceThruWeek: null,
        raceUpdated: null,
        cacheFetchedAt: null,
      });
    });

    test('a marker that is not a date reads as never fetched', () => {
      fs.mkdirSync(cacheDir(empty), { recursive: true });
      fs.writeFileSync(cacheMarker(empty), 'yesterday\n');

      expect(readCacheFetchedAt(empty)).toBeNull();
    });
  });
});
