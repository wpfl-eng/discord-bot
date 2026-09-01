import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  toTeams,
  toBoxscores,
  toFreeAgents,
  toTransactions,
  espnTools,
} from '../../wpfl/espnTools.js';

const load = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', name), 'utf8')) as T;

describe('espnTools', () => {
  describe('espn_teams', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recording = load<any[]>('espn-teams.json');

    test('names the owner from wpflMembers, because ESPN returns a blank team name', () => {
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

    test('filters by position when asked', () => {
      expect(toFreeAgents(recording, 'D/ST').map((p) => p.name)).toEqual(['Browns D/ST']);
      expect(toFreeAgents(recording, 'TQB').map((p) => p.name)).toEqual(['Baker Mayfield']);
      expect(toFreeAgents(recording, 'RB')).toEqual([]);
    });

    test('matches a position case-insensitively', () => {
      expect(toFreeAgents(recording, 'd/st').map((p) => p.name)).toEqual(['Browns D/ST']);
    });

    test('returns everyone when no position is given', () => {
      expect(toFreeAgents(recording)).toHaveLength(2);
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

    test('only espn_teams rides in the initial prompt', () => {
      const always: string[] = espnTools
        .filter((t) => t._meta?.['anthropic/alwaysLoad'] === true)
        .map((t) => t.name);

      expect(always).toEqual(['espn_teams']);
    });

    test('espn_transactions says it is current-season only', () => {
      const transactions = espnTools.find((t) => t.name === 'espn_transactions');

      // ESPN 404s /communication for prior seasons, so without this the agent
      // retries a historical question until it gives up.
      expect(transactions?.description).toMatch(/current season/i);
    });

    test('espn_teams says it is the source of truth for the season in progress', () => {
      const teams = espnTools.find((t) => t.name === 'espn_teams');

      expect(teams?.description).toMatch(/2026|current season/i);
    });
  });
});
