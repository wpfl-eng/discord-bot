// /ask Agent Configuration
// All tuning for the ask agent lives here, in the spirit of economyConfig.ts.
// Model, effort and thinking display are part of that tuning, not a separate
// concern -- "what model does this run" should be one file to open.

import { homedir } from 'node:os';
import path from 'node:path';
import { ThreadAutoArchiveDuration } from 'discord.js';

/**
 * A directory the feature owns, as an absolute path: the data directory, and
 * the agent's own HOME.
 *
 * The data directory feeds three things that must agree -- the agent's cwd,
 * the path guard's root and the `Read(//…)` allow rule -- and it used to be
 * WPFL_DATA_DIR verbatim. dotenv expands neither `~` nor `$HOME`, so an
 * override written the way .env.sample describes the default put the cwd in
 * a literal `~` directory relative to wherever pm2 started the bot. Exported
 * for its test.
 */
export function resolveDataDir(
  raw: string | undefined,
  home: string,
  fallback: string = '~/wpfl-data'
): string {
  const value: string = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  const expanded: string =
    value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  return path.resolve(expanded);
}

/** One argument of a file tool that names a path. */
export interface PathArgument {
  readonly key: string;
  /** A glob pattern: only the part before its first wildcard is a path. */
  readonly prefix?: boolean;
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
  // Runs in one thread go one at a time, or two resumes of one SDK session
  // race and one is forgotten. This many may wait behind the one in flight;
  // past it a message is refused with a reply rather than queued.
  THREAD_QUEUE_DEPTH: 2,
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
  // Every built-in file tool the agent may use, with the arguments that name
  // a path. Declared once because it has to agree in four places: `tools`
  // (what the agent can see), `allowedTools` (what `dontAsk` will permit),
  // the PreToolUse matcher that routes each tool to the path guard, and the
  // guard itself, which checks exactly these arguments. Stage 12's worst
  // defect -- every Grep and Glob denied -- was the first two disagreeing; a
  // guard that knew only `file_path` and `path` let an absolute Glob pattern
  // straight through (log Stage 14). `prefix` marks a glob, checked up to its
  // first wildcard. A tool with no entry here is denied, not waved through.
  PATH_ARGUMENTS: {
    Read: [{ key: 'file_path' }],
    Grep: [{ key: 'path' }],
    Glob: [{ key: 'path' }, { key: 'pattern', prefix: true }],
  } as Readonly<Record<string, readonly PathArgument[]>>,
  WEB_TOOLS: ['WebSearch', 'WebFetch'],

  // ---- Time ----
  // One timezone for the whole feature: the cap-reset line a member reads and
  // the "Today is" the agent is told must be the same day.
  LEAGUE_TZ: 'America/New_York',

  // ---- Data and freshness (design §3.5) ----
  // Outside the bot's repo: cwd points here and the PreToolUse hook confines
  // every file tool to it.
  DATA_DIR: resolveDataDir(process.env.WPFL_DATA_DIR, homedir()),
  // The Claude Code subprocess's HOME: where it keeps its sessions, and where
  // it looks for a login profile. Found, that profile's email is appended to
  // every turn's context as the user's, and the agent read it as the member
  // it was answering. So the subprocess gets a HOME that is nobody's: not the
  // bot user's (a dev box is logged in), and outside the data directory
  // (askAuth refuses otherwise), where the path guard would let any member
  // Read every other member's sessions.
  AGENT_HOME: resolveDataDir(process.env.WPFL_AGENT_HOME, homedir(), '~/wpfl-agent-home'),
  ARTIFACT_URL: 'https://wpfl-receipts-694ed0.pages.dev/postdraft.json',
  STALE_AFTER_MS: 6 * 60 * 60 * 1000,
  // The decade cache has its own window. In season its rows land weekly, so
  // the artifact window above would re-fetch thirteen endpoints four times a
  // day for nothing; and coupling it to the artifact's etag, which is what it
  // used to do, meant it refreshed only when draft-2026 was republished and
  // never otherwise (log Stage 14, decision 11).
  WPFL_CACHE_STALE_AFTER_MS: 24 * 60 * 60 * 1000,

  // ---- WPFL history API (design §3.7) ----
  // The four row-shaped endpoints -- draft history, matchups, player scores
  // and transactions -- are cached locally and reachable only through SQL, so
  // there is no second path that could disagree with the first.
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
  // Every wpfl tool call, enforced by the SDK; its default is unbounded.
  // Above the SQL and history-API timeouts so those still report their own
  // reason, and well under QUERY_TIMEOUT_MS so a hung ESPN lookup -- the fork
  // has no request timeout -- costs the model one tool call, not the slot.
  MCP_TOOL_TIMEOUT_MS: 60 * 1000,

  // ---- Discord surface (design §6.3) ----
  TICKER_EDIT_THROTTLE_MS: 1500, // a coalescing window; discord.js handles the real rate limit
  THREAD_AUTO_ARCHIVE: ThreadAutoArchiveDuration.OneDay,

  // ---- Who may run /ask-admin ----
  // Discord's Administrator permission only hides the command, and any server
  // admin can widen that from the UI. This is the check nothing in the UI can
  // undo: the pause switch and the resync are the commish's, not whoever
  // happens to hold a role. The id is the one constants/wpflMembers.ts maps
  // to AJ Boorde.
  ADMIN_USER_IDS: ['120231673722830849'] as readonly string[],

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

/** The file tools, derived from the table: a tool cannot be listed without its path arguments. */
export const FILE_TOOLS: readonly string[] = Object.keys(ASK.PATH_ARGUMENTS);
