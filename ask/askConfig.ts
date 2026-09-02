// /ask Agent Configuration
// All tuning for the ask agent lives here, in the spirit of economyConfig.ts.
// Model, effort and thinking display are part of that tuning, not a separate
// concern -- "what model does this run" should be one file to open.

import { homedir } from 'node:os';
import path from 'node:path';
import { ThreadAutoArchiveDuration } from 'discord.js';

/**
 * The data directory as an absolute path.
 *
 * It feeds three things that must agree -- the agent's cwd, the path guard's
 * root and the `Read(//…)` allow rule -- and it used to be WPFL_DATA_DIR
 * verbatim. dotenv expands neither `~` nor `$HOME`, so an override written
 * the way .env.sample describes the default put the cwd in a literal `~`
 * directory relative to wherever pm2 started the bot. Exported for its test.
 */
export function resolveDataDir(raw: string | undefined, home: string): string {
  const value: string = raw === undefined || raw.trim() === '' ? '~/wpfl-data' : raw.trim();
  const expanded: string =
    value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  return path.resolve(expanded);
}

export const ASK = {
  // ---- Limits and accounting (design §9) ----
  // Deliberately generous. A new feature dies if the first week feels
  // rationed, and the control that actually matters is MAX_BUDGET_USD --
  // it stops one pathological loop.
  DAILY_QUESTIONS_PER_USER: 20,
  MONTHLY_QUERIES_TOTAL: 1500, // league-wide, ~50/day across 14 members
  MAX_BUDGET_USD: 1.0, // per query; SDK-enforced
  MAX_CONCURRENT_QUERIES: 2,
  QUERY_TIMEOUT_MS: 4 * 60 * 1000,
  SOFT_TURN_CAP: 15,
  HARD_TURN_CAP: 20,
  SESSION_RETENTION_DAYS: 7,

  // ---- Model (design §5.1) ----
  // A league question is mostly retrieval and arithmetic over what the tools
  // hand back, not deep reasoning, and wall-clock matters while a member is
  // watching a ticker. Raise EFFORT here if the audit log shows thin answers.
  MODEL: 'claude-opus-5',
  EFFORT: 'high',
  // On Opus 5 the default is 'omitted' -- thinking blocks stream with empty
  // text. The ticker exists to cover exactly the stretch where the user would
  // otherwise see nothing, and thinking is billed identically either way.
  THINKING_DISPLAY: 'summarized',

  // ---- The agent's tool surface (design §5.3, §10.2) ----
  // Declared once, because it has to agree in three places: `tools` (what the
  // agent can see), `allowedTools` (what `dontAsk` will permit), and the
  // PreToolUse matcher that confines the file tools to DATA_DIR. Stage 12's
  // worst defect -- every Grep and Glob denied -- was these lists disagreeing,
  // and only two of the three were then covered by a test.
  FILE_TOOLS: ['Read', 'Grep', 'Glob'],
  WEB_TOOLS: ['WebSearch', 'WebFetch'],

  // ---- Time ----
  // One timezone for the whole feature: the cap-reset line a member reads and
  // the "Today is" the agent is told must be the same day.
  LEAGUE_TZ: 'America/New_York',

  // ---- Data and freshness (design §3.5) ----
  // Outside the bot's repo: cwd points here and the PreToolUse hook confines
  // every file tool to it.
  DATA_DIR: resolveDataDir(process.env.WPFL_DATA_DIR, homedir()),
  ARTIFACT_URL: 'https://wpfl-receipts-694ed0.pages.dev/postdraft.json',
  STALE_AFTER_MS: 6 * 60 * 60 * 1000,

  // ---- WPFL history API (design §3.7) ----
  // The three row-shaped endpoints are cached locally and reachable only
  // through SQL, so there is no second path that could disagree with the first.
  WPFL_API_BASE: 'https://wpflapi.azurewebsites.net/api',
  WPFL_FETCH_TIMEOUT_MS: 30 * 1000,
  // Draft history and matchups go back to 2010; player scores start in 2015,
  // which is when player-level tracking began.
  HISTORY_MIN_SEASON: 2010,
  PLAYER_SCORES_MIN_SEASON: 2015,

  // ---- SQL (design §4.3) ----
  // The row cap keeps one broad query from spending the agent's whole context;
  // the timeout keeps a runaway join from holding a semaphore slot.
  SQL_ROW_LIMIT: 200,
  SQL_TIMEOUT_MS: 20 * 1000,

  // ---- Discord surface (design §6.3) ----
  TICKER_EDIT_THROTTLE_MS: 1500, // Discord allows ~5 edits / 5 s per channel
  THREAD_AUTO_ARCHIVE: ThreadAutoArchiveDuration.OneDay,

  // ---- WebFetch host allowlist (design §10.4) ----
  // A pasted beat-writer link is among the most natural things anyone will do
  // with this feature, so the guard is an allowlist rather than a blanket
  // refusal. Denials are recorded with denied_by so this list grows from
  // evidence about what people actually paste. Subdomains match.
  WEBFETCH_ALLOWED_HOSTS: [
    'espn.com',
    'nfl.com',
    'theathletic.com',
    'rotowire.com',
    'pff.com',
    'fantasypros.com',
    'nbcsports.com',
    'cbssports.com',
    'foxsports.com',
    'si.com',
    'bleacherreport.com',
    'yahoo.com',
    'wpflapi.azurewebsites.net',
    'wpfl-receipts-694ed0.pages.dev',
  ],
} as const;
