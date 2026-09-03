/**
 * How a rendered picture travels from a tool call to the Discord message
 * (design §11).
 *
 * The `wpfl` server is built per run with a collector of its own, so a tool
 * never has to know which run is calling it: it adds the picture here, and
 * the runner hands the collector's contents back in the outcome. The model
 * decides what ships by writing the picture's token into its answer, the
 * same rule prose follows -- nothing reaches the channel that the model did
 * not put in its answer. A picture drawn and then left out goes out of scope
 * with the outcome. No global store, no expiry, and nothing one run can
 * reach of another's.
 */

import { randomBytes } from 'node:crypto';
import { ASK } from '../ask/askConfig.js';
import type { ChartKind } from './chartSpec.js';

export type PictureKind = ChartKind | 'table';

export interface Picture {
  /** Eight hex characters; the token carries it. */
  readonly id: string;
  readonly kind: PictureKind;
  readonly title: string;
  /** For the attachment's description, which is what a screen reader gets. */
  readonly alt: string;
  readonly png: Buffer;
}

export interface PictureCollector {
  /** The asker's canonical owner name; a table highlights their row. */
  readonly owner: string;
  /** In the order they were drawn. */
  readonly pictures: readonly Picture[];
  /** At the per-answer ceiling; the tools refuse rather than draw. */
  readonly full: boolean;
  add(picture: Omit<Picture, 'id'>): Picture;
}

export function createCollector(owner: string): PictureCollector {
  const pictures: Picture[] = [];
  return {
    owner,
    get pictures(): readonly Picture[] {
      return pictures;
    },
    get full(): boolean {
      return pictures.length >= ASK.PICTURES.PER_ANSWER;
    },
    add(picture: Omit<Picture, 'id'>): Picture {
      const added: Picture = { id: randomBytes(4).toString('hex'), ...picture };
      pictures.push(added);
      return added;
    },
  };
}

/** What the model writes; unlikely in prose, and the id is what it resolves by. */
const TOKEN = /\[\[picture:([a-f0-9]{8})\]\]/g;

export function tokenFor(id: string): string {
  return `[[picture:${id}]]`;
}

/**
 * Where a token matched nothing. Visible, so a dangling "by owner:" line
 * above it makes sense, and honest when the model referenced a picture it
 * never drew.
 */
export const UNAVAILABLE_LINE = '_picture unavailable_';

export interface Resolved {
  readonly text: string;
  /** The pictures to attach, in the order their tokens appeared, each once. */
  readonly pictures: Picture[];
  /** Ids that matched nothing; logged by the caller. */
  readonly unresolved: string[];
}

/**
 * Swap every token in the answer for its picture.
 *
 * A line that held nothing but tokens is dropped; a token inside a sentence
 * is removed and the sentence closed up; a token that matches nothing
 * becomes the visible line. A picture referenced twice attaches once.
 */
export function resolvePictures(text: string, pictures: readonly Picture[]): Resolved {
  const byId = new Map<string, Picture>(pictures.map((p: Picture): [string, Picture] => [p.id, p]));
  const attached: Picture[] = [];
  const unresolved: string[] = [];

  const resolved: string = rewriteTokens(text, (id: string): string => {
    const picture: Picture | undefined = byId.get(id);
    if (picture === undefined) {
      unresolved.push(id);
      return UNAVAILABLE_LINE;
    }
    if (!attached.includes(picture)) attached.push(picture);
    return '';
  });
  return { text: resolved, pictures: attached, unresolved };
}

/** The live ticker's view: tokens are for the final post, not for a member watching it stream. */
export function hideTokens(text: string): string {
  return rewriteTokens(text, (): string => '');
}

function rewriteTokens(text: string, replacement: (id: string) => string): string {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (!TOKEN.test(line)) {
      lines.push(line);
      continue;
    }
    TOKEN.lastIndex = 0;
    const rewritten: string = line
      .replace(TOKEN, (_match: string, id: string): string => replacement(id))
      .replace(/ {2,}/g, ' ')
      .trim();
    // A line that was only tokens goes; one that still says something stays.
    if (rewritten !== '') lines.push(rewritten);
  }
  TOKEN.lastIndex = 0;
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
