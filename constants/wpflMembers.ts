/**
 * WPFL league member mappings: Discord snowflake, ESPN team id, and the
 * canonical WPFL owner spelling.
 *
 * This is the single join between the three identity systems. It exists
 * separately from constants/espnMembers.ts because that file carries display
 * nicknames ("Mike S", "Adler") rather than the canonical names the draft-2026
 * artifact is keyed by, and carries no Discord ids at all.
 *
 * The ESPN id <-> owner half was checked against draft-2026's TEAM_OWNERS
 * (backend/config.py:57) on 2026-08-31 and matches on all 14 rows. The Discord
 * snowflakes were supplied by AJ and cannot be verified from the dev box --
 * design §7 covers that asymmetry with a startup resolution check and owner
 * attribution in every answer footer.
 *
 * The ESPN fork does return team names and an ownerName, but those are
 * whatever the owner typed into ESPN. This table is the canonical spelling
 * the artifact and the WPFL API are keyed by, so it is the one the bot uses.
 */

export interface WpflMember {
  readonly espnId: number;
  /** Canonical WPFL spelling; the artifact and the WPFL API are keyed by it. */
  readonly owner: string;
  readonly discordId: string;
}

export const wpflMembers: readonly WpflMember[] = [
  { espnId: 1, owner: 'Nixon Ball', discordId: '286718589220945920' },
  { espnId: 3, owner: 'Forrest Britton', discordId: '879541760802562049' },
  { espnId: 4, owner: 'AJ Boorde', discordId: '120231673722830849' },
  { espnId: 5, owner: 'Jimmy Simpson', discordId: '288481488310239234' },
  { espnId: 6, owner: 'David Evans', discordId: '416887796935163904' },
  { espnId: 7, owner: 'Ryan Salchert', discordId: '855256180523794442' },
  { espnId: 8, owner: 'Mike Simpson', discordId: '286985052339044352' },
  { espnId: 9, owner: 'Todd Ellis', discordId: '413773330034982914' },
  { espnId: 10, owner: 'David Adler', discordId: '843933048915623977' },
  { espnId: 11, owner: 'Neill Bullock', discordId: '543421070548664331' },
  { espnId: 12, owner: 'Doug Black', discordId: '287800977808031744' },
  { espnId: 13, owner: 'Rick Kocher', discordId: '472464302293516295' },
  { espnId: 14, owner: 'Michael Hoyle', discordId: '213466735536373760' },
  { espnId: 15, owner: 'Jonathan Mims', discordId: '1245041211002060970' },
] as const;

/**
 * Resolve the member who ran a command. For /ask this is the gate as well as
 * the identity: a Discord user with no row here is refused before anything is
 * looked up (ask/preflight.ts), so a wrong or missing snowflake locks that
 * owner out rather than costing them the implicit "my team".
 */
export function getWpflMemberByDiscordId(discordId: string): WpflMember | undefined {
  return wpflMembers.find((m) => m.discordId === discordId);
}

/** Translate an ESPN team id to a canonical owner, for the ESPN tools. */
export function getWpflMemberByEspnId(espnId: number): WpflMember | undefined {
  return wpflMembers.find((m) => m.espnId === espnId);
}
