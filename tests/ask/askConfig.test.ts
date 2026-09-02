import { describe, test, expect } from '@jest/globals';
import path from 'node:path';
import { ASK, resolveDataDir } from '../../ask/askConfig.js';

describe('the decade cache window', () => {
  test('is a day: rows land weekly, and the artifact window is four times a day', () => {
    expect(ASK.WPFL_CACHE_STALE_AFTER_MS).toBe(24 * 60 * 60 * 1000);
    expect(ASK.WPFL_CACHE_STALE_AFTER_MS).toBeGreaterThan(ASK.STALE_AFTER_MS);
  });
});

/**
 * DATA_DIR feeds three things that must agree: the agent's cwd, the path
 * guard's root, and the `Read(//…)` allow rule. It was taken from
 * WPFL_DATA_DIR verbatim, and dotenv expands neither `~` nor `$HOME`, while
 * .env.sample describes the override as "the default $HOME/wpfl-data" --
 * inviting exactly that (log Stage 14, decision 3).
 */
describe('resolveDataDir', () => {
  const home = '/home/tester';

  test('defaults to wpfl-data under the home directory', () => {
    expect(resolveDataDir(undefined, home)).toBe('/home/tester/wpfl-data');
    expect(resolveDataDir('', home)).toBe('/home/tester/wpfl-data');
  });

  test('expands a leading ~ to the home directory', () => {
    expect(resolveDataDir('~/league-data', home)).toBe('/home/tester/league-data');
    expect(resolveDataDir('~', home)).toBe('/home/tester');
  });

  test('leaves an absolute path alone, minus a trailing slash', () => {
    expect(resolveDataDir('/srv/wpfl/', home)).toBe('/srv/wpfl');
    expect(resolveDataDir('/srv/wpfl', home)).toBe('/srv/wpfl');
  });

  test('anchors a relative path at the process working directory', () => {
    expect(resolveDataDir('data/wpfl', home)).toBe(path.resolve('data/wpfl'));
  });

  test('never returns a path with a leading double slash, which the rule builder relies on', () => {
    expect(resolveDataDir('//srv//wpfl', home)).toBe('/srv/wpfl');
  });
});
