// Postgres Type Parser Configuration
//
// node-postgres decodes BIGINT (int8, OID 20) as a STRING by default, while INTEGER
// (int4) decodes as a number. The default is there to protect values beyond
// Number.MAX_SAFE_INTEGER from silent precision loss.
//
// migrations/009 widens every economy_users money column to BIGINT, so without this
// module EconomyUser.wallet would arrive as a string while TypeScript still declares
// it a number. Comparisons would keep working by coercion, which is what makes it
// dangerous - but `wallet + amount` would concatenate rather than add.
//
// Parsing int8 as a number is safe for this data. JS integers are exact to 2^53
// (9,007,199,254,740,992), roughly four million times the old INTEGER ceiling these
// columns just outgrew. A coin balance cannot plausibly reach it.
//
// Imported for its side effect by economyDb and escrowDb - the two modules that return
// EconomyUser - so the declared types are true wherever those values come from.

import { types } from '@vercel/postgres';

/** Postgres OID for int8 / BIGINT */
const INT8_OID = 20;

let configured = false;

/**
 * Register the int8 parser. Idempotent, so importing from several modules is safe.
 */
export function configurePgTypes(): void {
  if (configured) return;

  types.setTypeParser(INT8_OID, (value: string): number => {
    const parsed: number = Number(value);

    // Loud rather than silently wrong. Reaching this would mean a balance beyond
    // 9 quadrillion, which indicates corruption rather than a real total.
    if (!Number.isSafeInteger(parsed)) {
      console.error(
        `[PG] BIGINT ${value} exceeds Number.MAX_SAFE_INTEGER and lost precision on decode`
      );
    }

    return parsed;
  });

  configured = true;
}

configurePgTypes();
