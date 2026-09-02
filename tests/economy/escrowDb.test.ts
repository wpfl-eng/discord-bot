import { describe, test, expect, jest, beforeEach } from '@jest/globals';

/**
 * A stand-in postgres client that records the statements it is given, so the tests can
 * assert on transaction boundaries as well as results.
 */
interface QueryLog {
  text: string;
  values: unknown[];
}

const log: QueryLog[] = [];
/** Queued responses, matched in order against non-transaction statements. */
let responses: Array<{ rows: unknown[]; rowCount?: number }> = [];
let released = false;
let failOn: string | null = null;

const mockClient = {
  query: jest.fn(async (text: string, values?: unknown[]) => {
    log.push({ text, values: values ?? [] });

    if (failOn && text.includes(failOn)) {
      throw new Error('simulated database failure');
    }

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) {
      return { rows: [], rowCount: 0 };
    }

    const next = responses.shift();
    return next ?? { rows: [], rowCount: 0 };
  }),
  release: jest.fn(() => {
    released = true;
  }),
};

jest.unstable_mockModule('@vercel/postgres', () => ({
  sql: Object.assign(
    // Tagged-template form, unused by the paths under test here.
    async () => ({ rows: [], rowCount: 0 }),
    { connect: async () => mockClient }
  ),
  // escrowDb imports db/pgTypes for its side effect, which registers the int8 parser.
  // The mock has to expose the same surface or the module fails to load.
  types: { setTypeParser: jest.fn(), getTypeParser: jest.fn() },
}));

const escrowDb = await import('../../economy/escrowDb.js');

/** Statements with whitespace collapsed, transaction keywords excluded. */
function statements(): string[] {
  return log.map((q) => q.text.replace(/\s+/g, ' ').trim());
}

function transactionKeywords(): string[] {
  return statements().filter((t) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(t));
}

describe('escrowDb', () => {
  beforeEach(() => {
    log.length = 0;
    responses = [];
    released = false;
    failOn = null;
    jest.clearAllMocks();
  });

  describe('openEscrow', () => {
    const wager = {
      userId: 'u1',
      username: 'aj',
      game: 'roulette' as const,
      sessionKey: 'session-1',
      amount: 500,
    };

    test('debits the wallet and records the row in one committed transaction', async () => {
      responses = [
        { rows: [{ user_id: 'u1', wallet: 500 }] }, // wallet update
        { rows: [{ id: 42 }] }, // escrow insert
      ];

      const result = await escrowDb.openEscrow(wager);

      expect(result.ok).toBe(true);
      expect(result.escrowId).toBe(42);
      expect(transactionKeywords()).toEqual(['BEGIN', 'COMMIT']);
      expect(released).toBe(true);
    });

    // The atomic guard is the only thing preventing an overdraw under concurrency.
    test('the wallet update is guarded by a sufficient-funds predicate', async () => {
      responses = [{ rows: [{ user_id: 'u1', wallet: 500 }] }, { rows: [{ id: 42 }] }];
      await escrowDb.openEscrow(wager);

      const walletUpdate = statements().find((t) => t.includes('UPDATE economy_users'));
      expect(walletUpdate).toContain('wallet >= $1');
    });

    test('rolls back and writes nothing when the wallet cannot cover the amount', async () => {
      responses = [{ rows: [] }]; // guarded update matched no row

      const result = await escrowDb.openEscrow(wager);

      expect(result.ok).toBe(false);
      expect(result.escrowId).toBeNull();
      expect(transactionKeywords()).toEqual(['BEGIN', 'ROLLBACK']);
      expect(statements().some((t) => t.includes('INSERT INTO wager_escrow'))).toBe(false);
    });

    test('rolls back and releases the client when the insert fails', async () => {
      responses = [{ rows: [{ user_id: 'u1', wallet: 500 }] }];
      failOn = 'INSERT INTO wager_escrow';

      await expect(escrowDb.openEscrow(wager)).rejects.toThrow('simulated database failure');
      expect(transactionKeywords()).toEqual(['BEGIN', 'ROLLBACK']);
      expect(released).toBe(true);
    });

    test.each([0, -1, 1.5, NaN])('refuses a non-positive-integer amount: %p', async (amount) => {
      const result = await escrowDb.openEscrow({ ...wager, amount });
      expect(result.ok).toBe(false);
      expect(log).toHaveLength(0);
    });

    test('records the purpose so split, double and insurance stakes are distinguishable', async () => {
      responses = [{ rows: [{ user_id: 'u1' }] }, { rows: [{ id: 7 }] }];
      await escrowDb.openEscrow({ ...wager, purpose: 'insurance' });

      const insert = log.find((q) => q.text.includes('INSERT INTO wager_escrow'));
      expect(insert?.values).toContain('insurance');
    });

    test('defaults purpose to bet', async () => {
      responses = [{ rows: [{ user_id: 'u1' }] }, { rows: [{ id: 7 }] }];
      await escrowDb.openEscrow(wager);

      const insert = log.find((q) => q.text.includes('INSERT INTO wager_escrow'));
      expect(insert?.values).toContain('bet');
    });
  });

  describe('voidEscrow', () => {
    test('returns the stake and marks the row voided', async () => {
      responses = [
        { rows: [{ amount: 500 }] }, // claim
        { rows: [{ user_id: 'u1', wallet: 1000 }] }, // credit
      ];

      const user = await escrowDb.voidEscrow(42, 'u1');

      expect(user).not.toBeNull();
      expect(transactionKeywords()).toEqual(['BEGIN', 'COMMIT']);
    });

    // Idempotency is what makes a double-click or a race with the spin safe.
    test('claims only rows that are still open', async () => {
      responses = [{ rows: [{ amount: 500 }] }, { rows: [{ user_id: 'u1' }] }];
      await escrowDb.voidEscrow(42, 'u1');

      const claim = statements().find((t) => t.includes('UPDATE wager_escrow'));
      expect(claim).toContain("status = 'open'");
    });

    test('refunds nothing when the row was already resolved', async () => {
      responses = [{ rows: [] }];

      const user = await escrowDb.voidEscrow(42, 'u1');

      expect(user).toBeNull();
      expect(transactionKeywords()).toEqual(['BEGIN', 'ROLLBACK']);
      expect(statements().some((t) => t.includes('UPDATE economy_users'))).toBe(false);
    });

    test("will not let one player void another player's wager", async () => {
      responses = [{ rows: [{ amount: 500 }] }, { rows: [{ user_id: 'u1' }] }];
      await escrowDb.voidEscrow(42, 'u1');

      const claim = statements().find((t) => t.includes('UPDATE wager_escrow'));
      expect(claim).toContain('user_id = $2');
    });

    // total_lost carries a CHECK (>= 0); an unguarded subtraction would violate it.
    test('reverses total_lost without driving it negative', async () => {
      responses = [{ rows: [{ amount: 500 }] }, { rows: [{ user_id: 'u1' }] }];
      await escrowDb.voidEscrow(42, 'u1');

      const credit = statements().find((t) => t.includes('UPDATE economy_users'));
      expect(credit).toContain('GREATEST(total_lost - $1, 0)');
    });
  });

  describe('sweepOpenEscrows', () => {
    test('refunds every open row and sums per user', async () => {
      responses = [
        {
          rows: [
            { user_id: 'u1', username: 'aj', game: 'blackjack', amount: 1000 },
            { user_id: 'u1', username: 'aj', game: 'blackjack', amount: 1000 },
            { user_id: 'u2', username: 'dave', game: 'roulette', amount: 500 },
          ],
        },
      ];

      const result = await escrowDb.sweepOpenEscrows();

      expect(result.rowsRefunded).toBe(3);
      expect(result.totalRefunded).toBe(2500);
      expect(result.byUser).toHaveLength(2);

      const aj = result.byUser.find((e) => e.userId === 'u1');
      expect(aj?.amount).toBe(2000); // both stakes from the doubled hand
    });

    test('reports nothing to do when no wagers are open', async () => {
      responses = [{ rows: [] }];

      const result = await escrowDb.sweepOpenEscrows();

      expect(result.rowsRefunded).toBe(0);
      expect(result.totalRefunded).toBe(0);
      expect(result.byUser).toEqual([]);
    });

    // Claiming and crediting in one statement is what stops two concurrent sweeps from
    // paying the same row twice.
    test('claims and credits in a single transaction', async () => {
      responses = [{ rows: [] }];
      await escrowDb.sweepOpenEscrows();

      expect(transactionKeywords()).toEqual(['BEGIN', 'COMMIT']);

      const sweep = statements().find((t) => t.includes('WITH claimed'));
      expect(sweep).toContain("status = 'open'");
      expect(sweep).toContain('UPDATE economy_users');
    });

    test('rolls back if the sweep fails partway', async () => {
      failOn = 'WITH claimed';

      await expect(escrowDb.sweepOpenEscrows()).rejects.toThrow('simulated database failure');
      expect(transactionKeywords()).toEqual(['BEGIN', 'ROLLBACK']);
      expect(released).toBe(true);
    });
  });

  describe('settleEscrowIds', () => {
    test('does not touch the database for an empty list', async () => {
      const settled = await escrowDb.settleEscrowIds([]);
      expect(settled).toBe(0);
      expect(log).toHaveLength(0);
    });

    // Settling must never move money - it only records that the outcome is known.
    test('marks rows settled without crediting anything', async () => {
      responses = [{ rows: [], rowCount: 2 }];

      const settled = await escrowDb.settleEscrowIds([1, 2]);

      expect(settled).toBe(2);
      const stmt = statements().find((t) => t.includes('UPDATE wager_escrow'));
      expect(stmt).toContain("status = 'settled'");
      expect(stmt).toContain("status = 'open'");
      expect(statements().some((t) => t.includes('economy_users'))).toBe(false);
    });
  });
});
