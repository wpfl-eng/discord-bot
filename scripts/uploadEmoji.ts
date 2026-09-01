// Emoji Uploader
//
// Pushes assets/emoji/*.png to the bot as application emojis.
//
// Run: npm run emoji:upload   (after npm run emoji:build)
//
// Application emojis belong to the bot rather than a guild: they consume no server
// emoji slots and work in every server the bot is in. Discord allows 2000; this set
// uses 91.
//
// Idempotent. Existing emoji with the same name are left alone unless --force is
// passed, in which case they are deleted and re-uploaded - use that after restyling
// the artwork. Names never change, so IDs stay stable and nothing needs redeploying.

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RANKS, SUITS } from '../discordCommands/blackjack/blackjackUtils.js';
import { expectedEmojiNames } from '../emoji/emojiRegistry.js';

// ============ TYPES ============

interface ApplicationEmoji {
  readonly id: string;
  readonly name: string;
}

interface EmojiListResponse {
  readonly items: ApplicationEmoji[];
}

// ============ SETUP ============

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.join(__dirname, '..', 'assets', 'emoji');

const force: boolean = process.argv.includes('--force');

const token: string | undefined = process.env.DISCORD_TOKEN;
const clientId: string | undefined = process.env.DISCORD_CLIENT_ID;

if (!token) {
  console.error('Error: DISCORD_TOKEN environment variable is not set');
  process.exit(1);
}
if (!clientId) {
  console.error('Error: DISCORD_CLIENT_ID environment variable is not set');
  process.exit(1);
}

const rest = new REST().setToken(token);

// ============ HELPERS ============

/**
 * Discord accepts emoji image data only as a base64 data URI.
 */
async function toDataUri(filePath: string): Promise<string> {
  const buffer: Buffer = await fs.readFile(filePath);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Discord's emoji endpoints are rate limited fairly tightly; @discordjs/rest handles
 * 429s for us, but pacing the uploads keeps the run predictable.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ MAIN ============

async function main(): Promise<void> {
  const expected: string[] = expectedEmojiNames(RANKS, SUITS);

  // Verify the build ran before we touch the API.
  const missingFiles: string[] = [];
  for (const name of expected) {
    try {
      await fs.access(path.join(ASSET_DIR, `${name}.png`));
    } catch {
      missingFiles.push(name);
    }
  }
  if (missingFiles.length > 0) {
    console.error(
      `Missing ${missingFiles.length} PNG(s) in ${ASSET_DIR}\n` +
        `Run "npm run emoji:build" first.\n` +
        `Missing: ${missingFiles.slice(0, 10).join(', ')}${missingFiles.length > 10 ? ' ...' : ''}`
    );
    process.exit(1);
  }

  const listed = (await rest.get(Routes.applicationEmojis(clientId!))) as EmojiListResponse;
  const existing = new Map<string, string>();
  for (const item of listed.items ?? []) {
    existing.set(item.name, item.id);
  }

  console.log(`Application already has ${existing.size} emoji. Uploading ${expected.length}.`);
  if (force) console.log('--force: existing emoji with matching names will be replaced.\n');

  let created = 0;
  let replaced = 0;
  let skipped = 0;

  for (const name of expected) {
    const existingId: string | undefined = existing.get(name);

    if (existingId && !force) {
      skipped++;
      continue;
    }

    try {
      if (existingId) {
        await rest.delete(Routes.applicationEmoji(clientId!, existingId));
        await sleep(120);
      }

      await rest.post(Routes.applicationEmojis(clientId!), {
        body: {
          name,
          image: await toDataUri(path.join(ASSET_DIR, `${name}.png`)),
        },
      });

      if (existingId) replaced++;
      else created++;

      await sleep(120);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED ${name}: ${message}`);
    }
  }

  console.log(`\nDone. created ${created}, replaced ${replaced}, skipped ${skipped}`);

  const after = (await rest.get(Routes.applicationEmojis(clientId!))) as EmojiListResponse;
  const haveNames = new Set((after.items ?? []).map((i) => i.name));
  const stillMissing: string[] = expected.filter((n) => !haveNames.has(n));

  if (stillMissing.length > 0) {
    console.error(`\n${stillMissing.length} emoji still missing: ${stillMissing.join(', ')}`);
    console.error('The bot will fall back to text for these.');
    process.exit(1);
  }

  console.log(`All ${expected.length} emoji present. Restart the bot to pick them up.`);
}

main().catch((error: unknown) => {
  console.error('Emoji upload failed:', error);
  process.exit(1);
});
