import { describe, test, expect } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Client as EspnClient } from 'espn-fantasy-football-api/node.js';
import { ASK } from '../../ask/askConfig.js';
import {
  createPolymarketLinesTool,
  moneylineOf,
  polymarketSlug,
  slugTeam,
  spreadOf,
  summarize,
  teamTotalOf,
  totalOf,
  type GammaEvent,
  type GammaMarket,
  type LinesDeps,
  type LinesSummary,
  type ScheduledGame,
} from '../../wpfl/polymarketLines.js';
import { createLiveStore, type LiveStore } from '../../wpfl/liveTables.js';
import type { FetchFn, HttpResponse } from '../../wpfl/wpflHttp.js';
import { fakeResponse, loadFixture, textOf } from './support.js';

/**
 * Polymarket's prices on the week's games (wpfl/polymarketLines.ts). The
 * recordings are from the Monday morning of week 1: the schedule, the
 * moneyline market of that night's game fetched alone, and its event cut to
 * the lines the tool reads plus a few kinds it must ignore.
 */
describe('polymarketLines', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const games = loadFixture<any[]>('espn-nfl-games.json') as ScheduledGame[];
  const [event] = loadFixture<GammaEvent[]>('polymarket-event.json');
  const [moneyline] = loadFixture<GammaMarket[]>('polymarket-moneyline.json');
  const gameBetween = (away: string, home: string): ScheduledGame => {
    const game: ScheduledGame | undefined = games.find(
      (g: ScheduledGame): boolean =>
        g.awayTeam.teamAbbrev === away && g.homeTeam.teamAbbrev === home
    );
    if (game === undefined) throw new Error(`no ${away} at ${home}`);
    return game;
  };
  const denKc: ScheduledGame = gameBetween('DEN', 'KC');

  describe('the event slug', () => {
    test('is away, home and the kickoff date in UTC, so a Monday night game is dated Tuesday', () => {
      expect(polymarketSlug(denKc)).toBe('nfl-den-kc-2026-09-15');
      expect(polymarketSlug(gameBetween('NE', 'SEA'))).toBe('nfl-ne-sea-2026-09-10');
    });

    test('spells the Rams and Washington the way Polymarket does, and every other team as ESPN does', () => {
      expect(polymarketSlug(gameBetween('SF', 'LAR'))).toBe('nfl-sf-la-2026-09-11');
      expect(polymarketSlug(gameBetween('WSH', 'PHI'))).toBe('nfl-was-phi-2026-09-13');
      expect(slugTeam('KC')).toBe('kc');
      expect(slugTeam('JAX')).toBe('jax');
    });
  });

  describe('reading an event', () => {
    test('the moneyline names each side by nickname, whichever order the outcomes came in', () => {
      const market: GammaMarket | undefined = event.markets.find(
        (m: GammaMarket): boolean => m.sportsMarketType === 'moneyline'
      );
      if (market === undefined) throw new Error('no moneyline');
      expect(moneylineOf(market, denKc)).toEqual({
        awayPrice: 0.455,
        homePrice: 0.545,
        awayChange: { day: 0.02, week: 0.02, month: 0.025 },
        volume: 746885,
        volume24h: 730476,
        closed: false,
      });
      const reversed: GammaMarket = {
        ...market,
        outcomes: '["Chiefs", "Broncos"]',
        outcomePrices: '["0.545", "0.455"]',
      };
      expect(moneylineOf(reversed, denKc)).toMatchObject({
        awayPrice: 0.455,
        homePrice: 0.545,
        // Polymarket's change is on the first outcome; read for the away side it flips.
        awayChange: { day: -0.02, week: -0.02, month: -0.025 },
      });
    });

    test('the spread is the most-traded full-game line, with the favourite and its price to cover', () => {
      expect(spreadOf(event, denKc)).toEqual({
        favorite: 'KC',
        line: 2.5,
        price: 0.495,
        // A window Polymarket reports nothing for reads as no move, not a missing field.
        favoriteChange: { day: 0, week: -0.01, month: -0.02 },
        volume: 48729,
        volume24h: 46780,
      });
    });

    test('the total is the most-traded full-game line with the over price', () => {
      expect(totalOf(event)).toEqual({
        line: 43.5,
        overPrice: 0.475,
        overChange: { day: -0.03, week: -0.015, month: 0.01 },
        volume: 425023,
        volume24h: 418344,
      });
    });

    test('a team total is per side, keyed by the slug spelling of the team', () => {
      expect(teamTotalOf(event, 'DEN')).toMatchObject({
        line: 20.5,
        overPrice: 0.53,
        volume: 1067,
      });
      expect(teamTotalOf(event, 'KC')).toMatchObject({ line: 22.5 });
    });

    test('first-half, quarter and exact-margin markets are not lines', () => {
      const withoutFullGame: GammaEvent = {
        ...event,
        markets: event.markets.filter(
          (m: GammaMarket): boolean =>
            !['spreads', 'totals', 'team_totals'].includes(m.sportsMarketType ?? '')
        ),
      };
      expect(withoutFullGame.markets.length).toBeGreaterThan(1);
      expect(spreadOf(withoutFullGame, denKc)).toBeNull();
      expect(totalOf(withoutFullGame)).toBeNull();
      expect(teamTotalOf(withoutFullGame, 'KC')).toBeNull();
    });

    test('equal volume goes to the line nearest a coin flip', () => {
      const tie: GammaEvent = {
        slug: 'nfl-den-kc-2026-09-15',
        markets: [
          {
            slug: 'nfl-den-kc-2026-09-15-total-40pt5',
            sportsMarketType: 'totals',
            outcomes: '["Over", "Under"]',
            outcomePrices: '["0.7", "0.3"]',
            volume: '100',
            line: 40.5,
          },
          {
            slug: 'nfl-den-kc-2026-09-15-total-43pt5',
            sportsMarketType: 'totals',
            outcomes: '["Over", "Under"]',
            outcomePrices: '["0.48", "0.52"]',
            volume: '100',
            line: 43.5,
          },
        ],
      };
      expect(totalOf(tie)).toMatchObject({ line: 43.5 });
    });

    test('a summary from the event alone carries the lines and the event volume', () => {
      const summary: LinesSummary = summarize(1, denKc, event, null);
      expect(summary).toMatchObject({
        week: 1,
        away: 'DEN',
        home: 'KC',
        awayName: 'Broncos',
        homeName: 'Chiefs',
        gameStatus: 'not_started',
        event: 'nfl-den-kc-2026-09-15',
        volume: 1424582,
        volume24h: 1396541,
        detailed: true,
        moneyline: { awayPrice: 0.455, homePrice: 0.545 },
        spread: { favorite: 'KC', line: 2.5 },
        total: { line: 43.5 },
      });
      expect(summary.kickoff).toMatch(/2026-09-14 20:15 EDT/);
    });

    test('a summary from the moneyline market alone carries the prices and the event volume, no lines', () => {
      const summary: LinesSummary = summarize(1, denKc, null, moneyline);
      expect(summary).toMatchObject({
        event: 'nfl-den-kc-2026-09-15',
        volume: 1424582,
        volume24h: 1396541,
        detailed: false,
        moneyline: { awayPrice: 0.455, homePrice: 0.545, volume: 746885, volume24h: 730476 },
        spread: null,
        total: null,
      });
    });

    test('a game Polymarket does not list is nulls, not zeros', () => {
      expect(summarize(1, denKc, null, null)).toMatchObject({
        event: null,
        volume: null,
        volume24h: null,
        moneyline: null,
        detailed: false,
        spread: null,
      });
    });
  });

  describe('the tool', () => {
    const asked: Record<string, unknown>[] = [];
    const urls: string[] = [];
    const resolved: GammaMarket = {
      ...moneyline,
      slug: 'nfl-dal-nyg-2026-09-14',
      outcomes: '["Cowboys", "Giants"]',
      outcomePrices: '["0", "1"]',
      closed: true,
      volume: '3756939.2',
      events: [{ slug: 'nfl-dal-nyg-2026-09-14', volume: 5813397, closed: true }],
    };
    const gamma: FetchFn = async (url: string): Promise<HttpResponse> => {
      urls.push(url);
      if (url.includes('nfl-sf-la-2026-09-11')) throw new Error('boom');
      if (url.includes('/events?slug=nfl-den-kc-2026-09-15'))
        return fakeResponse({ body: [event] });
      if (url.includes('/markets?slug=nfl-den-kc-2026-09-15'))
        return fakeResponse({ body: [moneyline] });
      if (url.includes('/markets?slug=nfl-dal-nyg-2026-09-14') && url.includes('closed=true')) {
        return fakeResponse({ body: [resolved] });
      }
      return fakeResponse({ body: [] });
    };
    const withGames = (schedule: ScheduledGame[]): EspnClient =>
      ({
        getNFLGamesForPeriod: async (args: unknown) => {
          asked.push({ getNFLGamesForPeriod: args });
          return schedule;
        },
      }) as unknown as EspnClient;
    const deps: LinesDeps = {
      client: () => withGames(games),
      period: async () => ({
        seasonId: 2026,
        scoringPeriodId: 1,
        matchupPeriodId: 1,
        source: 'espn' as const,
      }),
      now: () => new Date('2026-09-14T13:00:00Z'),
      fetch: gamma,
    };
    const call = async (
      store: LiveStore,
      args: Record<string, unknown>,
      withDeps: LinesDeps = deps
    ): Promise<LinesSummary[]> => {
      const definition = createPolymarketLinesTool(store, withDeps);
      const result = (await definition.handler(args as never, {} as never)) as CallToolResult;
      return JSON.parse(textOf(result)) as LinesSummary[];
    };

    test('returns every game of the week in kickoff order, and fills live_lines for the week', async () => {
      const store: LiveStore = createLiveStore();
      urls.length = 0;

      const rows: LinesSummary[] = await call(store, {});

      expect(rows).toHaveLength(games.length);
      expect(rows[0]).toMatchObject({ away: 'NE', home: 'SEA' });
      expect(rows[rows.length - 1]).toMatchObject({ away: 'DEN', home: 'KC' });
      const table = store.filled().find((t) => t.name === 'live_lines');
      expect(table?.rows).toHaveLength(games.length);
      expect(table?.rows.every((row) => row.week === 1)).toBe(true);
    });

    test('fetches the full event only for games still to be played, and the moneyline for the rest', async () => {
      urls.length = 0;

      const rows: LinesSummary[] = await call(createLiveStore(), {});

      expect(
        urls.filter((u) => u.includes('/events?slug=')).map((u) => u.split('slug=')[1])
      ).toEqual(['nfl-den-kc-2026-09-15']);
      const denKcRow = rows.find((r) => r.home === 'KC');
      expect(denKcRow).toMatchObject({ detailed: true, spread: { favorite: 'KC', line: 2.5 } });
      const dalNyg = rows.find((r) => r.home === 'NYG');
      expect(dalNyg).toMatchObject({
        detailed: false,
        volume: 5813397,
        moneyline: { awayPrice: 0, homePrice: 1, closed: true },
      });
    });

    test('a finished game is asked for as a closed market first', async () => {
      urls.length = 0;

      await call(createLiveStore(), {});

      const dalNyg: string[] = urls.filter((u) => u.includes('nfl-dal-nyg-2026-09-14'));
      expect(dalNyg[0]).toMatch(/closed=true/);
    });

    test('a game Polymarket does not list, or whose fetch fails, is nulls and does not fail the call', async () => {
      const rows: LinesSummary[] = await call(createLiveStore(), {});

      expect(rows.find((r) => r.home === 'LAR')).toMatchObject({ event: null, moneyline: null });
      expect(rows.find((r) => r.home === 'PIT')).toMatchObject({ event: null, moneyline: null });
    });

    test('a named team gets the full event whatever its status', async () => {
      urls.length = 0;

      await call(createLiveStore(), { team: 'phi' });

      expect(urls.some((u) => u.includes('/events?slug=nfl-was-phi-2026-09-13'))).toBe(true);
    });

    test('with every game still to play, only the first few by kickoff get the full event', async () => {
      urls.length = 0;
      const allPending: ScheduledGame[] = games.map(
        (g: ScheduledGame): ScheduledGame => ({ ...g, gameStatus: 'Not Started' })
      );

      await call(createLiveStore(), {}, { ...deps, client: () => withGames(allPending) });

      expect(urls.filter((u) => u.includes('/events?slug=')).length).toBe(
        ASK.POLYMARKET.DETAIL_CAP
      );
      expect(urls.filter((u) => u.includes('/markets?slug=')).length).toBeGreaterThan(0);
    });

    test('another week reads the schedule for that week, shifted from the current one', async () => {
      asked.length = 0;

      await call(createLiveStore(), { week: 2 });

      expect(asked[0]).toEqual({
        getNFLGamesForPeriod: { startDate: '20260915', endDate: '20260922' },
      });
    });
  });
});
