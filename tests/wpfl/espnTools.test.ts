import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  toTeams,
  toBoxscores,
  toFreeAgents,
  toTransactions,
  resolveOwners,
  espnTools,
  FREE_AGENT_LIMIT,
} from '../../wpfl/espnTools.js';
import { fixturePath, loadFixture } from './support.js';

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
    test('projects each lineup to name, slot, points and injury status', () => {
      const matchups = toBoxscores(recording);

      expect(matchups[0].home[0]).toEqual({
        name: 'Puka Nacua',
        position: 'WR',
        points: 0,
        injuryStatus: 'QUESTIONABLE',
      });
    });

    test('a player the feed gives no status for is null, not undefined', () => {
      const { injuryStatus, ...noStatus } = recording[0].homeRoster[0];
      expect(injuryStatus).toBeDefined();
      const matchups = toBoxscores([{ ...recording[0], homeRoster: [noStatus] }]);

      expect(matchups[0].home[0].injuryStatus).toBeNull();
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
      const mine = toBoxscores(boxscores, resolveOwners(['Nixon Ball']));

      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ homeOwner: 'Mike Simpson', awayOwner: 'Nixon Ball' });
      expect(toBoxscores(boxscores, resolveOwners(['Ryan Salchert']))[0].homeOwner).toBe(
        'Neill Bullock'
      );
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

      expect(toBoxscores([bye], resolveOwners(['Nixon Ball']))).toEqual([]);
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
      // Before kickoff the slate is fourteen lineups of zeroes; the schedule
      // and the sim odds are in the artifact.
      expect(boxscores?.description).toContain('teams.schedule');
    });

    test('every ESPN description distinguishes itself from the historical sources', () => {
      for (const definition of espnTools) {
        expect(definition.description).toMatch(/history API|draft artifact|historical|sql tool/i);
      }
    });
  });
});
