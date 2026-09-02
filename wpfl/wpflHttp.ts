/**
 * One way to call the WPFL history API.
 *
 * There were two: historyCache fetched rows to cache them, wpflApiTools fetched
 * rows to hand to the agent, and each carried its own URL assembly, its own
 * AbortController against ASK.WPFL_FETCH_TIMEOUT_MS, its own `ok` check and its
 * own "is this actually a list?" guard. That duplication had already drifted --
 * the list guard existed in historyCache from the start and only reached
 * wpflApiTools later, which means for a while one path would have rendered an
 * error payload to the agent as data.
 *
 * The two callers still differ in what a failure means, and that difference is
 * real: a cache refresh keeps the previous file and carries on, while a tool
 * call has to tell the agent it failed. So this throws, and the cache is the
 * one that catches.
 */

import { ASK } from '../ask/askConfig.js';

/** Only what these callers use, so a test fake is a few lines. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  /** Present on a real Response; only artifactSync reads it (for the etag). */
  readonly headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<HttpResponse>;

/** Query values that are `undefined` are omitted rather than sent as "undefined". */
export type Query = Record<string, string | number | boolean | undefined>;

/**
 * One request with a deadline. Maps the abort onto a readable error and
 * always clears the timer -- the part every inline copy forgot once.
 *
 * @param what names the request in the timeout message, e.g. "The artifact fetch".
 * @throws {Error} on a timeout. A non-2xx response is returned, not thrown.
 */
export async function fetchWithTimeout(
  url: string,
  fetchFn: FetchFn,
  what: string,
  timeoutMs: number = ASK.WPFL_FETCH_TIMEOUT_MS
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { signal: controller.signal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${what} timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @throws {Error} on a non-2xx status, a body that is not a list, or a timeout.
 */
export async function fetchJsonArray<T>(
  endpoint: string,
  query: Query,
  fetchFn: FetchFn
): Promise<T[]> {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response: HttpResponse = await fetchWithTimeout(
    url.toString(),
    fetchFn,
    `The WPFL history API request to ${endpoint}`
  );
  if (!response.ok) {
    throw new Error(`The WPFL history API returned HTTP ${response.status} for ${endpoint}.`);
  }
  const body: unknown = await response.json();
  // Every one of these endpoints returns a list. Anything else is the API
  // reporting a problem in a shape the agent would otherwise render as data.
  if (!Array.isArray(body)) {
    throw new Error(`The WPFL history API returned an unexpected shape for ${endpoint}.`);
  }
  return body as T[];
}
