/**
 * ESPN Fantasy Football league member mappings
 */

export interface EspnMember {
  readonly id: number;
  readonly name: string;
}

export const espnMembers: readonly EspnMember[] = [
  { id: 1, name: 'Nixon' },
  { id: 3, name: 'Forrest' },
  { id: 4, name: 'AJ' },
  { id: 5, name: 'Jimmy' },
  { id: 6, name: 'Dave' },
  { id: 7, name: 'Ryan' },
  { id: 8, name: 'Mike S' },
  { id: 9, name: 'Todd' },
  { id: 10, name: 'Adler' },
  { id: 11, name: 'Neill' },
  { id: 12, name: 'Doug' },
  { id: 13, name: 'Rick' },
  { id: 14, name: 'Mike H' },
  { id: 15, name: 'Mims' },
] as const;

/**
 * Find an ESPN member by their ID
 */
export function getEspnMemberById(id: number): EspnMember | undefined {
  return espnMembers.find((m) => m.id === id);
}

/**
 * Find an ESPN member by their name (case-insensitive)
 */
export function getEspnMemberByName(name: string): EspnMember | undefined {
  const lowerName = name.toLowerCase();
  return espnMembers.find((m) => m.name.toLowerCase() === lowerName);
}
