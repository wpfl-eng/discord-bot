import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Client as EspnClient } from 'espn-fantasy-football-api/node.js';
import {
  toTeams,
  toBoxscores,
  toFreeAgents,
  toTransactions,
  resolveOwners,
  createEspnTools,
  constantStatus,
  statusLookupFromGames,
  FREE_AGENT_LIMIT,
  UNKNOWN_STATUS,
  type EspnDeps,
  type MatchupSummary,
  type NflGame,
} from '../../wpfl/espnTools.js';
import { createLiveStore, type LiveStore } from '../../wpfl/liveTables.js';
import type { AnyTool } from '../../wpfl/toolResult.js';
import { fixturePath, loadFixture, textOf } from './support.js';

// The definitions are the same text on every run; any store will do for
// reading them.
const espnTools: AnyTool[] = createEspnTools(createLiveStore());
// The week's NFL schedule, recorded the same Monday morning as the mid-week boxscores.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const games = loadFixture<any[]>('espn-nfl-games.json');

describe('espnTools', () => {
  describe('espn_teams', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = loadFixture<any[]>('espn-teams.json');

    // The recording was taken on a fork build that returned a blank name; the
    // current build returns real names and owners. The owner still comes from
    // the canonical table, because ESPN's spellings drift (design §7).
    test('names the owner from wpflMembers, not from whatever ESPN sends as the team name', () => {
      expect(recording[0].name).toBe(' ');

      const teams = toTeams(recording);

      expect(teams[0].owner).toBe('Nixon Ball');
      expect(teams[1].owner).toBe('Forrest Britton');
    });

    test('carries the record, seed and points that /standings sorts on', () => {
      const teams = toTeams(recording);

      expect(teams[0]).toMatchObject({
        espnId: 1,
        owner: 'Nixon Ball',
        wins: 0,
        losses: 0,
        ties: 0,
        playoffSeed: 14,
        pointsFor: 0,
      });
    });

    test('projects the roster down to what a fantasy question needs', () => {
      const teams = toTeams(recording);

      expect(teams[0].roster).toHaveLength(2);
      expect(teams[0].roster[0]).toEqual({
        name: 'Jeremiyah Love',
        position: 'RB',
        proTeam: 'ARI',
        injuryStatus: 'QUESTIONABLE',
        percentOwned: 99.35,
      });
    });

    test('does not leak the raw ESPN blob into the agent context', () => {
      const teams = toTeams(recording);

      expect(Object.keys(teams[0]).sort()).toEqual([
        'espnId',
        'losses',
        'owner',
        'playoffSeed',
        'pointsAgainst',
        'pointsFor',
        'roster',
        'ties',
        'wins',
      ]);
    });

    test('falls back to the ESPN id when a team has no mapped owner', () => {
      const teams = toTeams([{ ...recording[0], id: 99 }]);

      expect(teams[0].owner).toContain('99');
    });

    test('tolerates a team with no roster', () => {
      const { roster, ...noRoster } = recording[0];
      expect(roster).toBeDefined();

      expect(toTeams([noRoster])[0].roster).toEqual([]);
    });
  });

  describe('espn_boxscores', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = loadFixture<any[]>('espn-boxscores.json');

    test('names both owners and reports both scores', () => {
      const matchups = toBoxscores(recording);

      expect(matchups[0]).toMatchObject({
        homeOwner: 'Mike Simpson',
        awayOwner: 'Nixon Ball',
        homeScore: 0,
        awayScore: 0,
      });
      expect(matchups[1]).toMatchObject({ homeOwner: 'Neill Bullock', awayOwner: 'Ryan Salchert' });
    });

    // The status rides on the lineup so a matchup question is one call. The
    // first live one fetched all fourteen rosters to learn eighteen statuses.
    // The projection rides on the lineup too: it is what says why one side is
    // favoured and which starter the gap turns on.
    test('projects each lineup to name, slot, position, points, injury status, projection and game status', () => {
      const matchups = toBoxscores(recording);

      expect(matchups[0].home[0]).toEqual({
        name: 'Puka Nacua',
        slot: 'WR',
        position: 'WR',
        points: 0,
        injuryStatus: 'QUESTIONABLE',
        projected: 17.38,
        // No schedule passed: unknown, never a default of final.
        gameStatus: 'unknown',
      });
    });

    test('a player the feed gives no status for is null, not undefined', () => {
      const { injuryStatus, ...noStatus } = recording[0].homeRoster[0];
      expect(injuryStatus).toBeDefined();
      const matchups = toBoxscores([{ ...recording[0], homeRoster: [noStatus] }]);

      expect(matchups[0].home[0].injuryStatus).toBeNull();
    });

    // ESPN sends a player's projection as a per-item breakdown; the fork maps
    // the items and nothing totals them. A player it has nothing for -- IR, a
    // bye -- comes back as an empty breakdown, or none at all.
    test('a player ESPN has no projection for projects 0, not NaN or undefined', () => {
      const { projectedPointBreakdown, ...noBreakdown } = recording[0].homeRoster[0];
      expect(projectedPointBreakdown).toBeDefined();
      const matchups = toBoxscores([
        {
          ...recording[0],
          homeRoster: [
            noBreakdown,
            { ...noBreakdown, projectedPointBreakdown: { usesPoints: true } },
          ],
        },
      ]);

      expect(matchups[0].home.map((p) => p.projected)).toEqual([0, 0]);
    });

    // The run that prompted this answered "who's favoured" from the draft sim
    // and wrote "no per-week win probability is published" -- while the fork
    // had ESPN's at 0.53 for that game and this projection dropped it.
    test("carries ESPN's projected total and win probability for each side", () => {
      const matchups = toBoxscores(recording);

      expect(matchups[0]).toMatchObject({
        homeProjected: 105.66,
        awayProjected: 103.26,
        homeWinProbability: 0.51,
        awayWinProbability: 0.49,
      });
    });

    // ESPN publishes those for the current matchup period only. For any other
    // week the fork leaves them undefined, which JSON.stringify would drop, and
    // the agent could not tell "not published" from "not a field this tool has".
    test('a week ESPN publishes no projection for is null, not missing', () => {
      const {
        homeProjectedScore,
        awayProjectedScore,
        homeWinProbability,
        awayWinProbability,
        ...pastWeek
      } = recording[0];
      expect([
        homeProjectedScore,
        awayProjectedScore,
        homeWinProbability,
        awayWinProbability,
      ]).not.toContain(undefined);
      const [matchup] = toBoxscores([pastWeek]);

      // toMatchObject does not equate undefined with null, so "not missing" holds.
      expect(matchup).toMatchObject({
        homeProjected: null,
        awayProjected: null,
        homeWinProbability: null,
        awayWinProbability: null,
      });
    });

    test('does not leak the raw ESPN matchup into the agent context', () => {
      const matchups = toBoxscores(recording);

      expect(Object.keys(matchups[0]).sort()).toEqual([
        'away',
        'awayOptimalPoints',
        'awayOwner',
        'awayPendingProjected',
        'awayPendingStarters',
        'awayPointsLeft',
        'awayProjected',
        'awayResult',
        'awayScore',
        'awayWinProbability',
        'decided',
        'home',
        'homeOptimalPoints',
        'homeOwner',
        'homePendingProjected',
        'homePendingStarters',
        'homePointsLeft',
        'homeProjected',
        'homeResult',
        'homeScore',
        'homeWinProbability',
      ]);
    });
  });

  /**
   * A Monday morning (why: MatchupSummary.decided in wpfl/espnTools.ts). The
   * recording is two whole matchups from one: Mike Simpson v Nixon Ball with
   * Bo Nix still to play that night, and AJ Boorde v Forrest Britton with
   * nobody left, both still UNDECIDED at ESPN.
   */
  describe('the week in progress', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const midweek = loadFixture<any[]>('espn-boxscores-midweek.json');
    const status = statusLookupFromGames(games);
    const [pending, done] = toBoxscores(midweek, status);
    const byName = (side: MatchupSummary['home'], name: string) => {
      const entry = side.find((e) => e.name === name);
      if (entry === undefined) throw new Error(`no ${name}`);
      return entry;
    };
    const team = (abbrev: string): NflGame['homeTeam'] => ({
      id: 0,
      team: abbrev,
      teamAbbrev: abbrev,
      record: '0-0',
      score: 0,
    });
    const game = (gameStatus: string, home: string, away: string): NflGame => ({
      gameStatus,
      homeTeam: team(home),
      awayTeam: team(away),
    });

    test('a starter whose game has not started is not_started, not a zero', () => {
      expect(byName(pending.away, 'Bo Nix')).toMatchObject({
        slot: 'QB',
        points: 0,
        gameStatus: 'not_started',
      });
    });

    test('a starter whose game is final and who scored nothing is final at 0', () => {
      expect(byName(pending.away, 'Kyle Pitts Sr.')).toMatchObject({
        slot: 'TE',
        points: 0,
        gameStatus: 'final',
      });
    });

    test('counts the starters still to play, with what ESPN projects for them, on each side', () => {
      expect(pending).toMatchObject({
        homePendingStarters: 0,
        homePendingProjected: 0,
        awayPendingStarters: 1,
        awayPendingProjected: 16.12,
      });
    });

    test('a bench player with a game left does not make a matchup pending', () => {
      expect(byName(done.home, 'Xavier Worthy')).toMatchObject({
        slot: 'Bench',
        gameStatus: 'not_started',
      });
      expect(done.homePendingStarters).toBe(0);
    });

    test('is undecided while a starter has a game left, whatever the win probability says', () => {
      expect(pending.awayWinProbability).toBe(0.99);
      expect(pending).toMatchObject({ decided: false, homeResult: null, awayResult: null });
    });

    test('is decided once no starter on either side has a game left, before ESPN has settled it', () => {
      expect(midweek[1].winner).toBe('UNDECIDED');
      expect(done).toMatchObject({ decided: true, homeResult: 'loss', awayResult: 'win' });
    });

    test("takes ESPN's call over the scores once it has made one, whatever the statuses", () => {
      const [settled] = toBoxscores([{ ...midweek[1], winner: 'HOME' }], status);
      expect(settled).toMatchObject({ decided: true, homeResult: 'win', awayResult: 'loss' });
      const [tied] = toBoxscores([{ ...midweek[1], winner: 'TIE' }], status);
      expect(tied).toMatchObject({ homeResult: 'tie', awayResult: 'tie' });
      const [unknownButSettled] = toBoxscores([{ ...midweek[1], winner: 'AWAY' }], UNKNOWN_STATUS);
      expect(unknownButSettled).toMatchObject({
        decided: true,
        homeResult: 'loss',
        awayResult: 'win',
      });
    });

    // Checked by brute force over every legal assignment of the same roster.
    test('carries the best lineup each roster could have started, and the gap to the score', () => {
      expect(pending).toMatchObject({
        homeScore: 90.24,
        homeOptimalPoints: 123.7,
        homePointsLeft: 33.46,
        awayOptimalPoints: 121.8,
        awayPointsLeft: 0,
      });
    });

    test('leaves a player in the IR slot out of the optimal lineup', () => {
      expect(byName(done.away, 'Zach Charbonnet').slot).toBe('IR');
      const [withoutIr] = toBoxscores(
        [
          {
            ...midweek[1],
            awayRoster: midweek[1].awayRoster.filter(
              (p: { rosteredPosition: string }) => p.rosteredPosition !== 'IR'
            ),
          },
        ],
        status
      );
      expect(withoutIr.awayOptimalPoints).toBe(done.awayOptimalPoints);
    });

    test('a team with no game in the window is on bye; a status the fork does not name is unknown', () => {
      expect(status('KC')).toBe('not_started');
      expect(status('LAR')).toBe('final');
      expect(status('XXX')).toBe('bye');
      expect(status(undefined)).toBe('unknown');
      expect(statusLookupFromGames([game('Halftime?', 'KC', 'DEN')])('KC')).toBe('unknown');
      expect(statusLookupFromGames([game('In Progress', 'KC', 'DEN')])('DEN')).toBe('in_progress');
    });

    test('with no schedule, nobody is countable as pending and nothing is decided unless ESPN settled it', () => {
      const [unknown] = toBoxscores([midweek[1]], UNKNOWN_STATUS);
      expect(unknown).toMatchObject({
        decided: false,
        homePendingStarters: null,
        awayPendingStarters: null,
        homeResult: null,
      });
    });

    test('a past week is final for everyone, so it is decided on the scores', () => {
      const [past] = toBoxscores([midweek[0]], constantStatus('final'));
      expect(past).toMatchObject({ decided: true, homeResult: 'loss', awayResult: 'win' });
      expect(byName(past.away, 'Bo Nix').gameStatus).toBe('final');
    });

    test('a bye week for an owner is decided when their own starters are done, with no result', () => {
      const [bye] = toBoxscores(
        [{ ...midweek[1], awayTeamId: undefined, awayScore: undefined, awayRoster: [] }],
        status
      );
      expect(bye).toMatchObject({
        awayOwner: null,
        decided: true,
        homeResult: null,
        awayResult: null,
        awayPendingStarters: null,
        awayOptimalPoints: null,
        awayPointsLeft: null,
      });
    });
  });

  /**
   * Measured on the first live matchup question: espn_teams returned all
   * fourteen rosters, ~30 KB and the largest result in the run, to answer for
   * two of them, and espn_boxscores the whole slate for one game.
   */
  describe('the owners filter', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teams = loadFixture<any[]>('espn-teams.json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boxscores = loadFixture<any[]>('espn-boxscores.json');

    test('no filter means the whole league', () => {
      expect(resolveOwners(undefined)).toBeUndefined();
      expect(resolveOwners([])).toBeUndefined();
      expect(toTeams(teams)).toHaveLength(teams.length);
    });

    test('keeps only the rosters asked for', () => {
      const kept = toTeams(teams, resolveOwners(['Forrest Britton']));

      expect(kept.map((t) => t.owner)).toEqual(['Forrest Britton']);
    });

    test('keeps a matchup when either side was asked for', () => {
      const mine = toBoxscores(boxscores, UNKNOWN_STATUS, resolveOwners(['Nixon Ball']));

      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ homeOwner: 'Mike Simpson', awayOwner: 'Nixon Ball' });
      expect(
        toBoxscores(boxscores, UNKNOWN_STATUS, resolveOwners(['Ryan Salchert']))[0].homeOwner
      ).toBe('Neill Bullock');
    });

    test('matches the canonical spelling case-insensitively', () => {
      expect([...(resolveOwners(['forrest britton', ' NIXON BALL ']) ?? [])].sort()).toEqual([
        'Forrest Britton',
        'Nixon Ball',
      ]);
    });

    // An empty result would read as "no such team". A refusal that lists the
    // spellings costs one retry instead of a wrong answer.
    test('refuses a spelling that is not canonical, and says which ones are', () => {
      expect(() => resolveOwners(['Forrest'])).toThrow(/Unknown owner: Forrest/);
      expect(() => resolveOwners(['Forrest', 'Nixon Ball'])).toThrow(/Forrest Britton/);
      expect(() => resolveOwners(['Forrest', 'AJ'])).toThrow(/Unknown owners: Forrest, AJ/);
    });

    test('a matchup with no away team never matches a filter', () => {
      const bye = { ...boxscores[0], awayTeamId: undefined };

      expect(toBoxscores([bye], UNKNOWN_STATUS, resolveOwners(['Nixon Ball']))).toEqual([]);
      expect(toBoxscores([bye])).toHaveLength(1);
    });
  });

  describe('espn_free_agents', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = loadFixture<any[]>('espn-free-agents.json');

    test('projects to the fields that decide a waiver claim', () => {
      const players = toFreeAgents(recording);

      expect(players[0]).toEqual({
        name: 'Browns D/ST',
        position: 'D/ST',
        proTeam: 'CLE',
        percentOwned: 60.84,
        percentChange: -0.4,
        auctionValueAverage: 0.84,
        isInjured: false,
      });
    });

    // This asserted that 'TQB' found Baker Mayfield: the recording carries the
    // fork's slot label for him, and the test had encoded the bug below.
    test('filters by position when asked', () => {
      expect(toFreeAgents(recording, 'D/ST').map((p) => p.name)).toEqual(['Browns D/ST']);
      expect(toFreeAgents(recording, 'QB').map((p) => p.name)).toEqual(['Baker Mayfield']);
      expect(toFreeAgents(recording, 'TQB')).toEqual([]);
      expect(toFreeAgents(recording, 'RB')).toEqual([]);
    });

    /**
     * Measured live, 2026-09-02 (log Stage 14): the fork's `defaultPosition`
     * is the *slot* whose id equals the player's position id, so the free
     * agent pool comes back as {TQB, RB, RB/WR, WR, WR/TE, D/ST} -- a real
     * WR is labelled RB/WR, a real TE is labelled WR, a kicker WR/TE. The
     * first live question asked for WRs and was handed Hunter Henry, Kenyon
     * Sadiq, Dalton Schultz and Pat Freiermuth. `eligiblePositions` still
     * carries the bare position, so that is what the tools read.
     */
    describe('the position comes from eligiblePositions, not the slot label', () => {
      const probe = (
        fullName: string,
        defaultPosition: string,
        eligiblePositions: (string | null)[],
        percentOwned: number
      ) => ({
        ...recording[0],
        fullName,
        defaultPosition,
        eligiblePositions,
        percentOwned,
      });
      const pool = [
        probe('Hunter Henry', 'WR', ['WR/TE', 'TE', 'RB/WR/TE', 'OP', 'Bench', 'IR'], 57.7),
        probe('Marvin Mims', 'RB/WR', ['WR', 'WR/TE', 'RB/WR', 'RB/WR/TE', 'OP', 'Bench'], 40.2),
        probe('Baker Mayfield', 'TQB', ['QB', 'OP'], 60.8),
        probe('Jake Elliott', 'WR/TE', ['K', 'Bench'], 30.1),
        probe('Bucky Irving', 'RB', ['RB', 'RB/WR', 'RB/WR/TE', 'Bench'], 88.0),
        probe('Browns D/ST', 'D/ST', ['D/ST', 'Bench'], 12.0),
      ];

      test('labels each player by their bare position', () => {
        const positions: Record<string, string> = Object.fromEntries(
          toFreeAgents(pool).map((p) => [p.name, p.position])
        );

        expect(positions).toEqual({
          'Hunter Henry': 'TE',
          'Marvin Mims': 'WR',
          'Baker Mayfield': 'QB',
          'Jake Elliott': 'K',
          'Bucky Irving': 'RB',
          'Browns D/ST': 'D/ST',
        });
      });

      test('a WR filter returns receivers, not the tight ends the slot label points at', () => {
        expect(toFreeAgents(pool, 'WR').map((p) => p.name)).toEqual(['Marvin Mims']);
        expect(toFreeAgents(pool, 'TE').map((p) => p.name)).toEqual(['Hunter Henry']);
      });

      test('falls back to the label when no bare position is listed', () => {
        const odd = [probe('Mystery', 'FLEX', ['RB/WR/TE', null], 1)];

        expect(toFreeAgents(odd)[0].position).toBe('FLEX');
      });

      test('roster entries are labelled the same way', () => {
        const teams = toTeams([
          {
            ...recording[0],
            id: 4,
            wins: 0,
            losses: 0,
            ties: 0,
            playoffSeed: 1,
            roster: [probe('Baker Mayfield', 'TQB', ['QB', 'OP'], 60.8)],
          } as never,
        ]);

        expect(teams[0].roster[0].position).toBe('QB');
      });
    });

    test('matches a position case-insensitively', () => {
      expect(toFreeAgents(recording, 'd/st').map((p) => p.name)).toEqual(['Browns D/ST']);
    });

    test('returns everyone when no position is given', () => {
      expect(toFreeAgents(recording)).toHaveLength(2);
    });

    // Measured live: 837 free agents, ~140 KB, ~35K tokens in one tool result.
    // The pool is long-tailed -- almost all of it is players nobody would pick
    // up -- so the cap keeps the useful end and says it truncated.
    describe('the pool is capped', () => {
      const many = Array.from({ length: 300 }, (_, i) => ({
        ...recording[0],
        id: i,
        fullName: `Player ${i}`,
        defaultPosition: 'RB',
        percentOwned: i, // ascending, so the most-owned are last
      }));

      test('returns at most FREE_AGENT_LIMIT players', () => {
        expect(toFreeAgents(many).length).toBe(FREE_AGENT_LIMIT);
      });

      test('keeps the most-owned end of the pool, not whatever ESPN listed first', () => {
        const kept = toFreeAgents(many);

        expect(kept[0].name).toBe('Player 299');
        expect(kept[0].percentOwned).toBe(299);
        expect(kept[kept.length - 1].percentOwned).toBe(300 - FREE_AGENT_LIMIT);
      });

      test('does not cap a result that already fits', () => {
        expect(toFreeAgents(recording)).toHaveLength(2);
      });

      test('sorts a short result too, so the answer leads with the relevant player', () => {
        const kept = toFreeAgents(recording);

        expect(kept[0].percentOwned).toBeGreaterThanOrEqual(kept[1].percentOwned ?? 0);
      });
    });
  });

  /**
   * ESPN member ids -- the SWID half of the cookie pair -- ride on every team
   * object the fork returns. The recording script redacts them to the zero
   * GUID; this holds every fixture to it, because the repository is public.
   */
  test('no fixture carries an ESPN member id', () => {
    const dir: string = path.dirname(fixturePath('espn-teams.json'));
    const guid = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g;
    for (const file of fs.readdirSync(dir)) {
      const found: string[] = (
        fs.readFileSync(path.join(dir, file), 'utf8').match(guid) ?? []
      ).filter((id: string): boolean => id !== '{00000000-0000-0000-0000-000000000000}');
      expect({ file, found }).toEqual({ file, found: [] });
    }
  });

  describe('espn_transactions', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = loadFixture<any[][]>('espn-transactions.json');

    test('flattens topics into individual transactions', () => {
      const moves = toTransactions(recording);

      expect(moves).toHaveLength(recording.flat().length);
    });

    test('resolves the owner, the player and the date', () => {
      const moves = toTransactions(recording);

      expect(moves[0]).toEqual({
        date: '2026-08-31 14:34 EDT',
        action: 'FA ADDED',
        owner: 'Jimmy Simpson',
        toOwner: 'Jimmy Simpson',
        player: 'Jaylen Wright',
        bidAmount: 0,
      });
    });

    // The fork resolves the name across both shapes now and hands it over as `playerName`, so this
    // no longer reaches into the raw player itself. The raw assertions stay: they document why the
    // resolution is needed at all -- an FA ADDED action carries `playerPoolEntry` and no `player`.
    test('takes the resolved playerName the fork supplies', () => {
      const action = recording[0][0];
      expect(action.player.player).toBeUndefined();
      expect(action.player.playerPoolEntry.player.fullName).toBe('Jaylen Wright');
      expect(action.playerName).toBe('Jaylen Wright');

      expect(toTransactions(recording)[0].player).toBe('Jaylen Wright');
    });

    test('reports Unknown Player when the fork could not resolve a name', () => {
      const action = { ...recording[0][0], playerName: undefined, player: null };

      expect(toTransactions([[action]])[0].player).toBe('Unknown Player');
    });

    test('leaves toOwner null on a move with no destination', () => {
      const action = { ...recording[0][0], ids: {} };

      expect(toTransactions([[action]])[0].toOwner).toBeNull();
    });
  });

  describe('the MCP tool definitions', () => {
    test('exposes exactly four ESPN tools', () => {
      expect(espnTools.map((t) => t.name).sort()).toEqual([
        'espn_boxscores',
        'espn_free_agents',
        'espn_teams',
        'espn_transactions',
      ]);
    });

    // This asserted that only espn_teams rode in the initial prompt. Stage 14
    // reversed the split: every schema loads upfront, declared once on the
    // server (tests/wpfl/mcpServer.test.ts), so no definition carries a flag.
    test('carries no alwaysLoad of its own; the server declares it for all eight', () => {
      for (const definition of espnTools) {
        expect(definition._meta?.['anthropic/alwaysLoad']).toBeUndefined();
      }
    });

    test('espn_transactions says it is current-season only', () => {
      const transactions = espnTools.find((t) => t.name === 'espn_transactions');

      // ESPN 404s /communication for prior seasons, so without this the agent
      // retries a historical question until it gives up.
      expect(transactions?.description).toMatch(/current season/i);
    });

    // It used to send a historical question to "the sql tool", where no
    // transactions table existed; the agent concluded the data did not exist.
    test('espn_transactions names the cached table that holds past seasons', () => {
      const transactions = espnTools.find((t) => t.name === 'espn_transactions');

      expect(transactions?.description).toContain('wpfl_transactions');
    });

    test('espn_teams says it is the live source for the season in progress', () => {
      const teams = espnTools.find((t) => t.name === 'espn_teams');

      expect(teams?.description).toMatch(/live/i);
      expect(teams?.description).toMatch(/season in progress|current season/i);
    });

    test('the two big tools say how to ask for less than the whole league', () => {
      const teams = espnTools.find((t) => t.name === 'espn_teams');
      const boxscores = espnTools.find((t) => t.name === 'espn_boxscores');

      expect(teams?.description).toContain('`owners`');
      expect(boxscores?.description).toContain('`owners`');
      // A future week's opponent, and the sim's odds for every week, are in
      // the artifact; ESPN has nothing for a week it is not yet scoring.
      expect(boxscores?.description).toContain('teams.schedule');
    });

    // The description used to send "who's favoured" to the artifact's sim.
    // That is a season forecast frozen on draft night; the week's forecast is
    // ESPN's, and it is in this tool's own result.
    test('espn_boxscores says it carries the projections and win probability, and for which week', () => {
      const boxscores = espnTools.find((t) => t.name === 'espn_boxscores');

      expect(boxscores?.description).toMatch(/projected total/i);
      expect(boxscores?.description).toMatch(/win probability/i);
      expect(boxscores?.description).toMatch(/current week only/i);
      expect(boxscores?.description).toMatch(/draft-night sim/i);
    });

    test('every ESPN description distinguishes itself from the historical sources', () => {
      for (const definition of espnTools) {
        expect(definition.description).toMatch(/history API|draft artifact|historical|sql tool/i);
      }
    });

    test('every ESPN description names the live tables it fills', () => {
      const fills: Record<string, string[]> = {
        espn_teams: ['live_standings', 'live_rosters'],
        espn_boxscores: ['live_matchups', 'live_lineups'],
        espn_free_agents: ['live_free_agents'],
        espn_transactions: ['live_transactions'],
      };
      for (const definition of espnTools) {
        for (const table of fills[definition.name]) {
          expect(definition.description).toContain(table);
        }
      }
    });
  });

  /**
   * Each fetch fills the run's live tables (wpfl/liveTables.ts) so `sql`,
   * `chart` and `table` can read the season in progress. Filled from the
   * whole fetch, before the `owners` filter is applied to what the model
   * reads: a "rank the league" over a live table must never be a two-row
   * ranking because the question named two teams.
   */
  describe('the live tables the tools fill', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teams = loadFixture<any[]>('espn-teams.json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boxscores = loadFixture<any[]>('espn-boxscores.json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freeAgents = loadFixture<any[]>('espn-free-agents.json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactions = loadFixture<any[][]>('espn-transactions.json');

    const asked: Record<string, unknown>[] = [];
    const fakeClient = {
      getTeamsAtWeek: async (args: unknown) => {
        asked.push({ getTeamsAtWeek: args });
        return teams;
      },
      getBoxscoreForWeek: async (args: unknown) => {
        asked.push({ getBoxscoreForWeek: args });
        return boxscores;
      },
      getNFLGamesForPeriod: async (args: unknown) => {
        asked.push({ getNFLGamesForPeriod: args });
        return games;
      },
      getFreeAgents: async () => freeAgents,
      getRecentActivity: async () => transactions,
    } as unknown as EspnClient;
    const deps: EspnDeps = {
      client: () => fakeClient,
      period: async () => ({
        seasonId: 2026,
        scoringPeriodId: 1,
        matchupPeriodId: 1,
        source: 'espn' as const,
      }),
      // A Monday morning in the league timezone: 13:00 UTC.
      now: () => new Date('2026-09-14T13:00:00Z'),
    };

    const invoke = async (
      store: LiveStore,
      name: string,
      args: Record<string, unknown>,
      withDeps: EspnDeps = deps
    ): Promise<string> => {
      const definition = createEspnTools(store, withDeps).find((t) => t.name === name);
      if (definition === undefined) throw new Error(`no tool ${name}`);
      return textOf((await definition.handler(args as never, {} as never)) as CallToolResult);
    };
    const call = async (
      store: LiveStore,
      name: string,
      args: Record<string, unknown>,
      withDeps: EspnDeps = deps
    ): Promise<unknown[]> => JSON.parse(await invoke(store, name, args, withDeps)) as unknown[];
    const rowsOf = (store: LiveStore, table: string): readonly Record<string, unknown>[] =>
      store.filled().find((t) => t.name === table)?.rows ?? [];

    test('espn_teams fills standings and rosters for the whole league while the result is filtered', async () => {
      const store: LiveStore = createLiveStore();

      const result: unknown[] = await call(store, 'espn_teams', { owners: ['Forrest Britton'] });

      expect(result).toHaveLength(1);
      const league = toTeams(teams);
      expect(rowsOf(store, 'live_standings')).toHaveLength(league.length);
      expect(rowsOf(store, 'live_rosters')).toHaveLength(
        league.reduce((n: number, team): number => n + team.roster.length, 0)
      );
      expect(rowsOf(store, 'live_standings')[0]).toMatchObject({ owner: 'Nixon Ball', espn_id: 1 });
    });

    test('espn_boxscores fills matchups and lineups for the whole slate, under the week it asked ESPN for', async () => {
      const store: LiveStore = createLiveStore();
      asked.length = 0;

      const result: unknown[] = await call(store, 'espn_boxscores', {
        owners: ['Nixon Ball'],
        week: 3,
      });

      expect(result).toHaveLength(1);
      const matchups = rowsOf(store, 'live_matchups');
      expect(matchups).toHaveLength(toBoxscores(boxscores).length * 2);
      expect(matchups.every((row) => row.week === 3)).toBe(true);
      expect(asked[0]).toEqual({
        getBoxscoreForWeek: { seasonId: 2026, matchupPeriodId: 3, scoringPeriodId: 3 },
      });
      expect(rowsOf(store, 'live_lineups').length).toBeGreaterThan(0);
      expect(rowsOf(store, 'live_lineups').every((row) => row.week === 3)).toBe(true);
    });

    test('a second week lands beside the first rather than over it', async () => {
      const store: LiveStore = createLiveStore();

      await call(store, 'espn_boxscores', { week: 1 });
      await call(store, 'espn_boxscores', { week: 2 });
      await call(store, 'espn_boxscores', { week: 2 });

      const weeks: unknown[] = rowsOf(store, 'live_matchups').map((row) => row.week);
      expect(weeks.filter((w) => w === 1)).toHaveLength(toBoxscores(boxscores).length * 2);
      expect(weeks.filter((w) => w === 2)).toHaveLength(toBoxscores(boxscores).length * 2);
    });

    test('the week defaults to the current period', async () => {
      const store: LiveStore = createLiveStore();

      await call(store, 'espn_boxscores', {});

      expect(rowsOf(store, 'live_matchups').every((row) => row.week === 1)).toBe(true);
    });

    // The schedule is one more ESPN call, so only the week with games in
    // flight pays for it: a past week is final and a future one not started.
    test('the current week fetches the schedule for its window and stamps every lineup row with a game status', async () => {
      const store: LiveStore = createLiveStore();
      asked.length = 0;

      await call(store, 'espn_boxscores', {});

      expect(asked[0]).toEqual({
        getNFLGamesForPeriod: { startDate: '20260908', endDate: '20260915' },
      });
      const statuses = new Set(rowsOf(store, 'live_lineups').map((row) => row.game_status));
      expect(statuses.has('unknown')).toBe(false);
      expect(statuses.has('final')).toBe(true);
    });

    test('a past week is final for everyone without a schedule call', async () => {
      const store: LiveStore = createLiveStore();
      const later: EspnDeps = {
        ...deps,
        period: async () => ({
          seasonId: 2026,
          scoringPeriodId: 3,
          matchupPeriodId: 3,
          source: 'espn' as const,
        }),
      };
      asked.length = 0;

      await call(store, 'espn_boxscores', { week: 1 }, later);

      expect(asked.some((a) => 'getNFLGamesForPeriod' in a)).toBe(false);
      expect(rowsOf(store, 'live_lineups').every((row) => row.game_status === 'final')).toBe(true);
      expect(rowsOf(store, 'live_matchups').every((row) => row.decided === true)).toBe(true);
    });

    test('a future week has not started, without a schedule call', async () => {
      const store: LiveStore = createLiveStore();
      asked.length = 0;

      await call(store, 'espn_boxscores', { week: 3 });

      expect(asked.some((a) => 'getNFLGamesForPeriod' in a)).toBe(false);
      expect(rowsOf(store, 'live_lineups').every((row) => row.game_status === 'not_started')).toBe(
        true
      );
    });

    test('a schedule the fork cannot fetch leaves every status unknown and the boxscore whole', async () => {
      const store: LiveStore = createLiveStore();
      const scoreboardDown: EspnDeps = {
        ...deps,
        client: () =>
          ({
            ...fakeClient,
            getNFLGamesForPeriod: async () => {
              throw new Error('scoreboard down');
            },
          }) as unknown as EspnClient,
      };

      const rows: unknown[] = await call(store, 'espn_boxscores', {}, scoreboardDown);

      expect(rows).toHaveLength(toBoxscores(boxscores).length);
      expect(rowsOf(store, 'live_lineups').every((row) => row.game_status === 'unknown')).toBe(
        true
      );
      expect(rowsOf(store, 'live_matchups').every((row) => row.pending_starters === null)).toBe(
        true
      );
    });

    test('espn_free_agents and espn_transactions fill their tables', async () => {
      const store: LiveStore = createLiveStore();

      await call(store, 'espn_free_agents', {});
      await call(store, 'espn_transactions', {});

      expect(rowsOf(store, 'live_free_agents')).toHaveLength(toFreeAgents(freeAgents).length);
      expect(rowsOf(store, 'live_transactions')).toHaveLength(toTransactions(transactions).length);
      expect(rowsOf(store, 'live_transactions')[0]).toMatchObject({
        action: 'FA ADDED',
        owner: 'Jimmy Simpson',
        player: 'Jaylen Wright',
        bid_amount: 0,
      });
    });
  });
});
