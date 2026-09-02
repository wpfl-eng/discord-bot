import type { WpflMember } from '../../constants/wpflMembers.js';
import { describe, test, expect } from '@jest/globals';
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt, STATIC_PROMPT } from '../../ask/systemPrompt.js';
import type { NFLPeriod } from '../../helpers/espnPeriod.js';
import type { AsOf } from '../../wpfl/layout.js';

const SEPT = new Date('2026-09-15T18:00:00Z');

/** The week as ESPN reports it, resolved once per run by the runner. */
const WEEK_1: NFLPeriod = {
  seasonId: 2026,
  scoringPeriodId: 1,
  matchupPeriodId: 1,
  source: 'espn',
};

const AS_OF: AsOf = {
  generated: '2026-08-28 21:20',
  factsAsOf: '2026-08-28',
  newsAsOf: '2026-08-28',
  etag: '75c67b38d2787f62bc10047932af0353',
  cacheFetchedAt: '2026-08-31',
};

const AJ: WpflMember = { espnId: 4, owner: 'AJ Boorde', discordId: '120231673722830849' };
const NEILL: WpflMember = { espnId: 11, owner: 'Neill Bullock', discordId: '543421070548664331' };

describe('systemPrompt', () => {
  describe('the cache boundary', () => {
    test('is the SDK marker, as a standalone element between the halves', () => {
      const parts: string[] = buildSystemPrompt({
        member: AJ,
        now: SEPT,
        period: WEEK_1,
        asOf: AS_OF,
      });

      expect(parts).toHaveLength(3);
      expect(parts[1]).toBe(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    });

    test('the static half is byte-identical no matter who is asking or when', () => {
      const one: string[] = buildSystemPrompt({
        member: AJ,
        now: SEPT,
        period: WEEK_1,
        asOf: AS_OF,
      });
      const two: string[] = buildSystemPrompt({
        member: NEILL,
        now: new Date('2026-12-01T00:00:00Z'),
        period: { ...WEEK_1, scoringPeriodId: 13, matchupPeriodId: 13, source: 'calendar' },
        asOf: { ...AS_OF, newsAsOf: '2026-11-30' },
      });

      expect(one[0]).toBe(two[0]);
      expect(one[0]).toBe(STATIC_PROMPT);
    });

    test('everything that varies is after the boundary', () => {
      const parts: string[] = buildSystemPrompt({
        member: AJ,
        now: SEPT,
        period: WEEK_1,
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
      // No hard-coded year: the history API lags the live season, whatever year it is.
      expect(STATIC_PROMPT).toMatch(/lags the live season/i);
      expect(STATIC_PROMPT).not.toMatch(/\b20\d\d\b/);
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
      buildSystemPrompt({
        member: AJ,
        now: SEPT,
        period: WEEK_1,
        asOf: AS_OF,
        ...over,
      })[2];

    test('names the caller and their ESPN team, so "my team" needs no round trip', () => {
      const text: string = dynamic();

      expect(text).toContain('AJ Boorde');
      expect(text).toContain('4');
    });

    /**
     * The week and season come from the period the runner resolved, not from
     * arithmetic over `now`. Main's helpers/espnPeriod.ts asks ESPN, which
     * publishes the week directly, and falls back to the calendar; /median and
     * /closestscores already use it, and principle five says /ask must not
     * disagree with them (log Stage 14, decision 10). The date is still `now`,
     * in the league timezone.
     */
    test('carries the date, and the NFL week and season it was given', () => {
      const text: string = dynamic();

      expect(text).toContain('2026-09-15');
      expect(text).toMatch(/week 1\b/i);
      expect(text).toContain('2026 season');

      const later: string = dynamic({
        now: new Date('2026-09-22T18:00:00Z'),
        period: { ...WEEK_1, scoringPeriodId: 2, matchupPeriodId: 2 },
      });
      expect(later).toContain('2026-09-22');
      expect(later).toMatch(/week 2\b/i);
    });

    test('names the season the ESPN tools query, whatever the calendar year says', () => {
      // January is the fantasy playoffs; the season being played is still 2026.
      const text: string = dynamic({
        now: new Date('2027-01-15T12:00:00Z'),
        period: { ...WEEK_1, scoringPeriodId: 18, matchupPeriodId: 18 },
      });

      expect(text).toContain('2027-01-15');
      expect(text).toContain('2026 season');
      expect(text).not.toContain('2027 season');
    });

    test('says where the week came from, so the agent hedges on the fallback', () => {
      expect(dynamic()).toMatch(/from ESPN/i);

      const fallback: string = dynamic({ period: { ...WEEK_1, source: 'calendar' } });
      expect(fallback).toMatch(/calendar/i);
      expect(fallback).toMatch(/ESPN (was|is) unreachable|could not reach ESPN/i);
    });

    /**
     * Every other calendar boundary in the feature is America/New_York --
     * caps.ts computes the daily and monthly windows there, matching the trivia
     * scheduler. This half was using toISOString(), which is UTC, so from 8pm
     * ET onwards the agent was told tomorrow's date and footed it into a public
     * answer. getFullYear() was worse still: it is the host's local timezone,
     * whatever that happens to be.
     */
    test('gives the date in the league timezone, not UTC', () => {
      // 2026-09-15T02:00Z is still the evening of the 14th in New York.
      const text: string = dynamic({ now: new Date('2026-09-15T02:00:00Z') });

      expect(text).toContain('2026-09-14');
      expect(text).not.toContain('2026-09-15');
    });

    test('keeps the date in the league timezone across the year boundary', () => {
      // 03:00Z on 1 January is still 31 December in New York.
      const text: string = dynamic({ now: new Date('2027-01-01T03:00:00Z') });

      expect(text).toContain('2026-12-31');
    });

    test('carries every as-of date and the artifact etag', () => {
      const text: string = dynamic();

      expect(text).toContain('2026-08-28 21:20');
      expect(text).toContain('2026-08-28');
      expect(text).toContain('2026-08-31');
    });

    test('reports an unknown as-of rather than printing undefined', () => {
      const text: string = dynamic({
        asOf: {
          generated: null,
          factsAsOf: null,
          newsAsOf: null,
          etag: null,
          cacheFetchedAt: null,
        },
      });

      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
      expect(text).toMatch(/unknown/i);
    });
  });
});
