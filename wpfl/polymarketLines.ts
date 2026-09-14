/**
 * Polymarket's prices on each NFL game of a week, as an /ask tool.
 *
 * ESPN's schedule feed knows kickoff and status but not a line: its odds
 * field is empty, and the sportsbook numbers sit behind a reference the fork
 * does not follow. Polymarket lists every NFL game as an event whose slug is
 * predictable from that schedule -- `nfl-<away>-<home>-<kickoff date, UTC>`
 * -- with a moneyline market of the same slug and a few hundred spread,
 * total and team-total markets beside it. A price is an implied probability
 * in dollars and a pair sums to one, so there is no bookmaker margin to strip;
 * volume is dollars traded, which is where the money is.
 *
 * Two fetch sizes, because a whole event is over a megabyte: the moneyline
 * market alone is six kilobytes and carries the event's volume, so every game
 * gets that; the full event, with the lines, is fetched only for the games
 * still to be played, up to a cap, or for the one game named.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ASK } from '../ask/askConfig.js';
import { leagueInstant, nflWeekWindow } from '../ask/leagueTime.js';
import { logError } from '../errors/index.js';
import type { NFLPeriod } from '../helpers/espnPeriod.js';
import { NFLGame } from '../espnClient.cjs';
import { API_CONFIG } from '../polymarket/polymarketConfig.js';
import { parseMarketArrayField } from '../polymarket/polymarketClient.js';
import { fetchWithTimeout, type FetchFn, type HttpResponse, type Query } from './wpflHttp.js';
import { gameStatusOf, type EspnDeps, type GameStatus } from './espnTools.js';
import { columnsProse, linesRows, type LiveStore } from './liveTables.js';
import { toToolResult, type AnyTool } from './toolResult.js';

/** What this reads of a scheduled NFL game from the fork's schedule lookup. */
export type ScheduledGame = Pick<NFLGame, 'gameStatus' | 'homeTeam' | 'awayTeam' | 'startTime'>;

/**
 * ESPN abbreviations Polymarket spells differently in its slugs. Every other
 * team is the ESPN abbreviation lower-cased (checked against all sixteen
 * week-one games).
 */
const SLUG_ALIAS: Readonly<Record<string, string>> = { LAR: 'la', WSH: 'was' };

export function slugTeam(abbrev: string): string {
  return SLUG_ALIAS[abbrev] ?? abbrev.toLowerCase();
}

/** `nfl-den-kc-2026-09-15`: away, home, and the kickoff's calendar date in UTC. */
export function polymarketSlug(game: ScheduledGame): string {
  const date: string = new Date(game.startTime).toISOString().slice(0, 10);
  return `nfl-${slugTeam(game.awayTeam.teamAbbrev)}-${slugTeam(game.homeTeam.teamAbbrev)}-${date}`;
}

/** The last word of ESPN's team name, which is how Polymarket names an outcome. */
function nickname(team: string): string {
  return team.trim().split(' ').pop() ?? team;
}

/** The fields this reads of a Polymarket market. `outcomes` and `outcomePrices` arrive as JSON strings. */
export interface GammaMarket {
  readonly slug: string;
  readonly question?: string;
  readonly outcomes?: string | string[];
  readonly outcomePrices?: string | string[];
  readonly volume?: string | number | null;
  readonly closed?: boolean;
  readonly sportsMarketType?: string;
  readonly line?: number | null;
  /** Change in the first outcome's price over the window, in price points. */
  readonly oneDayPriceChange?: number | null;
  readonly oneWeekPriceChange?: number | null;
  readonly oneMonthPriceChange?: number | null;
  readonly volume24hr?: string | number | null;
  /** On a market fetched alone, the event it belongs to. */
  readonly events?: readonly GammaEventStub[];
}

export interface GammaEventStub {
  readonly slug: string;
  readonly volume?: string | number | null;
  readonly volume24hr?: string | number | null;
  readonly closed?: boolean;
}

/**
 * How a side's price has moved, in price points, over Polymarket's three
 * windows. A month is the longest it reports; an NFL event opens weeks
 * before kickoff, so that is close to, but not always, the move since open.
 */
export interface PriceChange {
  readonly day: number;
  readonly week: number;
  readonly month: number;
}

export interface GammaEvent extends GammaEventStub {
  readonly markets: readonly GammaMarket[];
}

export interface Moneyline {
  readonly awayPrice: number;
  readonly homePrice: number;
  /** How the away side's price has moved; the home side moved the other way. */
  readonly awayChange: PriceChange;
  /** Dollars traded on the winner market, and in its last 24 hours. */
  readonly volume: number;
  readonly volume24h: number;
  /** True once trading has stopped: at kickoff, and after. */
  readonly closed: boolean;
}

export interface Spread {
  /** ESPN abbreviation of the side giving the points. */
  readonly favorite: string;
  readonly line: number;
  /** The favourite's price to cover, and how it has moved. */
  readonly price: number;
  readonly favoriteChange: PriceChange;
  readonly volume: number;
  readonly volume24h: number;
}

export interface Total {
  readonly line: number;
  readonly overPrice: number;
  readonly overChange: PriceChange;
  readonly volume: number;
  readonly volume24h: number;
}

export interface LinesSummary {
  readonly week: number;
  readonly away: string;
  readonly home: string;
  readonly awayName: string;
  readonly homeName: string;
  /** In the league timezone, like every other date the agent is shown. */
  readonly kickoff: string;
  readonly gameStatus: GameStatus;
  /** The Polymarket event slug, or null when Polymarket has no market for the game or it could not be fetched. */
  readonly event: string | null;
  /** Dollars traded across every market of the event, and in its last 24 hours. */
  readonly volume: number | null;
  readonly volume24h: number | null;
  readonly moneyline: Moneyline | null;
  /** True when the full event was fetched, so the lines below are present where Polymarket has them. */
  readonly detailed: boolean;
  readonly spread: Spread | null;
  readonly total: Total | null;
  readonly awayTeamTotal: Total | null;
  readonly homeTeamTotal: Total | null;
}

function dollars(value: string | number | null | undefined): number {
  const n: number = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Polymarket quotes in half-cents, so a price keeps three places where the tools' usual two would lose one. */
function price(value: string): number {
  const n: number = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function pricesOf(market: GammaMarket): number[] {
  return parseMarketArrayField(market.outcomePrices).map(price);
}

function outcomesOf(market: GammaMarket): string[] {
  return parseMarketArrayField(market.outcomes);
}

/** The index of the outcome named, or -1. */
function outcomeIndex(market: GammaMarket, name: string): number {
  return outcomesOf(market).findIndex(
    (outcome: string): boolean => outcome.toLowerCase() === name.toLowerCase()
  );
}

/** The price of the outcome named, else the first: the question names the side it is about first. */
function priceFor(market: GammaMarket, name: string): number {
  const index: number = outcomeIndex(market, name);
  const prices: number[] = pricesOf(market);
  return prices[index >= 0 ? index : 0] ?? 0;
}

/**
 * Polymarket reports each window's change on the first outcome's price. A
 * two-way market's other side moved by the same amount the other way, so a
 * change is read for the side asked about by flipping the sign when that
 * side is not the first outcome.
 */
function changeFor(market: GammaMarket, name: string): PriceChange {
  const sign: number = outcomeIndex(market, name) === 1 ? -1 : 1;
  const points = (value: number | null | undefined): number => price(String((value ?? 0) * sign));
  return {
    day: points(market.oneDayPriceChange),
    week: points(market.oneWeekPriceChange),
    month: points(market.oneMonthPriceChange),
  };
}

/** The most-traded market of a kind: the line the money settled on. Ties go to the price nearest a coin flip. */
function mostTraded(markets: readonly GammaMarket[]): GammaMarket | null {
  let best: GammaMarket | null = null;
  for (const market of markets) {
    if (best === null || dollars(market.volume) > dollars(best.volume)) best = market;
    else if (dollars(market.volume) === dollars(best.volume)) {
      const edge = (m: GammaMarket): number => Math.abs(0.5 - (pricesOf(m)[0] ?? 0));
      if (edge(market) < edge(best)) best = market;
    }
  }
  return best;
}

/** A market's line, from its own field or from its slug (`-spread-home-2pt5`, `-total-43pt5`). */
function lineOf(market: GammaMarket): number | null {
  if (typeof market.line === 'number') return Math.abs(market.line);
  const match: RegExpMatchArray | null = /-(\d+)pt(\d)$/.exec(market.slug);
  return match === null ? null : Number(`${match[1]}.${match[2]}`);
}

function ofKind(event: GammaEvent, kind: string): GammaMarket[] {
  return event.markets.filter((market: GammaMarket): boolean => market.sportsMarketType === kind);
}

export function moneylineOf(market: GammaMarket, game: ScheduledGame): Moneyline {
  const prices: number[] = pricesOf(market);
  const outcomes: string[] = outcomesOf(market);
  const awayIndex: number = outcomes.findIndex(
    (o: string): boolean => o.toLowerCase() === nickname(game.awayTeam.team).toLowerCase()
  );
  const homeIndex: number = outcomes.findIndex(
    (o: string): boolean => o.toLowerCase() === nickname(game.homeTeam.team).toLowerCase()
  );
  return {
    // Polymarket titles a game "Away vs. Home" and lists the outcomes in that order.
    awayPrice: prices[awayIndex >= 0 ? awayIndex : 0] ?? 0,
    homePrice: prices[homeIndex >= 0 ? homeIndex : 1] ?? 0,
    awayChange: changeFor(market, nickname(game.awayTeam.team)),
    volume: dollars(market.volume),
    volume24h: dollars(market.volume24hr),
    closed: market.closed === true,
  };
}

export function spreadOf(event: GammaEvent, game: ScheduledGame): Spread | null {
  const market: GammaMarket | null = mostTraded(ofKind(event, 'spreads'));
  if (market === null) return null;
  const side: RegExpMatchArray | null = /-spread-(home|away)-/.exec(market.slug);
  const line: number | null = lineOf(market);
  if (side === null || line === null) return null;
  const favorite: ScheduledGame['homeTeam'] = side[1] === 'home' ? game.homeTeam : game.awayTeam;
  return {
    favorite: favorite.teamAbbrev,
    line,
    price: priceFor(market, nickname(favorite.team)),
    favoriteChange: changeFor(market, nickname(favorite.team)),
    volume: dollars(market.volume),
    volume24h: dollars(market.volume24hr),
  };
}

function totalFrom(market: GammaMarket | null): Total | null {
  if (market === null) return null;
  const line: number | null = lineOf(market);
  if (line === null) return null;
  return {
    line,
    overPrice: priceFor(market, 'Over'),
    overChange: changeFor(market, 'Over'),
    volume: dollars(market.volume),
    volume24h: dollars(market.volume24hr),
  };
}

export function totalOf(event: GammaEvent): Total | null {
  return totalFrom(mostTraded(ofKind(event, 'totals')));
}

export function teamTotalOf(event: GammaEvent, abbrev: string): Total | null {
  const marker: string = `-team-total-${slugTeam(abbrev)}-`;
  return totalFrom(
    mostTraded(
      ofKind(event, 'team_totals').filter((market: GammaMarket): boolean =>
        market.slug.includes(marker)
      )
    )
  );
}

/** A game's summary from its schedule entry and whatever Polymarket returned for it. */
export function summarize(
  week: number,
  game: ScheduledGame,
  event: GammaEvent | null,
  moneylineMarket: GammaMarket | null
): LinesSummary {
  const stub: GammaEventStub | null = event ?? moneylineMarket?.events?.[0] ?? null;
  const moneyline: GammaMarket | null =
    moneylineMarket ?? (event === null ? null : (ofKind(event, 'moneyline')[0] ?? null));
  return {
    week,
    away: game.awayTeam.teamAbbrev,
    home: game.homeTeam.teamAbbrev,
    awayName: nickname(game.awayTeam.team),
    homeName: nickname(game.homeTeam.team),
    kickoff: leagueInstant(new Date(game.startTime)),
    gameStatus: gameStatusOf(game),
    event: stub?.slug ?? null,
    volume: stub === null ? null : dollars(stub.volume),
    volume24h: stub === null ? null : dollars(stub.volume24hr),
    moneyline: moneyline === null ? null : moneylineOf(moneyline, game),
    detailed: event !== null,
    spread: event === null ? null : spreadOf(event, game),
    total: event === null ? null : totalOf(event),
    awayTeamTotal: event === null ? null : teamTotalOf(event, game.awayTeam.teamAbbrev),
    homeTeamTotal: event === null ? null : teamTotalOf(event, game.homeTeam.teamAbbrev),
  };
}

// ---- fetching ----

async function gamma<T>(path: string, query: Query, fetchFn: FetchFn): Promise<T[]> {
  const url = new URL(`${API_CONFIG.BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response: HttpResponse = await fetchWithTimeout(
    url.toString(),
    fetchFn,
    `The Polymarket request to ${path}`,
    { timeoutMs: ASK.POLYMARKET.FETCH_TIMEOUT_MS }
  );
  if (!response.ok) throw new Error(`Polymarket returned HTTP ${response.status} for ${path}.`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error(`Polymarket returned an unexpected shape for ${path}.`);
  return body as T[];
}

/**
 * The moneyline market alone. Gamma lists open markets unless told otherwise
 * and a market closes at kickoff, so a game in progress or finished is asked
 * for as closed; the other flag is tried when the first returns nothing, since
 * ESPN's status and Polymarket's close can disagree by a few minutes.
 */
async function fetchMoneyline(
  slug: string,
  status: GameStatus,
  fetchFn: FetchFn
): Promise<GammaMarket | null> {
  const flags: readonly Query[] =
    status === 'not_started' ? [{}, { closed: true }] : [{ closed: true }, {}];
  for (const flag of flags) {
    const [market] = await gamma<GammaMarket>('/markets', { slug, ...flag }, fetchFn);
    if (market !== undefined) return market;
  }
  return null;
}

async function fetchEvent(slug: string, fetchFn: FetchFn): Promise<GammaEvent | null> {
  const [event] = await gamma<GammaEvent>('/events', { slug }, fetchFn);
  return event ?? null;
}

/** `fn` over `items`, at most `limit` in flight, results in order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next: number = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index: number = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Injected so the tool is tested without credentials or the network. */
export interface LinesDeps extends EspnDeps {
  readonly fetch?: FetchFn;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

export function createPolymarketLinesTool(store: LiveStore, deps: LinesDeps): AnyTool {
  return tool(
    'polymarket_lines',
    `Polymarket's prediction-market prices on every NFL game of a week: kickoff in league time, game status, the win price of each side, the dollars traded on the winner market and on the whole event and in each one's last 24 hours -- where the money is and when it showed up -- and, for the games still to be played (the first ${ASK.POLYMARKET.DETAIL_CAP} by kickoff) or the one game named by \`team\`, the most-traded spread with the favourite and its price to cover, the most-traded total with the over price, and each team's total. A price is an implied probability in dollars and a pair sums to 1, so there is no bookmaker margin; the most-traded line is the one the money settled on. Every price carries its change over the last day, week and month in price points (a month is the longest window Polymarket reports; an event opens weeks before kickoff, so that is close to the move since open), read for the side named -- the away side for the winner market, the favourite for the spread, the over for a total -- with the other side moved the same amount the other way. These are Polymarket's prices, not a sportsbook's, and there are no player props. A game Polymarket does not list, or that could not be fetched, has null prices; a finished game's win prices are 1 and 0. Also fills the table live_lines (${columnsProse('live_lines')}; one row per game, on ESPN team abbreviations, so it joins live_rosters on nfl_team) for \`sql\`, \`chart\` and \`table\` in this run.`,
    {
      week: z.number().int().optional().describe('NFL week. Defaults to the current one.'),
      team: z
        .string()
        .optional()
        .describe(
          "An ESPN team abbreviation, e.g. 'KC', for the full lines of that team's game whatever its status."
        ),
    },
    async (args): Promise<CallToolResult> => {
      const fetchFn: FetchFn = deps.fetch ?? fetch;
      const period: NFLPeriod = await deps.period();
      const week: number = args.week ?? period.scoringPeriodId;
      const now: Date = deps.now?.() ?? new Date();
      const shifted = new Date(now.getTime() + (week - period.scoringPeriodId) * 7 * DAY_MS);
      const games: ScheduledGame[] = [
        ...(await deps.client().getNFLGamesForPeriod(nflWeekWindow(shifted))),
      ].sort(
        (a: ScheduledGame, b: ScheduledGame): number =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
      const wanted: string | undefined = args.team?.trim().toUpperCase();
      let detailedLeft: number = ASK.POLYMARKET.DETAIL_CAP;
      const plan: { game: ScheduledGame; detailed: boolean }[] = games.map(
        (game: ScheduledGame) => {
          const named: boolean =
            wanted !== undefined &&
            (game.homeTeam.teamAbbrev === wanted || game.awayTeam.teamAbbrev === wanted);
          const pending: boolean = gameStatusOf(game) !== 'final' && detailedLeft > 0;
          if (pending) detailedLeft--;
          return { game, detailed: named || pending };
        }
      );
      const summaries: LinesSummary[] = await mapLimit(
        plan,
        ASK.POLYMARKET.CONCURRENCY,
        async ({ game, detailed }): Promise<LinesSummary> => {
          const slug: string = polymarketSlug(game);
          try {
            if (detailed) return summarize(week, game, await fetchEvent(slug, fetchFn), null);
            return summarize(
              week,
              game,
              null,
              await fetchMoneyline(slug, gameStatusOf(game), fetchFn)
            );
          } catch (error: unknown) {
            logError('polymarketLines', `Could not fetch Polymarket's ${slug}`, error);
            return summarize(week, game, null, null);
          }
        }
      );
      store.replaceWeek('live_lines', week, linesRows(summaries));
      return toToolResult(summaries);
    }
  );
}
