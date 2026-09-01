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

import type { APIMessageTopLevelComponent } from 'discord.js';

export interface RenderedMessage {
  readonly flags: number;
  readonly components: APIMessageTopLevelComponent[];
  readonly allowedMentions: { parse: never[] };
}
