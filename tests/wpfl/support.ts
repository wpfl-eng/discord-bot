/**
 * Shared by the wpfl tests: the recorded fixtures under tests/fixtures, and a
 * fake HttpResponse in the shape wpflHttp's callers read. Five tests used to
 * carry their own fixture loader and three their own response builder.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { HttpResponse } from '../../wpfl/wpflHttp.js';

const FIXTURES: string = path.join(process.cwd(), 'tests', 'fixtures');

/** Where a recorded fixture lives, for a test that reads the text itself. */
export function fixturePath(name: string): string {
  return path.join(FIXTURES, name);
}

/** A recorded fixture, parsed. */
export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(fixturePath(name), 'utf8')) as T;
}

export interface FakeResponse {
  /** Defaults to 200. */
  readonly status?: number;
  /** What `json()` resolves to. */
  readonly body?: unknown;
  /** The one header anybody reads. */
  readonly etag?: string | null;
}

export function fakeResponse({
  status = 200,
  body = null,
  etag = null,
}: FakeResponse = {}): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string): string | null => (name.toLowerCase() === 'etag' ? etag : null),
    },
    json: async (): Promise<unknown> => body,
  };
}
