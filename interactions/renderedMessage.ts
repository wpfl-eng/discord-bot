// Components V2 Message Payload
//
// Both casino renderers emit the same shape: a flags bitfield carrying
// MessageFlags.IsComponentsV2, an array of already-serialised top-level components, and
// silenced mentions.
//
// The mentions matter. A V2 TextDisplay is real message content rather than an embed, so
// an unescaped <@id> in it pings. Every payload built here parses no mentions at all.
//
// Typing `components` as the API shape rather than `unknown[]` is what lets these
// payloads go straight to update(), editReply() and channel.send() with no cast, so the
// checker still sees a malformed components array at the send site.

import type { APIMessageTopLevelComponent, AttachmentBuilder } from 'discord.js';

/**
 * Silenced mentions, for every send and edit that carries text somebody else
 * wrote: a V2 TextDisplay, a member's question, a model's tool inputs or
 * prose, a fetched page quoted in it. Real message content pings on an
 * unescaped <@id>. A refusal reply carries bot text only and keeps the
 * default, so the person refused is still pinged.
 */
export const NO_MENTIONS = { parse: [] } as const;

export interface RenderedMessage {
  readonly flags: number;
  readonly components: APIMessageTopLevelComponent[];
  readonly allowedMentions: typeof NO_MENTIONS;
  /**
   * Attachments referenced by a MediaGallery in `components`, via `attachment://name`.
   *
   * Only the once-a-round hero frames carry these. A live board that repainted with an
   * upload on every click would put a render and a file transfer in the path of every
   * button press.
   */
  readonly files?: AttachmentBuilder[];
}
