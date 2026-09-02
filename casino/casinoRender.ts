// Casino Component Builders
//
// Thin, typed wrappers over the discord.js Components V2 builders. Every table game
// framed its own containers, rows and buttons with near-identical private helpers;
// these are those helpers, once.
//
// Nothing here reads game state or talks to Discord. Every function is a pure builder,
// so a layout can be measured in a test without a client - which is what the existing
// render tests already rely on.

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MessageFlags,
  type APIMessageTopLevelComponent,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { NO_MENTIONS, type RenderedMessage } from '../interactions/renderedMessage.js';

export type { RenderedMessage };

// ============ PRIMITIVES ============

/** A Container with an accent stripe - the outer frame of every board and panel. */
export function frame(accentColor: number): ContainerBuilder {
  return new ContainerBuilder().setAccentColor(accentColor);
}

/** Markdown text. The V2 replacement for an embed description. */
export function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

/** A horizontal rule between blocks. */
export function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
}

export interface ButtonSpec {
  readonly id: string;
  readonly label: string;
  readonly style?: ButtonStyle;
  readonly emoji?: string;
  readonly disabled?: boolean;
}

/** A single button. */
export function button(spec: ButtonSpec): ButtonBuilder {
  const b = new ButtonBuilder()
    .setCustomId(spec.id)
    .setLabel(spec.label)
    .setStyle(spec.style ?? ButtonStyle.Secondary)
    .setDisabled(spec.disabled ?? false);

  if (spec.emoji) b.setEmoji(spec.emoji);
  return b;
}

/**
 * A jump link. Link buttons carry a URL instead of a custom id, so they never produce
 * an interaction - which is exactly what the casino hub wants.
 */
export function linkButton(label: string, url: string, emoji?: string): ButtonBuilder {
  const b = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/**
 * An action row. Discord caps a row at 5 buttons or 1 select; passing more is a layout
 * bug that Discord rejects outright, so it is caught here rather than at the API.
 */
export function row(
  components: readonly MessageActionRowComponentBuilder[]
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  if (components.length > 5) {
    throw new Error(`[CASINO] Action row holds at most 5 components, got ${components.length}`);
  }
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents([...components]);
}

/**
 * A Section: one to three text blocks with a single trailing accessory.
 *
 * This is the only way to attach a button to a specific block of text rather than to
 * the message as a whole.
 */
export function section(
  lines: readonly string[],
  accessory: ButtonBuilder | ThumbnailBuilder
): SectionBuilder {
  if (lines.length < 1 || lines.length > 3) {
    throw new Error(`[CASINO] Section holds 1-3 text components, got ${lines.length}`);
  }

  const builder = new SectionBuilder().addTextDisplayComponents(lines.map((l) => text(l)));

  return accessory instanceof ButtonBuilder
    ? builder.setButtonAccessory(accessory)
    : builder.setThumbnailAccessory(accessory);
}

// ============ MESSAGE ASSEMBLY ============

export interface RenderOptions {
  /** Only this player sees it. Shared boards must leave this false. */
  readonly ephemeral?: boolean;
  /**
   * Attachments a MediaGallery in `components` refers to via `attachment://name`.
   * Only the once-a-round hero frames use this.
   */
  readonly files?: readonly AttachmentBuilder[];
}

/**
 * The same payload, made safe to pass to an edit.
 *
 * `MessageEditOptions.flags` accepts only SuppressEmbeds and IsComponentsV2: a message
 * cannot become ephemeral, or stop being ephemeral, after it exists. So the Ephemeral
 * bit `rendered` sets for a private panel has to come off before that panel is edited.
 */
export function forEdit(payload: RenderedMessage): RenderedMessage {
  const flags: number = payload.flags & ~MessageFlags.Ephemeral;
  return flags === payload.flags ? payload : { ...payload, flags };
}

/**
 * Seal a list of top-level components into a sendable payload.
 *
 * Mentions are suppressed unconditionally. A V2 TextDisplay is real message content
 * rather than an embed, so an unescaped <@id> in a bet board would notify every player
 * on it, on every repaint.
 */
export function rendered(
  components: readonly APIMessageTopLevelComponent[],
  options: RenderOptions = {}
): RenderedMessage {
  const flags: number = options.ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;

  return {
    flags,
    components: [...components],
    allowedMentions: NO_MENTIONS,
    ...(options.files && options.files.length > 0 ? { files: [...options.files] } : {}),
  };
}

// ============ BUDGET GUARDS ============

/** Discord's hard limits on a Components V2 message. */
export const BUDGET = {
  topLevel: 10,
  total: 40,
  containerChildren: 10,
  rowComponents: 5,
  selectOptions: 25,
} as const;

/**
 * Count every component in a serialised tree, accessories included.
 *
 * Exported so renderers and tests measure a payload the same way.
 */
export function countComponents(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;

  const record = node as { components?: unknown[]; accessory?: unknown };
  let total = 1;

  if (Array.isArray(record.components)) {
    for (const child of record.components) total += countComponents(child);
  }
  if (record.accessory) total += 1;

  return total;
}

/**
 * Throw if a payload would be rejected by Discord.
 *
 * Called by renderers on their own output. An over-budget message fails the whole send,
 * so failing loudly here beats a table that silently stops updating.
 */
export function assertWithinBudget(payload: RenderedMessage, label: string): void {
  const comps = payload.components;
  const total: number = comps.reduce((sum, c) => sum + countComponents(c), 0);

  if (comps.length > BUDGET.topLevel) {
    throw new Error(
      `[CASINO] ${label}: ${comps.length} top-level components, max ${BUDGET.topLevel}`
    );
  }
  if (total > BUDGET.total) {
    throw new Error(`[CASINO] ${label}: ${total} components total, max ${BUDGET.total}`);
  }

  for (const component of comps) {
    const container = component as { type?: number; components?: unknown[] };
    if (container.type === 17 && (container.components?.length ?? 0) > BUDGET.containerChildren) {
      throw new Error(
        `[CASINO] ${label}: container has ${container.components?.length} children, ` +
          `max ${BUDGET.containerChildren}`
      );
    }
  }
}
