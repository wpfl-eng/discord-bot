// standings.test.js
import { jest } from "@jest/globals";
import { getStandings } from "../discordCommands/standings/standings.js";
import { espnMembers } from "../constants/espnMembers.js";

describe("Standings Command", () => {
  let mockEspnClient;

  beforeEach(() => {
    mockEspnClient = {
      getTeamsAtWeek: jest.fn(),
    };
  });

  test("getStandings returns correct standings string", async () => {
    const mockTeams = [
      { id: 1, wins: 10, losses: 3, ties: 0, playoffSeed: 1 },
      { id: 3, wins: 8, losses: 5, ties: 0, playoffSeed: 2 },
      { id: 4, wins: 3, losses: 10, ties: 0, playoffSeed: 3 },
    ];

    mockEspnClient.getTeamsAtWeek.mockResolvedValue(mockTeams);

    const result = await getStandings(mockEspnClient, 2023, 14);

    expect(mockEspnClient.getTeamsAtWeek).toHaveBeenCalledWith({
      seasonId: 2023,
      scoringPeriodId: 14,
    });

    const expectedOutput = [
      `#1 👑${espnMembers[0].name} (10-3-0)👑`,
      `#2 ${espnMembers[1].name} (8-5-0)`,
      `#3 💩${espnMembers[2].name} (3-10-0)💩`,
    ].join("\n");

    expect(result).toBe(expectedOutput);
  });

  test("getStandings handles unknown team members", async () => {
    const mockTeams = [
      { id: 999, wins: 10, losses: 3, ties: 0, playoffSeed: 1 },
    ];

    mockEspnClient.getTeamsAtWeek.mockResolvedValue(mockTeams);

    const result = await getStandings(mockEspnClient, 2023, 14);

    expect(result).toBe("#1 👑Unknown (10-3-0)👑");
  });
});
