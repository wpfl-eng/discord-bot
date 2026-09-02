import { describe, test, expect, jest } from '@jest/globals';

/** Captures what the module registers, keyed by Postgres OID. */
const registered = new Map<number, (value: string) => unknown>();

jest.unstable_mockModule('@vercel/postgres', () => ({
  sql: Object.assign(async () => ({ rows: [], rowCount: 0 }), {
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }),
  }),
  types: {
    setTypeParser: (oid: number, parser: (value: string) => unknown) => {
      registered.set(oid, parser);
    },
    getTypeParser: (oid: number) => registered.get(oid),
  },
}));

const { configurePgTypes } = await import('../../db/pgTypes.js');

const INT8_OID = 20;

/**
 * migrations/009 widens every economy_users money column to BIGINT. node-postgres
 * decodes BIGINT as a string by default, so without this parser EconomyUser.wallet
 * would be a string at runtime while typed as a number - and `wallet + amount` would
 * concatenate instead of add.
 */
describe('pgTypes', () => {
  test('registers a parser for int8 on import', () => {
    expect(registered.has(INT8_OID)).toBe(true);
  });

  test('decodes BIGINT as a number, not a string', () => {
    const parse = registered.get(INT8_OID)!;
    expect(typeof parse('9123456789')).toBe('number');
    expect(parse('9123456789')).toBe(9123456789);
  });

  test('decodes values past the old INTEGER ceiling exactly', () => {
    const parse = registered.get(INT8_OID)!;
    // The ceiling migration 009 exists to escape.
    expect(parse('2147483648')).toBe(2147483648);
    // A plausible lifetime total after the 100,000 limit raise.
    expect(parse('3500000000')).toBe(3500000000);
  });

  test('parsed values behave as numbers under arithmetic', () => {
    const parse = registered.get(INT8_OID)!;
    const wallet = parse('1000') as number;
    // The exact bug this prevents: string concatenation instead of addition.
    expect(wallet + 500).toBe(1500);
    expect(wallet + 500).not.toBe('1000500');
  });

  test('handles zero and small balances', () => {
    const parse = registered.get(INT8_OID)!;
    expect(parse('0')).toBe(0);
    expect(parse('1')).toBe(1);
  });

  test('warns rather than silently losing precision past 2^53', () => {
    const parse = registered.get(INT8_OID)!;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    parse('9007199254740993'); // MAX_SAFE_INTEGER + 2

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('is idempotent, so importing from several modules is safe', () => {
    const first = registered.get(INT8_OID);
    configurePgTypes();
    configurePgTypes();
    expect(registered.get(INT8_OID)).toBe(first);
  });
});
