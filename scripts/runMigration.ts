// Apply a SQL migration file against the database in .env
//
// Usage:
//   npx tsx scripts/runMigration.ts migrations/008_remove_nflmon_rob_training.sql
//   npx tsx scripts/runMigration.ts <file> --dry-run
//
// Uses POSTGRES_URL_NON_POOLING (the direct endpoint). DDL such as DROP TABLE
// and ALTER TABLE should not go through a connection pooler, so this
// deliberately does not fall back to the pooled POSTGRES_URL.
//
// There is no migration tracking table in this repo - this simply executes the
// file you point it at. Migration files here are written to be idempotent
// (IF EXISTS / IF NOT EXISTS) but re-running is still your call.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const [, , fileArg, ...flags] = process.argv;
const dryRun: boolean = flags.includes('--dry-run');

if (!fileArg) {
  console.error('Usage: npx tsx scripts/runMigration.ts <path-to.sql> [--dry-run]');
  process.exit(1);
}

const filePath: string = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`Migration file not found: ${filePath}`);
  process.exit(1);
}

const sql: string = fs.readFileSync(filePath, 'utf8');

console.log(`Migration : ${path.relative(process.cwd(), filePath)}`);
console.log(`Statements: ${sql.split(';').filter((s) => s.trim().length > 0).length}`);
console.log(`Bytes     : ${sql.length}`);

if (dryRun) {
  console.log('\n--- DRY RUN: SQL below was NOT executed ---\n');
  console.log(sql);
  process.exit(0);
}

const connectionString: string | undefined = process.env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.error('POSTGRES_URL_NON_POOLING is not set. Add it to .env.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  // Show which database is being modified, without printing credentials.
  const who = await client.query<{ db: string; host: string }>(
    `SELECT current_database() AS db, inet_server_addr()::text AS host`
  );
  console.log(`Database  : ${who.rows[0]?.db ?? 'unknown'}`);
  console.log('\nApplying...');

  // The migration file supplies its own BEGIN/COMMIT. node-postgres uses the
  // simple query protocol when no parameters are passed, which permits
  // multiple statements in a single call.
  await client.query(sql);

  console.log('Applied successfully.');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nMigration FAILED: ${message}`);
  console.error('If the file wraps its work in BEGIN/COMMIT, the transaction was rolled back.');
  process.exitCode = 1;
} finally {
  await client.end();
}
