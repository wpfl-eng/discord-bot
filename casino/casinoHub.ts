// Casino Hub
//
// One message in the casino channel summarising what is live across all three tables,
// with a jump link to each.
//
// WHY THIS EXISTS
//
// Each table lives in its own channel, because a live board is a message being edited
// in place and any new message in the same channel pushes it out of view. Three tables
// sharing a room would bury each other constantly.
//
// The cost of that is discoverability: for a small league, three separate rooms are
// three usually-empty rooms, and nobody goes looking. The hub is the fix - one place
// that says where the action is.
//
// Games register a status provider at import time, the same way they register component
// handlers, so the hub has no knowledge of any particular game.

import {
  Client,
  ChannelType,
  type APIMessageTopLevelComponent,
  type Message,
  type TextChannel,
} from 'discord.js';
import { CASINO_COLORS } from './casinoTheme.js';
import { frame, linkButton, rendered, row, separator, text } from './casinoRender.js';

// ============ REGISTRATION ============

export interface GameStatus {
  /** Stable key, used for ordering and logging */
  readonly key: string;
  /** Display name, e.g. 'ROULETTE' */
  readonly label: string;
  readonly emoji: string;
  /** Where this game is played, if configured */
  readonly channelId: string | undefined;
  /** True when a table is actually up */
  readonly live: boolean;
  /** One line: what is happening right now */
  readonly summary: string;
}

type StatusProvider = () => GameStatus;

const providers: StatusProvider[] = [];

/**
 * Register a game with the hub. Call at module import time.
 *
 * @param provider - called on every refresh; must be cheap and must not throw
 */
export function registerGameStatus(provider: StatusProvider): void {
  providers.push(provider);
}

/** Number of registered games. Used for boot logging and by tests. */
export function registeredGameCount(): number {
  return providers.length;
}

/** Test seam: drop every registration. */
export function __resetHubForTesting(): void {
  providers.length = 0;
  hubMessage = null;
  lastSignature = '';
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ============ RENDERING ============

/**
 * Collect every game's status, tolerating a provider that throws.
 *
 * A broken provider must degrade to one unknown row rather than blanking the hub.
 */
function collect(): GameStatus[] {
  return providers.map((provider, index) => {
    try {
      return provider();
    } catch (error: unknown) {
      console.error('[HUB] Status provider threw:', error);
      return {
        key: `unknown-${index}`,
        label: 'UNKNOWN',
        emoji: '❓',
        channelId: undefined,
        live: false,
        summary: 'status unavailable',
      };
    }
  });
}

export function buildHubMessage(statuses: readonly GameStatus[], guildId: string | null) {
  const anyLive: boolean = statuses.some((s) => s.live);

  const lines: string[] = ['## 🎰 THE CASINO'];
  lines.push(anyLive ? '_Tables are running._' : '_All quiet. Open one._');

  const body: string[] = [];
  for (const status of statuses) {
    const marker: string = status.live ? '🟢' : '⚫';
    const where: string = status.channelId ? ` <#${status.channelId}>` : ' _(not configured)_';
    body.push(`${marker} ${status.emoji} **${status.label}**${where}\n   ${status.summary}`);
  }

  const container = frame(anyLive ? CASINO_COLORS.green : CASINO_COLORS.slate)
    .addTextDisplayComponents(text(lines.join('\n')))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(body.length > 0 ? body.join('\n\n') : '_No games registered._'));

  const components: APIMessageTopLevelComponent[] = [container.toJSON()];

  // Link buttons carry a URL rather than a custom id, so they never produce an
  // interaction - which is exactly right for a jump link.
  const jumps = statuses
    .filter((s) => s.channelId && guildId)
    .slice(0, 5)
    .map((s) =>
      linkButton(s.label, `https://discord.com/channels/${guildId}/${s.channelId}`, s.emoji)
    );

  if (jumps.length > 0) components.push(row(jumps).toJSON());

  return rendered(components);
}

// ============ LIFECYCLE ============

/** How often the hub re-reads every game's status. */
export const HUB_REFRESH_MS = 20_000;

let hubMessage: Message | null = null;
let lastSignature = '';
let refreshTimer: NodeJS.Timeout | null = null;

function signatureOf(statuses: readonly GameStatus[]): string {
  return statuses.map((s) => `${s.key}:${s.live}:${s.summary}`).join('|');
}

function getCasinoChannelId(): string | undefined {
  return process.env.ECONOMY_CASINO_CHANNEL_ID;
}

/**
 * Post the hub and keep it current.
 *
 * Never throws: the hub is a convenience, and a missing channel or a permissions problem
 * must not affect any table.
 */
export async function startHub(client: Client): Promise<void> {
  const channelId: string | undefined = getCasinoChannelId();

  if (!channelId) {
    console.log('[HUB] ECONOMY_CASINO_CHANNEL_ID not set; hub disabled');
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.warn('[HUB] Casino channel is not a text channel; hub disabled');
      return;
    }

    const textChannel = channel as TextChannel;
    const statuses = collect();
    lastSignature = signatureOf(statuses);

    hubMessage = await textChannel.send(buildHubMessage(statuses, textChannel.guildId ?? null));

    refreshTimer = setInterval(() => void refreshHub(), HUB_REFRESH_MS);
    console.log(`[HUB] Live in #${textChannel.name} for ${providers.length} game(s)`);
  } catch (error: unknown) {
    console.error('[HUB] Failed to start; continuing without it:', error);
  }
}

/**
 * Repaint the hub, but only when something actually changed.
 *
 * Editing on a fixed interval regardless would spend a channel's edit budget saying the
 * same thing over and over.
 */
export async function refreshHub(): Promise<void> {
  if (!hubMessage) return;

  const statuses = collect();
  const signature: string = signatureOf(statuses);
  if (signature === lastSignature) return;

  lastSignature = signature;

  try {
    await hubMessage.edit(buildHubMessage(statuses, hubMessage.guildId ?? null));
  } catch (error: unknown) {
    console.error('[HUB] Failed to refresh:', error);
  }
}

/** Stop refreshing. Used on shutdown and by tests. */
export function stopHub(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
