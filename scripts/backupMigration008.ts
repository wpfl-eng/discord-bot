// Dump everything migration 008 is about to destroy, to a local JSON file.
//
// Usage:
//   npx tsx scripts/backupMigration008.ts            # writes to ./backups/
//   npx tsx scripts/backupMigration008.ts /some/dir  # writes to that directory
//
// Run this BEFORE applying migrations/008_remove_nflmon_rob_training.sql.
// That migration is irreversible: it drops the NFLmon tables, the rob/padlock
// columns on economy_users, and the dead training-ground tables.
//
// The output contains player data (Discord user IDs and usernames). It is
// written outside version control - do not commit it.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const TABLES: readonly string[] = [
  'nflmon_bench',
  'nflmon_stats',
  'nflmon_trades',
  'training_grounds',
  'training_slots',
];

const outDir: string = path.resolve(process.argv[2] ?? 'backups');
fs.mkdirSync(outDir, { recursive: true });

const connectionString: string | undefined = process.env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.error('POSTGRES_URL_NON_POOLING is not set. Add it to .env.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
const dump: Record<string, unknown> = { takenAt: new Date().toISOString() };

try {
  await client.connect();

  for (const table of TABLES) {
    const exists = await client.query<{ present: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [table]
    );
    if (!exists.rows[0]?.present) {
      console.log(`  ${table.padEnd(18)} absent - skipped`);
      dump[table] = null;
      continue;
    }
    const rows = await client.query(`SELECT * FROM ${table}`);
    dump[table] = rows.rows;
    console.log(`  ${table.padEnd(18)} ${rows.rowCount} rows`);
  }

  // Only rows where a rob/padlock column is actually set - the rest are defaults.
  const economy = await client.query(
    `SELECT user_id, username, last_rob, last_robbed_at, last_robbed_by, has_padlock
       FROM economy_users
      WHERE last_rob IS NOT NULL
         OR last_robbed_at IS NOT NULL
         OR last_robbed_by IS NOT NULL
         OR has_padlock = TRUE`
  );
  dump.economy_users_rob_columns = economy.rows;
  console.log(`  economy_users      ${economy.rowCount} rows with rob/padlock data`);

  const stamp: string = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile: string = path.join(outDir, `migration-008-backup-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(dump, null, 2));

  console.log(`\nBackup written: ${outFile}`);
  console.log(`Size          : ${fs.statSync(outFile).size} bytes`);
  console.log('\nThis file contains player data. Keep it out of git.');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nBackup FAILED: ${message}`);
  console.error('Do not run migration 008 until you have a backup you trust.');
  process.exitCode = 1;
} finally {
  await client.end();
}
