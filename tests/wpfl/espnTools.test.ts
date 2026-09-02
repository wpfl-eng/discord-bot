import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  toTeams,
  toBoxscores,
  toFreeAgents,
  toTransactions,
  espnTools,
  FREE_AGENT_LIMIT,
} from '../../wpfl/espnTools.js';

const load = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', name), 'utf8')) as T;

describe('espnTools', () => {
  describe('espn_teams', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = load<any[]>('espn-teams.json');

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
    const recording = load<any[]>('espn-boxscores.json');

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

    test('projects each lineup to name, slot and points', () => {
      const matchups = toBoxscores(recording);

      expect(matchups[0].home[0]).toEqual({ name: 'Puka Nacua', position: 'WR', points: 0 });
    });
  });

  describe('espn_free_agents', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = load<any[]>('espn-free-agents.json');

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

  describe('espn_transactions', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = load<any[][]>('espn-transactions.json');

    test('flattens topics into individual transactions', () => {
      const moves = toTransactions(recording);

      expect(moves).toHaveLength(recording.flat().length);
    });

    test('resolves the owner, the player and the date', () => {
      const moves = toTransactions(recording);

      expect(moves[0]).toEqual({
        date: '2026-08-31T18:34:36.058Z',
        action: 'FA ADDED',
        owner: 'Jimmy Simpson',
        toOwner: 'Jimmy Simpson',
        player: 'Jaylen Wright',
        bidAmount: 0,
      });
    });

    test('reads the player name from playerPoolEntry, which is where it actually is', () => {
      const action = recording[0][0];
      expect(action.player.player).toBeUndefined();
      expect(action.player.playerPoolEntry.player.fullName).toBe('Jaylen Wright');

      expect(toTransactions(recording)[0].player).toBe('Jaylen Wright');
    });

    test('falls back to player.player when playerPoolEntry is absent', () => {
      const action = {
        ...recording[0][0],
        player: { player: { fullName: 'Somebody Else' } },
      };

      expect(toTransactions([[action]])[0].player).toBe('Somebody Else');
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

    test('every ESPN description distinguishes itself from the historical sources', () => {
      for (const definition of espnTools) {
        expect(definition.description).toMatch(/history API|draft artifact|historical|sql tool/i);
      }
    });
  });
});
