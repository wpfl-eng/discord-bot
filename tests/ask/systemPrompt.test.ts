import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt, readAsOf, STATIC_PROMPT, type AsOf } from '../../ask/systemPrompt.js';

const SEPT = new Date('2026-09-15T18:00:00Z');

const AS_OF: AsOf = {
  generated: '2026-08-28 21:20',
  factsAsOf: '2026-08-28',
  newsAsOf: '2026-08-28',
  etag: '75c67b38d2787f62bc10047932af0353',
  cacheFetchedAt: '2026-08-31',
};

describe('systemPrompt', () => {
  describe('the cache boundary', () => {
    test('is the SDK marker, as a standalone element between the halves', () => {
      const parts: string[] = buildSystemPrompt({
        owner: 'AJ Boorde',
        espnId: 4,
        now: SEPT,
        asOf: AS_OF,
      });

      expect(parts).toHaveLength(3);
      expect(parts[1]).toBe(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    });

    test('the static half is byte-identical no matter who is asking or when', () => {
      const one: string[] = buildSystemPrompt({
        owner: 'AJ Boorde',
        espnId: 4,
        now: SEPT,
        asOf: AS_OF,
      });
      const two: string[] = buildSystemPrompt({
        owner: 'Neill Bullock',
        espnId: 11,
        now: new Date('2026-12-01T00:00:00Z'),
        asOf: { ...AS_OF, newsAsOf: '2026-11-30' },
      });

      expect(one[0]).toBe(two[0]);
      expect(one[0]).toBe(STATIC_PROMPT);
    });

    test('everything that varies is after the boundary', () => {
      const parts: string[] = buildSystemPrompt({
        owner: 'AJ Boorde',
        espnId: 4,
        now: SEPT,
        asOf: AS_OF,
      });

      expect(parts[0]).not.toContain('AJ Boorde');
      expect(parts[0]).not.toContain('2026-08-28');
      expect(parts[0]).not.toContain('2026-09-15');
    });
  });

  describe('the static half', () => {
    test('states the grounding rule as a hard constraint', () => {
      expect(STATIC_PROMPT).toMatch(/every number/i);
      expect(STATIC_PROMPT).toMatch(/say you don't have it|say so/i);
    });

    test('forbids hand-computing the three published figures, by tool name', () => {
      expect(STATIC_PROMPT).toContain('expected_wins');
      expect(STATIC_PROMPT).toContain('optimal_coaching');
      expect(STATIC_PROMPT).toContain('drafted_points');
      expect(STATIC_PROMPT).toContain('/ewins');
      expect(STATIC_PROMPT).toContain('/optimal');
    });

    test('says what each source knows and what it does not', () => {
      expect(STATIC_PROMPT).toMatch(/post-draft/i);
      expect(STATIC_PROMPT).toMatch(/2025/); // the history API's ceiling
      expect(STATIC_PROMPT).toContain('sql');
      expect(STATIC_PROMPT).toContain('espn_');
      expect(STATIC_PROMPT).toContain('INDEX.md');
    });

    test('describes the league as it actually is', () => {
      expect(STATIC_PROMPT).toMatch(/14/);
      expect(STATIC_PROMPT).toMatch(/\$200|auction/i);
    });

    test('asks for a source footer and a Discord-sized answer', () => {
      expect(STATIC_PROMPT).toMatch(/footer/i);
      expect(STATIC_PROMPT).toMatch(/1,?500|character/i);
    });
  });

  describe('the per-request half', () => {
    const dynamic = (over: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}): string =>
      buildSystemPrompt({ owner: 'AJ Boorde', espnId: 4, now: SEPT, asOf: AS_OF, ...over })[2];

    test('names the caller and their ESPN team, so "my team" needs no round trip', () => {
      const text: string = dynamic();

      expect(text).toContain('AJ Boorde');
      expect(text).toContain('4');
    });

    test('says plainly when the caller is not a league member', () => {
      const text: string = dynamic({ owner: null, espnId: null });

      expect(text).not.toContain('AJ Boorde');
      expect(text).toMatch(/not.*(mapped|member)|don't know who/i);
    });

    // Labor Day 2026 is 7 September, so the season opens Thursday the 10th and
    // the 15th is still week 1. Two dates, so this asserts the week is computed
    // rather than merely printed.
    test('carries the date and the NFL week', () => {
      const text: string = dynamic();

      expect(text).toContain('2026-09-15');
      expect(text).toMatch(/week 1\b/i);

      const later: string = dynamic({ now: new Date('2026-09-22T18:00:00Z') });
      expect(later).toContain('2026-09-22');
      expect(later).toMatch(/week 2\b/i);
    });

    test('carries every as-of date and the artifact etag', () => {
      const text: string = dynamic();

      expect(text).toContain('2026-08-28 21:20');
      expect(text).toContain('2026-08-28');
      expect(text).toContain('2026-08-31');
    });

    test('reports an unknown as-of rather than printing undefined', () => {
      const text: string = dynamic({
        asOf: { generated: null, factsAsOf: null, newsAsOf: null, etag: null, cacheFetchedAt: null },
      });

      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
      expect(text).toMatch(/unknown/i);
    });
  });

  describe('readAsOf', () => {
    let dataDir: string;

    beforeAll(() => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-asof-'));
      fs.mkdirSync(path.join(dataDir, 'news'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'wpfl'), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'meta.json'),
        JSON.stringify({ generated: '2026-08-28 21:20', facts_as_of: '2026-08-28' })
      );
      fs.writeFileSync(path.join(dataDir, 'news', 'as_of.json'), '"2026-08-28"');
      fs.writeFileSync(path.join(dataDir, '.etag'), 'abc123\n');
      fs.writeFileSync(path.join(dataDir, 'wpfl', '.fetched'), '2026-08-31T03:17:32.028Z\n');
    });

    afterAll(() => {
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('reads the dates out of the shred it was given', () => {
      const asOf: AsOf = readAsOf(dataDir);

      expect(asOf).toEqual({
        generated: '2026-08-28 21:20',
        factsAsOf: '2026-08-28',
        newsAsOf: '2026-08-28',
        etag: 'abc123',
        cacheFetchedAt: '2026-08-31',
      });
    });

    test('returns nulls rather than throwing when there is no shred yet', () => {
      const asOf: AsOf = readAsOf(path.join(dataDir, 'nope'));

      expect(asOf.generated).toBeNull();
      expect(asOf.etag).toBeNull();
    });
  });
});
