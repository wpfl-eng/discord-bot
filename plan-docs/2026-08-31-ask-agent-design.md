# WPFL Ask Agent — Design Document

**Date:** 2026-08-31
**Status:** Approved after adversarial review; not yet implemented
**Author:** Claude + AJ
**Log:** `plan-docs/2026-08-31-ask-agent-log.md`

> **Revision note.** This document was rewritten on 2026-08-31 after an
> adversarial review measured its claims against the live artifact, the live
> Agent SDK docs, and the installed packages. Twelve claims were wrong; the
> corrections and the decisions that followed are recorded in the log's Stage 1
> entry. The most consequential: **the original draft was measured against
> draft-2026's local artifact, not the one published at the URL the bot
> fetches.** Every measurement in this version is against the published file.
>
> **Second revision, same day.** A build-readiness review (log Stage 3) trimmed
> the structure to what the work actually needs, replaced the test inventory with
> a TDD contract (§13), mapped the phases onto branches (§14), and added the git
> workflow and handoff boundary (§17). No capability was dropped: 20 source files
> became 17 and 9 MCP tools became 8, entirely by removing duplication.

---

## 1. Overview

### What We're Building

A single slash command, `/ask`, that answers open-ended questions about the WPFL
league. It runs on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) —
Claude Code packaged as a library — and reasons over five sources:

1. The **draft-2026 post-draft report** (the published artifact, shredded to disk).
2. A **locally cached decade of WPFL history rows** (2010–2025), queryable by SQL.
3. The **WPFL history API's computed aggregates**, called live.
4. The **live 2026 ESPN league** (the only source of current-season truth).
5. The **web**, for injury news, snap counts, and results.

It answers in a public Discord thread. Follow-up messages in that thread continue
the same Agent SDK session, so conversation works.

### Why the Agent SDK Rather Than the Messages API

The alternative was `client.beta.messages.toolRunner` from `@anthropic-ai/sdk` —
lighter, in-process, no subprocess. We chose the Agent SDK because the value here
comes from **exploration we did not pre-script**. A question like *"has anyone
ever paid up for a WR the way I did and had it work?"* is answered by joining
bodies nobody wrote a `getWrValueHistory()` tool for. The Agent SDK ships
`Read`/`Grep`/`Glob`/`WebSearch`/`WebFetch`, real sessions with `resume`, hooks,
and per-query budgets. The Tool Runner would have limited Claude to the tools we
thought to write in advance.

Cost of that choice, accepted knowingly: a subprocess per query, a bundled native
binary on the host, and more tokens per answer.

### Design Principles

1. **Grounded or silent.** Every number comes from a file read or a tool result
   in this turn. If it can't be sourced, say so. Inherited from draft-2026's
   prose discipline (`../draft-2026/CLAUDE.md`).
2. **The bot never speaks unprompted.** No cron, no scheduled posts, no DMs.
3. **Nothing writes.** No shell, no file writes, no database writes from the
   agent. The agent reads and reasons; the bot's own code does the writing.
4. **Show the work.** A live ticker carrying tool calls *and* reasoning
   summaries, then an inline source footer. Being checkable matters more than
   sounding confident.
5. **Never contradict a published command.** Where the league already has a
   number — `/ewins`, `/optimal`, `/standings` — the agent uses that source
   rather than recomputing it. One bot disagreeing with itself in public costs
   more trust than a missing answer.
6. **Config in one file.** `ask/askConfig.ts`, in the spirit of
   `economy/economyConfig.ts`.
7. **The minimum that does the job.** No abstraction without a second caller, no
   configurability nobody asked for, no defensive handling for states that cannot
   occur. Validate at the boundaries — user input, external APIs, the artifact —
   and trust our own code in between. A directory is earned by its contents, not
   by symmetry.

### Explicitly Out of Scope

Recorded so a future reader knows these were considered and declined, not missed:

- **Scheduled or proactive jobs of any kind** — no Tuesday recap, no Sunday
  lineup guard, no Thursday preview, no waiver Wednesday, no DMs.
- **Additional commands** — no `/scout`, `/roast`, `/lineup`, `/trade`.
- **Economy integration** — `/ask` does not cost coins.
- **Channel gating** — no `ASK_CHANNEL_ID`.
- **Postgres as an agent tool** — the agent cannot query the bot's own tables.
- **Subagents** — v1 is a single agent loop.
- **Reading Discord history** — the agent sees the question, not the channel.
- **Sleeper** — per `CLAUDE.md`.

---

## 2. Decisions

| Area | Decision |
| --- | --- |
| Runtime | `@anthropic-ai/claude-agent-sdk` 0.3.252, Agent SDK for everything |
| Model | `claude-opus-5`, `effort: 'high'`, adaptive thinking, `display: 'summarized'` |
| Data path | Fetch published artifact → shred to ~40 files + generated `INDEX.md` |
| Shred policy | Tolerant + loud: unknown body shredded generically and flagged; a **required** body missing or reshaped aborts |
| Freshness | Lazy: etag check before `/ask` when shred is older than 6 h. No timers |
| WPFL cache | Three row-shaped endpoints cached locally, 2010–2025, refreshed with the shred |
| Built-in tools | `tools: [Read, Grep, Glob, WebSearch, WebFetch]` — every other built-in removed from context |
| Custom tools | WPFL computed aggregates, ESPN 2026 live, read-only DuckDB SQL |
| Permission mode | `dontAsk` (headless — nothing may fall through to a prompt) |
| Path confinement | `Read(//DATA_DIR/**)` allow rule **plus** a `PreToolUse` realpath hook |
| Setting sources | `[]` (never load the repo's `.claude/` config) |
| `cwd` | The data dir, never the repo |
| Surface | `/ask` only; public thread where possible, in-place where not; anyone continues; soft cap 15, hard 20 |
| Progress UX | Ticker of tool calls + reasoning summaries, then streamed prose on ~1.5 s edits |
| Grounding | Grounded-or-silent + inline source footer naming files, tools, and as-of dates |
| Identity | Static `constants/wpflMembers.ts`, 14 rows, resolution-checked at startup |
| Auth | Swappable: `ANTHROPIC_API_KEY` preferred, else `CLAUDE_CODE_OAUTH_TOKEN` |
| Hardening | Minimal subprocess env, `PostToolUse` audit, `PreToolUse` path + WebFetch guards |
| Limits | 20/day/user, 1500 queries/month league-wide, $1.00 `maxBudgetUsd` per query |
| Runtime guard | 2 concurrent queries, 4-minute wall-clock deadline |
| Sessions | `cleanupPeriodDays: 7`; threads archive at `OneDay`; revived dead threads start fresh |
| ESPN client | Switch to the fork — the installed upstream package lacks `getRecentActivity` |
| Subagents | None in v1 |
| Tests | **Strict TDD** — red-green-refactor, three named carve-outs (§13). No live calls in CI |
| Fixtures | Trimmed, generated by a committed script; one live shape-check, skipped in CI (§13.2) |
| Git | `feat/ask` off `main`; six `feat/ask-*` slices merged `--no-ff` behind a green gate (§17) |

### Auth: The Open Question

The Agent SDK docs state, verbatim, in both the overview and the quickstart:

> "Unless previously approved, Anthropic does not allow third party developers to
> offer claude.ai login or rate limits for their products, including agents built
> on the Claude Agent SDK. Please use the API key authentication methods
> described in this document instead."

AJ intends to run this on a 20x Max plan token (`CLAUDE_CODE_OAUTH_TOKEN`), a
decision made with that language in view. The code is therefore written
**auth-agnostic**: `ask/askAuth.ts` prefers `ANTHROPIC_API_KEY` and falls back to
the OAuth token, so switching is one environment variable on the host and never a
code change. The repository hardcodes neither.

Three consequences carried through the rest of this design:

1. **`total_cost_usd` is not money and does not gate anything.** The cost-tracking
   doc is explicit: it is a client-side estimate computed locally from a bundled
   price table, and *"do not bill end users or trigger financial decisions from
   these fields."* On subscription auth there is no per-token bill for it to
   approximate at all. It is recorded for observability and nothing else.
2. **`maxBudgetUsd` still works and still matters.** The SDK computes it locally
   regardless of auth, so it remains the control that stops one pathological loop
   — the only failure mode that gets expensive fast.
3. **The real limiters are counts**: `DAILY_QUESTIONS_PER_USER` and
   `MONTHLY_QUERIES_TOTAL`, neither of which can be zeroed by a crashed result or
   drift with a price table.

---

## 3. Data Architecture

### 3.1 The Source Artifact

draft-2026 publishes its post-draft report to Cloudflare Pages as a deliberate
manual step (`../draft-2026/scripts/deploy.sh`). Verified 2026-08-31:

```
$ curl -sI https://wpfl-receipts-694ed0.pages.dev/postdraft.json
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
etag: "75c67b38d2787f62bc10047932af0353"
cache-control: public, max-age=0, must-revalidate
```

This URL is the **only** coupling between the bot and draft-2026. The bot never
reaches draft-2026's machine, its FastAPI server, its DuckDB, or its 35 MB raw
cache. Confirmed: the bot host is a different machine — `pm2` is not installed on
the dev box and `~/discord-bot` does not exist there; `scripts/deploy.sh` pulls
from GitHub and runs `pm2 restart discord-bot` in `$HOME/discord-bot`.

**`deploy.sh` wraps the artifact.** It writes `{"available": True, **art}` to
mirror the FastAPI response shape the frontend gates on. So the published file
carries a top-level `available` boolean that is not a body. The shredder ignores
it by name and says so in `INDEX.md`.

Measured shape of the **published** artifact (935,568 bytes on the wire;
862,867 bytes re-serialized compactly):

| Body | Bytes | Shape |
| --- | ---: | --- |
| `available` | 4 | scalar; the deploy wrapper, ignored |
| `meta` | 414 | dict; `season`, `generated`, `facts_as_of`, `risk_model` |
| `teams` | 119,535 | list of 14, ~8,538 B each |
| `league` | 322,141 | dict of 15 keys |
| `news` | 214,105 | dict of 8 keys |
| `night` | 71,374 | dict of 8 keys |
| `history` | 135,225 | dict of 11 keys |

Largest individual members: `league.dossiers` 209,548 B (dict of **196** players),
`news.players` 180,933 B (dict of **182**), `history.seasons` 73,192 B (list of
140), `league.board` 53,600 B (list of 196), `league.rivalries` 29,806 B,
`night.spend_race` 24,307 B.

### 3.1a Published vs. Local: The Divergence That Broke the First Draft

The original design measured `../draft-2026/data/cache/postdraft_2026.json`
(955,019 B) and assumed it was what the URL serves. It is not. Both files carry
the same `meta.generated` (`2026-08-28 21:20`) and byte-identical `meta`, `teams`,
`news`, and `history` — but draft-2026's part-18 `prune` and `swap_body`
operations ran locally after the last publish, and **they do not touch
`meta.generated`.** Measured diff, 2026-08-31:

| | Published (what the bot gets) | Local (what publishes next) |
| --- | --- | --- |
| top-level extra | `available` | `market` (35,622 B, 9 keys) |
| `league` extra | `grade_board`, `ridgeline`, `season_intro` | — |
| `night` extra | `clock` | `acts` |

Two consequences, both load-bearing:

1. **`meta.generated` cannot identify an artifact version.** Only the etag can.
   The sync logic keys on the etag and nothing else.
2. **The three `league` extras and `night.clock` are draft-2026's `DEAD_KEYS`** —
   analysis it has deliberately retired. A tolerant shredder would happily shred
   them and the agent would cite retired work as current. They are skipped by
   name (§3.6).

A pre-launch re-run of `draft-2026/scripts/deploy.sh` is a **ship prerequisite**,
so the published artifact carries the decade market study and `night.acts` and
drops the dead keys. The shredder is nonetheless written to handle both shapes,
because it must survive the window before that happens and every publish after.

### 3.2 Why Shredding Is Required

Two measurements settle this.

**The published file has zero newlines.** `wc -l` returns `0` — `deploy.sh` writes
it with Python's `json.dump`, which minifies. `Grep` against it matches the single
line and returns the whole file. The tool is useless in that form.

**A whole-file `Read` is ~216,000 tokens.** Every question would carry the entire
decade of league history into context whether or not it was relevant.

After shredding, the same question — *"why did Jimmy Simpson's draft grade come
out A+?"* — is `Read INDEX.md` (11.2 KB, measured) plus
`Read teams/jimmy-simpson.json` (8.8 KB): roughly **5K tokens and two tool
calls**. The index is larger than this document first estimated because it
describes all 53 files individually; 5K against 216K is the comparison that
matters.

### 3.3 Shred Layout

Written to `ASK.DATA_DIR` (default `$HOME/wpfl-data`, override `WPFL_DATA_DIR`).
Deliberately **outside the bot's repo**, because `cwd` points here and the
`PreToolUse` hook confines every file tool to it.

```
$HOME/wpfl-data/
  INDEX.md                       generated map + glossary + as-of dates
  .etag                          last-seen Cloudflare etag
  meta.json
  teams/
    nixon-ball.json              14 files, ~8.5 KB each, slug of canonical owner
    aj-boorde.json
    ...
  league/
    standings.json  market.json  superlatives.json  story.json
    runs.json  playoff_field.json  name_rankings.json
    intro.json  board_intro.json
    rivalries.json               29.8 KB
    board.json                   53.6 KB, 196 entries
    dossiers.jsonl               196 lines, one player per line
  night/
    spend_race.json  strip.json  stepper.json  sankey.json
    beeswarm.json  autopsy.json  annotations.json
    acts.json                    present only after the next publish
  history/
    seasons.json  bump.json  dynasty.json  money.json  hall_of_fame.json
    arcs.json  champions.json  identities.json  churn.json
    record_book.json  skill_luck.json
  news/
    as_of.json  window_days.json  teams.json  wire.json  reads.json
    team_lines.json  intro.json
    players.jsonl                182 lines, one player per line
  market/                        present only after the next publish
    meta.json  curve.json  persistence.json  hindsight.json
    fingerprints.json  champions.json  recalibration.json
    usage.json  prose.json
  wpfl/                          the cached history rows — see §3.7
    draft_history.jsonl  matchups.jsonl  player_scores.jsonl
    .fetched
```

Three rules do the work:

- **One file per natural unit.** A question about one owner reads 8.5 KB, not
  935 KB.
- **`.jsonl` for the large keyed collections.** `league.dossiers` and
  `news.players` become one JSON object per line, which is what turns `Grep` from
  useless into surgical: `grep "Bijan Robinson" league/dossiers.jsonl` returns
  ~1 KB.
- **Nothing outside `DATA_DIR`.** The shred is written to a sibling temp
  directory and swapped in atomically, so a partial shred is never readable.

Owner filenames use a slug of the **canonical** WPFL spelling from
`../draft-2026/backend/config.py:57` (`TEAM_OWNERS`), e.g. `mike-simpson.json`.

### 3.4 `INDEX.md`

Generated on every shred, never hand-edited, so it cannot drift. Contains:

1. **Header** — `meta.generated`, `meta.facts_as_of`, `news.as_of`, the artifact
   etag, the WPFL cache's fetch date, and an explicit statement that the artifact
   is a **post-draft** report, so anything about the 2026 season in progress must
   come from ESPN or the web.
2. **File map** — every path with a one-line description and its size, generated
   from what was actually written, so the map can never describe files that
   aren't there.
3. **Anything unexpected** — any body shredded generically because the shredder
   did not recognize it, named explicitly and marked undocumented, so the agent
   knows it is reading something nobody wrote a description for.
4. **Glossary** — what `worth`, `market`, `edge`, `grade.composite`,
   `skill_luck`, `hindsight`, and `fingerprints` mean. These definitions are
   **copied into this repo as constants**, not read from draft-2026 at runtime —
   the bot host does not have draft-2026 on it. (This list said `mkt` until
   Stage 5 counted keys in both builds and found zero occurrences of it; the
   field the artifact actually carries is `market`.)
5. **Owner roster** — the 14 canonical names, so the agent never invents a
   spelling.
6. **Source routing** — a short table of which source answers which kind of
   question, including the two hard rules: the WPFL API stops at 2025, and
   expected wins / optimal coaching are never to be computed by hand (§4.2).

The agent reads this first. It is the single highest-leverage artifact in the
design: it is what lets the agent open two files instead of forty.

### 3.5 Sync and Freshness

No timers anywhere. `wpfl/artifactSync.ts`:

```ts
export async function ensureFresh(): Promise<void> {
  const age: number = Date.now() - shredMtime();
  if (age < ASK.STALE_AFTER_MS) return;             // 6 h
  const etag: string | null = normalizeEtag(await etagOf(ARTIFACT_URL));
  if (etag !== null && etag === lastSeenEtag()) { touchShred(); return; }
  await fetchAndShred();                            // ~1 s, 935 KB
  await refreshWpflCache();                         // §3.7, ~12 s
}
```

**Etags must be normalized.** Measured 2026-08-31: Cloudflare returns a *weak*
validator when it serves the artifact compressed and a *strong* one when it does
not — `curl -sI` (which sends no `Accept-Encoding`) gets
`"75c67b38d2787f62bc10047932af0353"`, while Node's `fetch` always negotiates
gzip and gets `W/"75c67b38d2787f62bc10047932af0353"` on both HEAD and GET, for
the same build. Comparing the raw header strings would therefore never match:
the unchanged short-circuit would be dead and every stale window would pay a
full re-shred plus a cache rebuild, forever. `normalizeEtag` strips the `W/`
prefix and the quotes at the boundary. With it, a stale check against an
unchanged artifact costs **0.16 s** instead of **8.0 s**.

Called once on `client.once('ready')` and again at the top of every `/ask` before
`query()`. Whoever asks the first question after a stale window pays a second or
two. A failed fetch is **non-fatal**: the previous shred stays valid and the run
continues with slightly older data, whose as-of date `INDEX.md` and the answer
footer both report honestly.

**Freshness is shown, not detected.** The bot does not compute artifact age and
warn about it. It states the as-of dates in `INDEX.md` and in every answer's
source footer, and lets a reader who knows the league judge for themselves.
Publishing remains a deliberate step in draft-2026's Tuesday ritual; the bot's
job is to be honest about what it has, not to nag.

### 3.6 Shredder Failure Modes

The shredder is the piece most likely to rot, because draft-2026's artifact shape
moves — part 18 pruned keys, `swap_body` adds them, and the in-season era adds a
`race` body that does not exist yet. The original design made **any** unrecognized
body a hard error. That is the wrong trade: it means the first in-season publish
aborts the shred, the previous shred is retained, and the bot goes on answering
confidently from August data. The failure mode the rule was written to prevent is
the one it would cause.

The policy is therefore **tolerant and loud**:

| Condition | Behavior |
| --- | --- |
| Known body, expected container type | Shredded per its declared plan |
| Known body, **wrong container type** (e.g. `teams` becomes a dict) | **Abort.** Previous shred retained, error logged |
| **Required** body absent (`meta`, `teams`, `league`, `news`, `history`) | **Abort.** Previous shred retained, error logged |
| **Optional** known body absent (`night`, `market`, `night.acts`) | Fine. Simply not in the shred or the index |
| Key in `DEAD_KEYS` | Skipped by name; `INDEX.md` records that it was skipped and why |
| `available` | Ignored by name; `INDEX.md` records that it is the deploy wrapper |
| **Unknown** top-level body | Shredded generically (dict → one file per key, list → one file), listed in `INDEX.md` as undocumented, `WARN` logged. **Does not abort** |

```ts
// wpfl/shredder.ts — the declarative core
const BODY_PLANS: Record<string, BodyPlan> = {
  meta:    { kind: 'single', required: true  },
  teams:   { kind: 'list-by-owner', required: true  },
  league:  { kind: 'dict', required: true, jsonl: ['dossiers'] },
  news:    { kind: 'dict', required: true, jsonl: ['players'] },
  history: { kind: 'dict', required: true  },
  night:   { kind: 'dict', required: false },
  market:  { kind: 'dict', required: false },
};

const IGNORED_KEYS: ReadonlySet<string> = new Set(['available']);

// Mirrors ../draft-2026/backend/analysis/artifact.py DEAD_KEYS. Kept here
// because the bot host does not have draft-2026 on it. Sync when it changes.
const DEAD_KEYS: ReadonlySet<string> = new Set([
  'league.grade_board',
  'league.ridgeline',
  'league.season_intro',
  'night.clock',
]);
```

`INDEX.md` is regenerated from the same pass, so what the agent reads about the
data always describes the data that was actually written.

### 3.7 The Cached WPFL Decade

Measurement drove this. The shredded artifact is under 1 MB across ~40 files —
already sized for `Read` and `Grep`. The WPFL history is not:

| Source | Rows | Bytes | Whole-file read |
| --- | ---: | ---: | --- |
| `draft/history` 2010–2025 | 3,130 | 695,718 | ~174K tokens |
| `fantasyMatchupWinners` 2010–2025 | 1,449 | 330,731 | ~83K tokens |
| `playerscores` **one** season (2024) | 3,471 | 903,890 | ~226K tokens |
| `playerscores` 2015–2025 | ~38,000 | ~10 MB | ~2.5M tokens |

The original design pointed its SQL tool at the artifact — the one dataset that
did not need it — and left out the decade, the only thing too large to read. Its
own motivating question, *"has anyone ever paid up for a WR the way I did and had
it work?"*, cannot be answered from the artifact at all: it needs ten years of
auction prices joined to what those players went on to score.

So the three **row-shaped** endpoints are fetched once and cached as JSONL under
`DATA_DIR/wpfl/`, refreshed alongside the shred:

| File | Endpoint | Rows |
| --- | --- | ---: |
| `draft_history.jsonl` | `/api/draft/history?seasonMin=2010&seasonMax=2025` | 3,130 |
| `matchups.jsonl` | `/api/fantasyMatchupWinners?seasonMin=2010&seasonMax=2025` | 1,449 |
| `player_scores.jsonl` | `/api/playerscores`, per season 2015–2025 | 35,682 |

Player scores are fetched a season at a time (one 2024 season took 1.28 s), so a
cold build is **8–12 seconds** measured end to end, for 40,261 rows and 9.33 MB
across the three files.

**`seasonMax` is the current year, not a hardcoded 2025.** The table above was
measured while 2026 was empty, but the paragraph below is the load-bearing one:
the cache refresh exists so the API's current-year rows appear as weeks
complete, which cannot happen behind a 2025 cap. Asking for a season that has
not been played costs one request and returns `[]`, which is cheaper and less
fragile than getting the season boundary right every January. The cache is refreshed on the same lazy schedule
as the shred, which matters in season: the WPFL API will begin populating 2026 as
weeks complete.

### 3.8 What the Bot Cannot See

Stated plainly so nobody expects otherwise:

- draft-2026's **raw cache** (~35 MB: ESPN player blobs, nflverse CSVs, ten years
  of `wpfl_playerscores_*.json`) stays on AJ's dev box. The WPFL history API
  covers most of the same ground and is publicly reachable, so §3.7 closes the gap
  without shipping files.
- draft-2026's **models** (valuation, optimizer, simulator, WAR, Shapley) are
  Python and do not run here. Only their *outputs*, as frozen in the artifact, are
  available.
- **draft-2026's in-season `race` body** does not exist yet. When it appears it
  will be shredded generically and flagged as undocumented until someone writes it
  a plan and a glossary entry.

---

## 4. Tool Surface

### 4.1 Built-in Tools and the Permission Configuration

This is the security-critical block, and the original design had a hole in it.

Two facts from the permissions doc drive the shape:

> "`allowed_tools=['Read', 'Grep']` — Read and Grep are auto-approved. **Any
> other tool not listed here is still available to Claude and falls through to
> the permission mode.**"

> "Claude Code checks file permissions against `Edit(path)` and `Read(path)`
> rules only. If you write a path rule for `Write`, `NotebookEdit`, `Glob`, or the
> legacy `MultiEdit` tool instead, Claude Code accepts the rule but never consults
> it."

So `allowedTools` alone confines nothing, `Grep` and `Glob` cannot be path-scoped
at all, and a **bare** `Grep` allow auto-approves grepping any file on disk — and
`Grep` returns file *contents*. On the bot host that reaches `~/discord-bot/.env`
and its `DISCORD_TOKEN`, `POSTGRES_*`, `ESPN_S2`, and `SWID`. §10.1's minimal
subprocess environment keeps those values out of the *process*; it does nothing
about reading the *file*. The Bash sandbox does not help either — it is
documented as covering the Bash tool, which we do not enable.

```ts
tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],  // availability
permissionMode: 'dontAsk',        // unlisted → denied outright, never prompts
settingSources: [],               // never load the repo's .claude/ config
cwd: ASK.DATA_DIR,                // not the repo
allowedTools: [                   // permission
  `Read(//${ASK.DATA_DIR}/**)`,   // PATH-SCOPED, with the // absolute anchor
  'WebSearch',
  'WebFetch',
  'mcp__wpfl__*',
],
hooks: {
  PreToolUse: [
    { matcher: 'Read|Grep|Glob', hooks: [confineToDataDir] },   // §10.2
    { matcher: 'WebFetch',       hooks: [guardFetchDomain]  },  // §10.4
  ],
  PostToolUse: [{ hooks: [auditToolCall] }],                    // §10.3
  // PostToolUse does not fire for a tool that *threw*; this event does, and
  // carries the error string directly. Measured 2026-08-31.
  PostToolUseFailure: [{ hooks: [auditToolCall] }],             // §10.3
},
```

- **`tools` is an availability allowlist, not a denylist.** The custom-tools doc
  is explicit that `tools: [...]` removes every unlisted built-in from Claude's
  context. The original design used `disallowedTools: ['Bash','Write','Edit',
  'NotebookEdit']`, an enumerated denylist that goes stale the moment the SDK adds
  a built-in. Anything new would be denied by `dontAsk` anyway, but it would still
  cost context and a wasted turn. The allowlist costs neither.
- **`permissionMode: 'dontAsk'`** is documented as the headless choice: *"you want
  a fixed, explicit tool surface for a headless agent and prefer a hard deny over
  silent reliance on `canUseTool` being absent."* There is no human at a keyboard
  in a Discord bot; a tool call that falls through to a prompt has nowhere to go.
- **The `//` prefix means an absolute filesystem path.** A single leading slash
  would anchor at the session's working directory instead — a subtle and expensive
  difference.
- **The `PreToolUse` path hook is the guarantee, not the allow rule.** The docs
  describe `Read` rules as applying to Grep and Glob on a *"best-effort"* basis,
  which is not a security property. Hooks run before every other permission step
  and a hook deny holds even in `bypassPermissions`, so the hook is the only
  mechanism that cannot be undone by a configuration mistake elsewhere.

### 4.2 MCP Server: `wpfl`

One in-process SDK MCP server via `createSdkMcpServer`, so all tools share the
`mcp__wpfl__*` prefix and one allow rule. In-process means the tools run inside
the bot's own Node process with full access to `.env` — which is fine, because
they are our code and do only what we wrote.

**Tool search is on by default and defers SDK MCP schemas**, so Claude sees the
tool names and loads a schema on demand. With eight custom tools that is an extra
round trip on most questions. The three the agent needs on nearly every question
— `sql`, `espn_teams`, `expected_wins` — are declared `alwaysLoad: true` so their
schemas ride in the initial prompt; the rest stay deferred.

#### WPFL history: computed aggregates only

The three row-shaped endpoints are cached and reachable **only through SQL**
(§3.7). There is no wrapper for them, so there is no second path that could
disagree with the first.

The remaining three are **server-computed aggregates** whose answer depends on
parameters a cache cannot enumerate. Verified 2026-08-31 for AJ Boorde in 2024:

| Call | Result |
| --- | --- |
| `expectedwins?weekMin=1&weekMax=5` | 3.92 expected / 4.00 actual |
| `expectedwins` (regular season) | 9.06 / 10.00 |
| `expectedwins&includePlayoffs=true` | 10.67 / 12.00 |
| `optimalcoaching/pointsfor/2024?week=5` | 616.98 actual / 660.38 optimal |
| `optimalcoaching/pointsfor/2024` | 1941.52 / 2180.72 |

`optimalPointsFor` in particular requires an optimal-lineup solve that cannot be
reconstructed from raw scores at all. So these stay live typed tools:

| Tool | Endpoint |
| --- | --- |
| `expected_wins` | `/api/expectedwins` |
| `optimal_coaching` | `/api/optimalcoaching/pointsfor/{year}` |
| `drafted_points` | `/api/draft/draftedpoints` |

Each takes an `AbortController` timeout in the style of
`discordCommands/ewins/ewins.ts:43` and returns rows as JSON.

**The system prompt carries a hard rule about these:** never compute expected wins
or optimal-coaching numbers by hand from cached rows. `/ewins` and `/optimal`
publish these figures to the same channel, and a bot that contradicts itself in
front of the league is worse than a bot that says "let me call that."

**Critical constraint, verified 2026-08-31:**

```
$ curl -s ".../api/expectedwins?seasonMin=2026&seasonMax=2026&includePlayoffs=false"
[]
```

The WPFL API is the historical archive. 2025 is complete through week 14; **2026
is empty on every endpoint**. The tool descriptions and `INDEX.md` both state
this, so the agent reaches for ESPN rather than returning an empty array and
guessing.

#### ESPN 2026 live

Verified reachable 2026-08-31 with the credentials in `.env`: 14 teams at 0-0,
week-1 matchups scheduled, rosters populated with `injuryStatus`, 837 free agents
carrying `percentOwned`, `percentChange`, and `auctionValueAverage`.

| Tool | Client method | Returns |
| --- | --- | --- |
| `espn_teams` | `getTeamsAtWeek` | Rosters with `injuryStatus`, plus records, seeds and points-for |
| `espn_boxscores` | `getBoxscoreForWeek` | Weekly matchups and scores |
| `espn_free_agents` | `getFreeAgents` | Available players, filterable by position |
| `espn_transactions` | `getRecentActivity` | Adds, drops, trades — **current season only** |

The original design listed five tools here. `espn_roster` and `espn_standings`
were the same `getTeamsAtWeek` call returning the same objects, differing only in
which fields their descriptions pointed at — two schemas, two deferred loads, and
two ways for the agent to ask one question. They are one tool, `espn_teams`,
whose description names both uses.

**This required a dependency change, now made and verified.** `package.json`
pinned `"espn-fantasy-football-api": "2.0.1"` — the **upstream npm package** —
while `CLAUDE.md` claimed the fork was in use and `types/espn-fantasy.d.ts` was
written against the fork. Upstream 2.0.1 has no `getRecentActivity`, but
`discordCommands/activity/activity.ts:29` calls it, so **`/activity` was broken**
and failed at runtime rather than at typecheck.

The fork did not work as-shipped either. Its last commit (`5f838e0`, 2024-05-31,
*"Updated api url"*) moved `axios.defaults.baseURL` and the leagueHistory route to
`lm-api-reads.fantasy.espn.com` but missed four call sites still hardcoding
`https://fantasy.espn.com/` — three of them inside `getRecentActivity`. That host
now 302-redirects to `www.espn.com/fantasy/`; axios follows the redirect, so
`response.data.topics` is `undefined` and the method throws `Cannot read
properties of undefined (reading 'map')`.

Fixed in the fork at commit **`591ee59`** (four base URLs, rebuilt bundles, all
197 of its own unit tests passing) and pinned by SHA:

```
"espn-fantasy-football-api":
  "git+https://github.com/aboorde/ESPN-Fantasy-Football-API.git#591ee59a6c603743b861fa5cd312119ba770863e"
```

Repo-wide, only four ESPN methods are called: `getRecentActivity` (activity),
`getBoxscoreForWeek` (closestscores, median, trophies), `getTeamsAtWeek`
(standings). All four verified against the live league after the swap, and
`/standings`, `/median`, `/trophies`, `/closestscores` and `/activity` all
re-run clean. Upstream additionally has `getDraftInfo` and
`getHistoricalTeamsAtWeek`, which the fork lacks and no command uses; the 2026
draft is already in the artifact in far more depth.

**Two constraints the fork imposes**, both verified and both affecting tool
design rather than existing commands:

- **`espn_transactions` is current-season only.** ESPN serves
  `/communication` for the current season and 404s for prior ones (2024 → 404,
  2025 → 404, 2026 → 200), independent of client. The tool description must say
  so or the agent will burn turns retrying a historical question.
- **The fork returns blank team names.** `team.name` is `" "` on every team where
  upstream returns `"Ball's Balls"`, and the fork has no `ownerName` field. Every
  standings-relevant field (`wins`, `losses`, `ties`, `finalStandingsPosition`,
  `playoffSeed`, `regularSeasonPointsFor`) is byte-identical to upstream, so no
  command regresses — but it means `constants/wpflMembers.ts` is not merely the
  preferred owner mapping, it is the only one available.

Team ↔ owner translation goes through `constants/wpflMembers.ts` so ESPN's team
*names* — which are custom and change yearly ("Ball's Balls", "Baby Hugo's College
Fund") — are never load-bearing.

### 4.3 MCP Tool: `sql`

Read-only DuckDB over the shredded artifact **and** the cached WPFL decade. This
replaces the shell we declined to give the agent, and it is the reason the agent
can do real aggregation — correlations, ten-year splits, group-bys, and joins
across the two sources — instead of arithmetic over hundreds of rows in-context.

**Design — materialize, then lock down:**

1. On first use, open an **in-memory** DuckDB.
2. `CREATE TABLE ... AS SELECT * FROM read_json_auto(<file>)` for each queryable
   body and each cached WPFL file. The whole corpus is ~11 MB, so materializing is
   cheap and takes external file access out of the query path entirely.
3. Then disable external access and lock the configuration, so agent-supplied SQL
   can neither read arbitrary files nor write any (`COPY ... TO`).
4. Rebuild the whole in-memory DB whenever the shred or the cache changes.

Tables the agent sees:

```
-- from the artifact
teams, dossiers, board, standings, superlatives, runs, rivalries,
seasons, record_book, skill_luck, churn, identities, arcs, dynasty,
spend_race, strip, beeswarm, news_players, ...

-- from the cached WPFL decade
wpfl_draft_history    3,130 rows   2010-2025
wpfl_matchups         1,449 rows   2010-2025
wpfl_player_scores   35,682 rows  2015-2025
```

**Statement guard.** Not belt-and-braces: measured, DuckDB executes *every*
statement it is handed, and dropping an in-memory table is not external access,
so the lockdown does not cover it. This is the control:

- Exactly one statement; a single trailing `;` tolerated.
- Must match `/^\s*(SELECT|WITH)\b/i`.
- Reject `ATTACH`, `COPY`, `INSTALL`, `LOAD`, `EXPORT`, `PRAGMA`, `SET`,
  `CREATE`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CALL`.
- Row cap and a wall-clock timeout, with an explicit truncation notice.

*Confirmed 2026-08-31 against DuckDB 1.5.5-r.4: both setting names are real, both
apply at runtime, and the lockdown holds across connections (§15.4). Results are
read with `getRowObjectsJson()` — DuckDB hands JS a `BigInt` for every BIGINT,
which `JSON.stringify` throws on, and `{entries: …}` for every struct. Integers
therefore reach the agent as strings, which the tool description states.*

**Packaging risk resolved.** `@duckdb/node-api` 1.5.5-r.4 gets its binary from
`@duckdb/node-bindings`, which ships per-platform prebuilt packages
(`@duckdb/node-bindings-linux-x64` and seven siblings) as **optionalDependencies**
— the same mechanism the Agent SDK uses for its own native binary. These are
Node-API and therefore ABI-stable across Node majors, so the original worry about
the host's Node 20.15.1 does not apply. What remains is the single risk both
packages share: `npm install` must keep optional dependencies (§15.3).

### 4.4 Web Tools

`WebSearch` and `WebFetch` are enabled — they are what keeps answers current
between artifact pushes, and until kickoff they are the only route to actual NFL
news at all.

Worth noting for the threat model: the Agent SDK docs state that **web search
results are summarized before entering context**, which materially reduces
injection exposure from search hits. `WebFetch` has no such summarization, which
is why it gets a domain guard (§10.4) rather than a blanket refusal.

---

## 5. The Agent Runner

### 5.1 `query()` Options

```ts
// ask/askRunner.ts
const options: Options = {
  model: 'claude-opus-5',
  effort: 'high',
  thinking: { type: 'adaptive', display: 'summarized' },   // §6.3

  cwd: ASK.DATA_DIR,
  settingSources: [],
  permissionMode: 'dontAsk',
  tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
  allowedTools: [...],            // §4.1

  systemPrompt: WPFL_ANALYST,     // §5.2 — custom string, not the claude_code preset
  mcpServers: { wpfl: wpflServer },
  strictMcpConfig: true,          // ignore any .mcp.json on the host

  includePartialMessages: true,   // §6.3 — needed for streamed prose
  maxBudgetUsd: ASK.MAX_BUDGET_USD,
  env: agentEnv(),                // §10.1 — minimal, not process.env
  settings: { cleanupPeriodDays: ASK.SESSION_RETENTION_DAYS },  // §6.2

  hooks: { ... },                 // §4.1

  // continuation only; absent on the first turn of a thread
  resume: sessionId,
};
```

Notes on specific choices:

- **`systemPrompt` is a custom `string[]`, not `{ type: 'preset', preset:
  'claude_code' }`.** The Claude Code preset is written for a coding agent with a
  filesystem and a shell; almost none of it applies, and it is large. A purpose-
  written prompt is both cheaper and better aimed. It is passed as a three-element
  array — static half, `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, per-request half. That
  marker is the SDK's supported way to give the static prefix global cache scope,
  so the cache boundary is enforced by the SDK rather than by our ordering.
- **`effort: 'high'`.** The docs name `xhigh` as the best setting for most coding
  and agentic work and Claude Code's own default, but a league question is mostly
  retrieval and arithmetic over what the tools hand back, not deep reasoning.
  `high` is documented as the quality/token sweet spot, and wall-clock matters
  when a member is watching a ticker. It lives in `askConfig.ts` so raising it is
  a one-line change once the audit log shows questions coming back thin.
- **`thinking.display: 'summarized'`.** On Opus 5 the default is `omitted` —
  thinking blocks stream with empty text. Since the ticker exists to cover the
  stretch where the user would otherwise see nothing, and long thinking stretches
  are exactly that stretch, summaries are turned on and rendered (§6.3). Thinking
  is billed identically under every display setting, so this costs nothing.
- **`settings: { cleanupPeriodDays }`** — `cleanupPeriodDays` is a settings key,
  not a top-level `Options` field. It is passed inline through the `settings`
  option, which matters because `settingSources: []` means no settings file is
  read.
- **`strictMcpConfig: true`** so a stray `.mcp.json` on the host cannot inject
  servers.
- **No `agents`** — single agent loop, per the v1 decision.
- **`ENABLE_PROMPT_CACHING_1H` is set in `agentEnv()`, but it is not load-bearing
  on the intended auth.** The docs: *"On a Claude subscription within your plan's
  included usage, you get the 1-hour TTL on your own turns … without setting this
  variable"*, dropping to 5 minutes once drawing on usage credits. It is set
  anyway because it is the correct setting the moment `ANTHROPIC_API_KEY` is used
  instead. If 1h caching while on usage credits ever matters, `promptCacheTtl:
  '1h'` is the knob that survives them.

### 5.2 System Prompt

Assembled in `ask/systemPrompt.ts` from static and per-request parts, with the
static part first so it caches.

**Static (cached):**
- Who the bot is: the WPFL commissioner's analyst. 14-team ESPN league, $200
  auction, same owners for a decade.
- The tool map: what each source knows and — critically — what it *doesn't*. The
  WPFL API stops at 2025. The artifact is a **post-draft** report. Anything about
  the 2026 season in progress comes from ESPN or the web.
- **The grounding rule**, stated as a hard constraint:
  > Every number you state must come from a file you read or a tool result in
  > this turn. If you cannot source a number, say you don't have it. Never
  > estimate a figure and present it as league data. When the freshest source
  > you have is stale for the question asked, say so in the answer.
- **The no-contradiction rule:**
  > Never compute expected wins, optimal points, or drafted points yourself from
  > cached rows. Call `expected_wins`, `optimal_coaching`, or `drafted_points`.
  > The league already publishes these numbers through `/ewins` and `/optimal`,
  > and your figure must be the same figure.
- Output shape: Discord markdown, under ~1,500 characters where possible, and a
  final source footer naming the files and tools the answer rests on, the
  artifact's as-of date, and who the answer was written for (§7).
- Voice: direct, numerate, dry. This is a league of people who have played
  together for ten years — write like a member, not a customer service agent.

**Per-request (after the cache boundary):**
- The caller's canonical owner name and ESPN team id, so "my team" resolves
  without a clarifying round trip.
- Today's date and the current NFL week (`helpers/utils.ts:getCurrentNFLWeek`).
- The shred's as-of dates and the WPFL cache's fetch date.

### 5.3 Message Stream Handling

`runAsk()` takes `queryFn` as an injected parameter, defaulting to the SDK's
`query`, so tests substitute a fake async generator (§13).

It consumes the stream and drives two things:

| Message | Action |
| --- | --- |
| `stream_event` → `content_block_start` with `tool_use` | Push a ticker line |
| `stream_event` → `content_block_delta` / `input_json_delta` | Accumulate tool input for the ticker's detail text |
| `stream_event` → `content_block_delta` / `thinking_delta` | Replace the ticker's current reasoning line |
| `stream_event` → `content_block_delta` / `text_delta` | Append to the prose buffer |
| `assistant` | Mark the previous ticker line complete |
| `result` | Record spend, turns, `modelUsage`; finalize the message |

**`query()` throws after yielding an error result.** The docs are explicit about
this, and the original design's stream loop had no `try`/`catch` — so a
`error_max_budget_usd` run would have taken down the `/ask` handler and skipped
the ledger write that §6.4 promises. The consumption loop is wrapped, and the
ledger row is written from whatever terminal result arrived before the throw.

Cost accounting reads **`total_cost_usd`** and **`modelUsage`**, never `usage` —
the docs are explicit that `usage` excludes subagent tokens. We have no subagents
in v1, but reading the right field now means adding them later doesn't silently
under-report. Both success and error results carry cost, so the ledger is written
on **every** terminal result. Note that an `error_during_execution` after a
session crash may carry every cost field zeroed; this is one more reason the caps
in §9 count queries rather than dollars.

**Two runtime guards wrap the call** (§9):

- A module-level **semaphore** caps concurrent `query()` calls at
  `MAX_CONCURRENT_QUERIES`. Overflow queues, and the ticker shows the queue
  position so the wait is visible rather than dead air.
- A hard **wall-clock deadline** of `QUERY_TIMEOUT_MS`, enforced with an
  `AbortController`. On timeout the bot posts whatever prose has streamed, notes
  that it stopped at the time limit, and writes the ledger row. `maxBudgetUsd`
  bounds spend but not duration; without this a slow fetch chain could hold a
  semaphore slot indefinitely.

---

## 6. Discord Interaction Design

### 6.1 `/ask` Flow

```
/ask question:<string>
```

1. `ensureFresh()` — §3.5.
2. Check caps (daily per-user, monthly league-wide). A refusal is an ephemeral
   reply that says which limit was hit and when it resets.
3. `await interaction.deferReply()` — the 3-second acknowledgement.
4. **Branch on channel type.** `Message.startThread()` throws
   `MessageThreadParent` unless the channel is `GuildText` or `GuildAnnouncement`
   (`node_modules/discord.js/src/structures/Message.js:1033-1039`). So:

   | Channel | Behavior |
   | --- | --- |
   | `GuildText` / `GuildAnnouncement` | Anchor reply → `startThread` → run in the thread |
   | Already a thread, and a known ask session | **Resume that session**, run in place |
   | Already a thread, not an ask session | New session, run in place |
   | Anything else (forum post, voice-text) | New session, run in place |

   Running `/ask` inside an existing `/ask` thread is the single most likely
   misuse, and treating it as a continuation is almost certainly what the member
   meant.
5. In the thread case: `const anchor: Message = await interaction.editReply(...)`
   — a one-line pointer into the thread. **`editReply` returns a `Message`**
   (`typings/index.d.ts:664`); `fetchReply` is deprecated in 14.27.0. Then
   `anchor.startThread({ name, autoArchiveDuration: ThreadAutoArchiveDuration.OneDay })`
   (`typings/index.d.ts:2538`; duration enum `OneHour=60 | OneDay=1440 |
   ThreeDays=4320 | OneWeek=10080`). Thread name is the question, truncated to
   100 chars.
6. `const ticker: Message = await target.send(initialTicker())`.
7. Run the agent, editing `ticker` as the stream arrives.
8. Persist `thread.id → session_id` and the ledger row.

**Consequence worth naming:** after step 6 the interaction token is no longer
used. Everything else is ordinary channel messages. That sidesteps the 15-minute
interaction-token expiry entirely — a slow run cannot strand the reply — and in
the thread case gives the ticker the thread's own rate-limit bucket rather than
competing with the parent channel.

### 6.2 Thread Continuation and Session Lifetime

`index.ts`'s existing `messageCreate` handler gains a branch (the current one only
handles DMs for trivia, `index.ts:196`):

```
message is in a thread
  AND that thread.id is a known ask session
  AND author is not a bot
  → continue the session
```

- **Anyone** in the thread may continue it. Each person's message counts against
  their own daily cap.
- Continuation passes `resume: <session_id>`; the SDK reloads the transcript from
  its on-disk store.
- At `SOFT_TURN_CAP` (15) the bot appends a note that the thread is getting long
  and suggests a fresh `/ask`. At `HARD_TURN_CAP` (20) it declines further turns
  in that thread and says why.

**Sessions are deliberately short-lived.** Transcripts accumulate under
`~/.claude/projects/<cwd-slug>/` and are unbounded by default; at 1500 queries a
month that is plausibly a gigabyte, and filling the host's disk takes down the
whole bot rather than just `/ask`. So:

- `settings: { cleanupPeriodDays: 7 }` — the SDK prunes its own transcripts.
- Threads keep `ThreadAutoArchiveDuration.OneDay`.
- When a thread archives, `ask_sessions.closed` is set.
- Posting in an archived thread un-archives it in Discord. When that happens the
  bot does **not** attempt `resume` on a session it has marked closed. It starts a
  fresh session in the same thread, says in one line that the earlier context has
  aged out, and answers the question anyway. `resume` drives continuation only
  while a thread is live.

### 6.3 Ticker and Streaming

Two phases in one message, edited in place.

**Phase 1 — ticker.** While the agent works, render a checklist of what it is
actually doing: which file it opened, which query it ran and how many rows came
back, what it searched for — and, on its own dim line, the latest reasoning
summary. Tool-call lines alone leave visible dead air across long thinking
stretches, which is exactly the stretch the ticker exists to cover.

```
🤖 CommishBot
┌─ thinking
│  ✓ read INDEX.md
│  ✓ read teams/aj-boorde.json
│  … comparing his WR spend against the ten-year
│    auction curve before I call it an overpay
│  ▸ sql: 10y WR spend vs finish
└─
```

**Phase 2 — prose.** When text deltas start arriving, the ticker collapses to a
one-line summary and the answer streams in beneath it.

**Throttling.** Discord allows roughly 5 edits per 5 s per channel. Edits are
throttled to one per **1.5 s**, coalescing whatever arrived in between, with the
final state always flushed. In the thread case each thread is its own bucket, so
concurrent `/ask` threads don't contend.

**Length.** Discord's 2,000-character message limit is handled by continuing into
a follow-up message rather than truncating the answer.

### 6.4 Error Handling

| Condition | Behavior |
| --- | --- |
| No credential configured | `BotError` at startup; `/ask` replies that the bot isn't configured |
| Artifact fetch fails | Non-fatal; continue on the previous shred |
| Required body missing / reshaped | Hard error, previous shred retained, admin-visible log |
| Unknown body in artifact | `WARN`, shredded generically, flagged in `INDEX.md`, run continues |
| `error_max_budget_usd` | Post what was produced, note the budget stop |
| Wall-clock deadline hit | Post what streamed, note the time limit, suggest a narrower question |
| `query()` throws | Caught; post partial answer if any; ledger from the last terminal result |
| Queue full | Ticker shows queue position; the run proceeds when a slot frees |
| Daily cap hit | Ephemeral reply naming the limit and the reset time |
| Monthly cap hit | Ephemeral reply saying the feature is paused for the month |
| Session pruned on revival | Fresh session in the same thread, one line of explanation |

Errors route through the existing `errors/BotError.ts` and `errors/errorHandler.ts`.

---

## 7. Identity Mapping

New file `constants/wpflMembers.ts`, matching the shape of the existing
`constants/espnMembers.ts` and `constants/sleeperMembers.ts`. It is the single
join between Discord, ESPN, and the canonical WPFL owner spelling.

| ESPN id | Canonical owner | Discord |
| ---: | --- | --- |
| 1 | Nixon Ball | 286718589220945920 |
| 3 | Forrest Britton | 879541760802562049 |
| 4 | AJ Boorde | 120231673722830849 |
| 5 | Jimmy Simpson | 288481488310239234 |
| 6 | David Evans | 416887796935163904 |
| 7 | Ryan Salchert | 855256180523794442 |
| 8 | Mike Simpson | 286985052339044352 |
| 9 | Todd Ellis | 413773330034982914 |
| 10 | David Adler | 843933048915623977 |
| 11 | Neill Bullock | 543421070548664331 |
| 12 | Doug Black | 287800977808031744 |
| 13 | Rick Kocher | 472464302293516295 |
| 14 | Michael Hoyle | 213466735536373760 |
| 15 | Jonathan Mims | 1245041211002060970 |

**Verification status differs by column.** The ESPN id ↔ canonical owner half was
checked against `../draft-2026/backend/config.py:57` (`TEAM_OWNERS`) on
2026-08-31 and matches on all 14 rows. The Discord snowflakes were supplied by AJ
during the requirements interview and **cannot be verified from the dev box.**

That asymmetry matters more than it looks. A wrong snowflake means the bot
resolves "my team" to the wrong owner and then answers, confidently and in
public, about someone else's roster — and grounding cannot catch it, because
every number it cites will be correctly sourced from the wrong file. Two cheap
guards:

- **Startup resolution check.** On `ready`, resolve all 14 snowflakes against the
  guild (the `GuildMembers` intent is already enabled at `index.ts:16`) and log
  loudly for any that fail to resolve or whose display name bears no resemblance
  to the canonical owner.
- **Attribution in the footer.** Every answer names who it was written for
  ("answering as Neill Bullock, ESPN team 11"), so a mis-map surfaces on the first
  question rather than never. This also catches the case a resolution check
  cannot: two ids swapped between two real members, both of which resolve fine.

Two spellings were normalized to the canonical form when AJ supplied the
snowflakes: "michael simpson" → **Mike Simpson** (8), "dave evans" → **David
Evans** (6). draft-2026's CLAUDE.md warns specifically that ESPN member names
drift this way, so the file carries the WPFL spelling as canonical and treats
anything else as an alias.

A Discord user with no mapping is not blocked — they simply get no implicit "my
team", and the agent asks or they name a team.

---

## 8. Data Model

New migration `migrations/009_ask_agent.sql`. Three tables. Note the repo has **no
automated migration runner**; migrations are applied by hand
(`scripts/runMigration.ts` exists for this).

```sql
-- One row per /ask conversation, keyed by the channel it lives in.
CREATE TABLE ask_sessions (
  thread_id       TEXT PRIMARY KEY,          -- Discord thread or channel snowflake
  session_id      TEXT NOT NULL,             -- Agent SDK session UUID
  opener_user_id  TEXT NOT NULL,
  question        TEXT NOT NULL,
  turns           INTEGER NOT NULL DEFAULT 1,
  total_cost_usd  NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- ESTIMATE. Observability only.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed          BOOLEAN NOT NULL DEFAULT FALSE      -- set when the thread archives
);

-- One row per query() call. Drives the daily and monthly caps.
CREATE TABLE ask_usage (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  thread_id    TEXT REFERENCES ask_sessions(thread_id),
  prompt       TEXT NOT NULL,
  model        TEXT,
  num_turns    INTEGER,
  cost_usd     NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- ESTIMATE. Never gates anything.
  subtype      TEXT,                          -- success | error_max_budget_usd | ...
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ask_usage_user_day ON ask_usage (user_id, created_at DESC);
CREATE INDEX idx_ask_usage_created  ON ask_usage (created_at DESC);

-- One row per DENIED or FAILED tool call. The happy path is deliberately not
-- written here -- see the note below.
CREATE TABLE ask_tool_calls (
  id          SERIAL PRIMARY KEY,
  thread_id   TEXT,
  user_id     TEXT,
  tool_name   TEXT NOT NULL,
  tool_input  JSONB,
  denied_by   TEXT,        -- 'path_guard' | 'domain_guard'; NULL when it failed rather than was denied
  error       TEXT,        -- the tool's own error, when there was one
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ask_tool_calls_thread ON ask_tool_calls (thread_id, created_at);
```

The caps count rows in `ask_usage`, never sum `cost_usd`. Both cost columns are
labelled as estimates in the DDL so nobody downstream mistakes them for billing
data.

**`ask_tool_calls` records exceptions only.** The original design wrote one row
per tool call, for debugging: when someone says *"the bot told me something
wrong,"* you could see which file was read and which query was run. But the
ticker already shows exactly that — every file opened and every query run — in
the thread, in public, permanently, and in a form a league member can read
without database access. Writing it a second time cost a Postgres round trip
inside the agent loop and roughly 90,000 rows a year to duplicate something
better.

What the ticker cannot give us is the two things this table now holds: a durable
record of every **denial** (the security audit trail, which by design never
reaches the answer) and every tool **failure**. `denied_by` is also what makes
`WEBFETCH_ALLOWED_HOSTS` evidence-driven — it records which hosts members
actually paste, so the list grows from data instead of guesswork. In normal
operation this table stays close to empty, which is the point: a row in it is a
signal, not a log line.

---

## 9. Limits and Accounting

```ts
// ask/askConfig.ts
export const ASK = {
  DAILY_QUESTIONS_PER_USER: 20,
  MONTHLY_QUERIES_TOTAL: 1500,       // league-wide, ~50/day across 14 members
  MAX_BUDGET_USD: 1.00,              // per query; SDK-enforced, stops a runaway loop
  MAX_CONCURRENT_QUERIES: 2,
  QUERY_TIMEOUT_MS: 4 * 60 * 1000,
  SOFT_TURN_CAP: 15,
  HARD_TURN_CAP: 20,
  SESSION_RETENTION_DAYS: 7,
  STALE_AFTER_MS: 6 * 60 * 60 * 1000,
  TICKER_EDIT_THROTTLE_MS: 1500,
  THREAD_AUTO_ARCHIVE: ThreadAutoArchiveDuration.OneDay,
  DATA_DIR: process.env.WPFL_DATA_DIR ?? `${homedir()}/wpfl-data`,
  ARTIFACT_URL: 'https://wpfl-receipts-694ed0.pages.dev/postdraft.json',
  WEBFETCH_ALLOWED_HOSTS: [ /* §10.4 */ ],
} as const;
```

**Why counts and not dollars.** The original design had a `MONTHLY_CEILING_USD` of
150. Three things are wrong with a dollar ceiling here: on subscription auth there
is no bill for it to approximate; the docs explicitly say not to trigger decisions
from `total_cost_usd`; and an `error_during_execution` after a crash can arrive
with every cost field zeroed, so the ledger would systematically under-count the
runs that ran longest before dying. A query count cannot be zeroed and does not
drift with a bundled price table. `total_cost_usd` and `modelUsage` are still
recorded on every terminal result — as an observability signal, and because they
become meaningful immediately if the auth ever moves to `ANTHROPIC_API_KEY`.

Deliberately generous. A new feature dies if the first week feels rationed, and
the control that actually matters is `MAX_BUDGET_USD` — it stops one pathological
loop. Everything here is tunable in one file once the audit log shows real usage.

**Cost expectation, estimated not measured:** ~15–25K input and 2–3K output per
question, which at Opus 5 list rates would be roughly **$0.13–0.16**. On the Max
key this is a consumption proxy rather than a bill. The real thing to watch is
whether the bot's draw competes with AJ's own Claude Code work on a busy Sunday —
which is also what `MAX_CONCURRENT_QUERIES` is for.

---

## 10. Security

The genuinely load-bearing protections came from earlier decisions, not from
bolted-on controls: **no shell, no writes, `cwd` on the data dir instead of the
repo, and a data dir that holds material already published on the open internet.**
The classic exfiltration story mostly doesn't apply because there is little in
reach worth stealing.

What remains is narrow, and the adversarial review found one real gap in it (the
Grep hole, §4.1) plus one control that was tighter than the threat justified (the
blanket WebFetch refusal, §10.4).

### 10.1 Minimal Subprocess Environment

`{...process.env}` would hand the Claude Code subprocess `DISCORD_TOKEN`,
`POSTGRES_*`, `ESPN_S2`, and `SWID`. Claude has no shell so it cannot read them,
but there is no reason for them to be in that process at all — and a future change
that *does* add a shell would otherwise quietly become a credential leak.

```ts
// ask/askAuth.ts
export function agentEnv(): Record<string, string> {
  const cred: Record<string, string> = process.env.ANTHROPIC_API_KEY
    ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    : { CLAUDE_CODE_OAUTH_TOKEN: required('CLAUDE_CODE_OAUTH_TOKEN') };
  return {
    PATH: required('PATH'),
    HOME: required('HOME'),
    ENABLE_PROMPT_CACHING_1H: '1',
    ...cred,
  };
}
```

Note this bounds what is *in* the process, not what can be *read from disk* —
which is what §10.2 is for.

### 10.2 `PreToolUse` Path Confinement

The control that closes the Grep hole. On every `Read`, `Grep`, and `Glob` call,
the hook resolves the path argument with `realpath` (so symlinks cannot escape)
and denies anything that does not sit under `ASK.DATA_DIR`:

```ts
return {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'I can only read the WPFL data directory.',
  },
};
```

This is the guarantee rather than the `Read(//DATA_DIR/**)` allow rule, because
the docs describe `Read` rules as covering Grep and Glob only on a *"best-effort"*
basis, and because `Grep(path)` and `Glob(path)` rules are documented as accepted
but never consulted. Hooks run before every other permission step and a hook deny
holds even in `bypassPermissions`, so this cannot be bypassed by a configuration
mistake elsewhere. Every denial is recorded in `ask_tool_calls.denied_by`.

### 10.3 `PostToolUse` Audit

Writes an `ask_tool_calls` row **only when a call was denied or failed** (§8). A
successful read of a file the agent was allowed to read is not an event worth
recording — the ticker already showed it to the whole thread. Non-blocking: a
failed audit write logs and continues rather than killing the answer.

### 10.4 `PreToolUse` Domain Guard on `WebFetch`

The original design denied `WebFetch` for any URL that came from a user's message.
Reviewed adversarially, that trade is upside-down: the threat it defends against
is one this design itself rates as *"the bot saying something stupid in a private
league's Discord"*, while the behavior it blocks — a member pasting a beat-writer
link and asking "what do you make of this?" — is among the most natural things
anyone will do with the feature.

So the guard is a **host allowlist** rather than a blanket refusal. A pasted URL
whose host is on `ASK.WEBFETCH_ALLOWED_HOSTS` (espn.com, nfl.com, theathletic.com,
rotowire.com, pff.com, fantasypros.com, the major beat outlets, plus
`wpflapi.azurewebsites.net` and the artifact host) is fetched. Anything else is
denied, with the refusal text written to be relayed to the member:

```ts
permissionDecisionReason:
  "I don't open links from hosts I don't know. Tell me what you want to know and I'll look it up.",
```

`WebSearch` is unaffected — its results are summarized before entering context.
Denials are logged with `denied_by = 'domain_guard'`, so the allowlist can grow
from evidence about what people actually paste.

---

## 11. File Structure

```
ask/
  askConfig.ts          all tuning constants, incl. model / effort / thinking (§9)
  askAuth.ts            swappable credential resolution + minimal subprocess env (§10.1)
  askDb.ts              ask_sessions / ask_usage / ask_tool_calls
  askRunner.ts          query() invocation + message-stream consumption
  concurrency.ts        semaphore + wall-clock deadline (§5.3)
  systemPrompt.ts       static + per-request prompt assembly
  ticker.ts             ticker state machine + Discord render
  caps.ts               daily cap, monthly cap, turn caps
  hooks.ts              PreToolUse path guard, PreToolUse WebFetch guard, PostToolUse audit

wpfl/
  artifactSync.ts       fetch, etag check, atomic swap
  shredder.ts           BODY_PLANS, DEAD_KEYS, tolerant-and-loud shred
  indexGenerator.ts     INDEX.md, including the glossary constants (§3.4)
  historyCache.ts       the cached WPFL decade (§3.7)
  sqlTool.ts            in-memory DuckDB + statement guard
  wpflApiTools.ts       the three computed-aggregate endpoints
  espnTools.ts          ESPN 2026 live — four tools (§4.2)
  mcpServer.ts          createSdkMcpServer wiring all of the above

constants/
  wpflMembers.ts        NEW — Discord ↔ ESPN id ↔ canonical owner

discordCommands/ask/
  ask.ts                the slash command (folder name must match file name)

migrations/
  009_ask_agent.sql

scripts/
  makeAskFixtures.ts    NEW — regenerates the trimmed fixtures (§13.2)

tests/
  ask/shredder.test.ts       ask/caps.test.ts        ask/ticker.test.ts
  ask/systemPrompt.test.ts   ask/hooks.test.ts       ask/concurrency.test.ts
  ask/askAuth.test.ts
  services/askRunner.test.ts
  wpfl/sqlTool.test.ts       wpfl/indexGenerator.test.ts
  wpfl/historyCache.test.ts  wpfl/shredder.test.ts
  wpfl/artifactSync.test.ts  wpfl/artifactShape.test.ts   (live; skipped in CI)
  fixtures/postdraft-published.json   ~30 KB, generated
  fixtures/postdraft-next.json        ~30 KB, generated
```

**17 source files, not 20.** Two directories collapsed into one during the
build-readiness review, for the same reason in both cases — a directory that
existed for symmetry rather than for its contents:

- **`llm/` is gone.** `modelConfig.ts` was three constants that belong in
  `askConfig.ts`, which §1's sixth principle already says is where tuning lives;
  splitting them meant two files to open to answer "what model does this run."
  `auth.ts` became `ask/askAuth.ts`, matching how `economy/`, `trivia/` and
  `wordle/` each keep their own concerns in one feature directory.
- **`wpfl/glossary.ts` folded into `indexGenerator.ts`.** The glossary has exactly
  one consumer, `INDEX.md`, and it is generated in the same pass. A module with
  one caller and no independent behaviour is a section of that caller.

`discordCommands/ask/ask.ts` follows the loader rule documented in `CLAUDE.md`:
both `index.ts` and `deploy-commands.ts` import **only** the file whose basename
matches its folder (`index.ts:78`), which is why the helper modules live outside
`discordCommands/`.

---

## 12. Configuration

New environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | one of | Max-plan credential (`claude setup-token`) |
| `ANTHROPIC_API_KEY` | one of | Metered API key; takes precedence if set |
| `WPFL_DATA_DIR` | no | Overrides `$HOME/wpfl-data` |

Dependency changes:

| Package | Change | Purpose |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | add, `0.3.252` | The agent runtime |
| `@duckdb/node-api` | add, `1.5.5-r.4` | Read-only SQL over the shred + cache |
| `zod` | add | Tool input schemas for `tool()` |
| `espn-fantasy-football-api` | **changed** `2.0.1` → fork `@591ee59` | `getRecentActivity`; also fixed `/activity` (§4.2). Done and verified |

`.env.sample` and `README.md` both need updating. `CLAUDE.md`'s claim that the
fork is already in use becomes true once the dependency change lands.

---

## 13. Testing Strategy — TDD

### 13.1 The Contract

**Red, then green, then refactor.** Every module in the mandatory list below is
written test-first: a failing test that expresses one behaviour, then the smallest
change that makes it pass, then cleanup with the test still green. This is not
ceremony for its own sake. Two things make it load-bearing here:

1. **It is how a long build stays honest.** This feature is ~17 modules across six
   branches, plausibly more than one context window. A green suite plus
   `git log --oneline main..feat/ask` is a state description that cannot drift
   from reality, which is why §17 makes the suite the merge gate and the log the
   only progress file.
2. **Most of this code is pure.** The shredder, the index generator, the caps, the
   SQL guard, the hooks, the ticker, the semaphore and the prompt assembler are
   all input-in / output-out. Their tests are cheap to write first and expensive
   to retrofit.

Two standing rules, and neither has an exception:

> **A failing test is never deleted, weakened, skipped, or made to pass by
> special-casing its inputs.** If a test is wrong, say so explicitly and fix the
> test as its own change with its own reasoning — never silently, and never as a
> side effect of making the build green.

> **Implement the general behaviour, not the assertion.** Tests verify
> correctness; they do not define the solution. Code that satisfies the fixture
> and nothing else has failed even when the suite is green.

### 13.2 Fixtures

The shredder cannot be written test-first without a fixture, so the fixture comes
first — and it is generated, not hand-written, because a hand-written fixture
encodes what this document *claims* the artifact looks like, which is exactly how
the first draft of this design went wrong (§3.1a).

`scripts/makeAskFixtures.ts` reads the published artifact and the local
`postdraft_2026.json`, and emits two fixtures that preserve **every key and
every container type** while truncating collections to 3 entries. Measured at
**76 KB and 86 KB** — larger than the ~30 KB this document estimated before the
generator existed, because they are formatted rather than minified so a shape
change is legible in a diff, and because a team object is 7 KB of real
structure. Still an eighth of the repo's largest tracked file:

| Fixture | Source | Represents |
| --- | --- | --- |
| `postdraft-published.json` | the live URL | today's shape: `available`, the four `DEAD_KEYS`, no `market` |
| `postdraft-next.json` | draft-2026's local build | the shape after the next publish: `market`, `night.acts`, no dead keys |

Every assertion in §13.3 holds at this size — `available` ignored, `DEAD_KEYS`
skipped, unknown body flagged rather than fatal, missing required body fatal,
`.jsonl` line counts, `INDEX.md` contents. Verified at generation time: the
published fixture's key set is identical to the live artifact's at every level,
and the next fixture's is identical to draft-2026's local build plus the
`available` wrapper `deploy.sh` adds. The remaining 1.7 MB of the real files is
repetition of shapes already covered, and committing it would make these the two
largest files in the repo by a wide margin (the current record holder is
`data/WPFLHistoryCondensed.xlsx` at 685 KB).

The generator is committed so the fixtures can be regenerated when draft-2026's
shape moves, and one test guards against them silently going stale:

**`tests/wpfl/artifactShape.test.ts`** fetches the live artifact and asserts its
key set still matches `postdraft-published.json`'s. It is `describe.skip`-ed so
`npm test` stays offline and deterministic, and is run by hand when the artifact
is republished. Drift then surfaces as a deliberate check rather than never.

### 13.3 What Gets Tested, and How

**Mandatory red-green-refactor:**

| Module | First failing test asserts |
| --- | --- |
| `shredder` | `available` is ignored; each `DEAD_KEY` skipped; a known body lands in its planned layout; `.jsonl` line counts; an unknown body is shredded generically and flagged, **not** thrown; a missing required body throws; a required body with the wrong container type throws |
| `indexGenerator` | Every file it lists exists on disk; as-of dates and etag present; undocumented bodies called out; glossary terms present; the 14 canonical owners listed |
| `historyCache` | JSONL line counts per source; a failed season fetch leaves the previous cache intact and reports which season failed |
| `sqlTool` (guard) | Table of statements that must be rejected — `COPY`, `ATTACH`, `INSTALL`, `PRAGMA`, `SET`, multi-statement, non-`SELECT` — and the row cap and truncation notice |
| `hooks` (path) | Paths inside `DATA_DIR` allowed; `..` traversal, absolute escapes, and a symlink pointing out all denied; the deny carries the refusal text |
| `hooks` (WebFetch) | On-allowlist host passes; off-allowlist denies with the member-facing refusal text; the denial is recorded with `denied_by` |
| `caps` | Daily rollover at the boundary; monthly boundary; soft cap at 15 and hard cap at 20, tested at 14/15/16 and 19/20/21 |
| `concurrency` | Semaphore admits exactly `MAX_CONCURRENT_QUERIES` and queues the rest with a position; the deadline aborts and the ledger row is still written |
| `ticker` | A scripted stream including `thinking_delta` renders the expected lines; edits coalesce under the 1.5 s throttle; the final state always flushes |
| `systemPrompt` | The static prefix is byte-identical across calls (cache correctness); per-request suffix carries owner, ESPN id, NFL week and as-of dates |
| `askAuth` | Prefers `ANTHROPIC_API_KEY`; falls back to `CLAUDE_CODE_OAUTH_TOKEN`; throws with neither; `agentEnv()` contains no `DISCORD_*`, `POSTGRES_*`, `ESPN_S2` or `SWID` |
| `askRunner` | With an injected fake `query()`: ticker output, ledger write, cost read from `total_cost_usd`/`modelUsage`, and **a generator that throws after an error result still writes the ledger row** |

**Named carve-outs — fixture first, then test, then code.** For these the
interface cannot honestly be designed before the payload shape is known, so a
real response is recorded first and the test is written against the recording.
Red-green still applies from that point; only the ordering of the first step
differs:

| Module | Why | Recorded from |
| --- | --- | --- |
| `wpflApiTools` (3 tools) | Server-computed aggregates whose row shape is the API's, not ours | one live call per endpoint |
| `espnTools` (4 tools) | The fork's return shapes are not documented anywhere; §4.2's blank-team-name finding came only from reading one | one live call per method |
| `discordCommands/ask/ask.ts` | Channel routing branches on discord.js runtime types; the repo has no precedent for mocking `Message`/`ThreadChannel` | hand-built minimal stubs, one per branch of §6.1's table |

`ask.ts`'s carve-out covers the routing table only — text channel → thread, thread
with a known session → resume, thread without → new in place, forum → new in
place. The logic it calls is all in the mandatory list above.

**No live calls in CI**, per the existing convention (`tests/standings.test.js`
injects an ESPN client; `discordCommands/ewins/ewins.ts:29` injects `fetchFn`).
Live verification happens in the phase gates (§14), not in `npm test`.

```ts
// tests/services/askRunner.test.ts — the shape that must exist before askRunner does
const fakeQuery = async function* (): AsyncGenerator<SDKMessage> {
  yield { type: 'stream_event', event: { type: 'content_block_start',
    content_block: { type: 'tool_use', name: 'Read' } } } as SDKMessage;
  yield { type: 'assistant', message: { id: 'm1', content: [] } } as SDKMessage;
  yield { type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 1.01,
    num_turns: 9, modelUsage: {} } as SDKMessage;
  throw new Error('budget exceeded');   // the SDK throws after an error result
};
```

### 13.4 Conventions

Follow what the repo already does rather than inventing a third idiom:

- **Dependency injection where the seam is a parameter** — `tests/standings.test.js`
  passes a fake ESPN client into `getStandings`. `askRunner` takes `queryFn` the
  same way.
- **`jest.unstable_mockModule` + dynamic import where the seam is a module** —
  `tests/services/achievementService.test.ts` mocks `achievementDb` and
  `economyDb` this way. `askDb` is mocked identically; **no test touches the real
  Postgres**, and there is no separate test database on this box.
- Explicit types on every parameter, variable and return, per `CLAUDE.md`.
- `npm test` runs `NODE_OPTIONS='--experimental-vm-modules' jest`; tests live under
  `tests/` and match `*.test.ts`.

---

## 14. Implementation Phases and Branches

All phases ship together — one launch, one deploy. The ordering below is the
**dependency graph**, not a preference: after scaffolding it genuinely forks three
ways, and those three are the only slices that can be built concurrently.

```
main
 └── feat/ask ──────────────────────────────────────────────────────────┐
      │  Phase 0 committed directly (everything depends on it)          │
      ├── feat/ask-data ────────┐                                       │
      ├── feat/ask-persistence ─┤ independent; depend only on Phase 0   │
      ├── feat/ask-tools ───────┘                                       │
      ├── feat/ask-sql ──────── needs data (reads the shred + cache)    │
      ├── feat/ask-runner ───── needs tools + persistence               │
      ├── feat/ask-discord ──── needs runner                            │
      └── Phase 6 committed directly                            handoff ┘
```

Merge mechanics, the green gate and the autonomy boundary are in §17.

**Phase 0 — Scaffolding.** *On `feat/ask` directly.* Dependencies, plus
`ask/askConfig.ts`, `ask/askAuth.ts`, `constants/wpflMembers.ts`. A branch here
would only add a merge, since every later slice depends on all of it.
Verify: `npm run typecheck` and `npm run lint` clean; `agentEnv()` throws with no
credential and leaks no other secret. **The ESPN fork swap is already done and
verified** (§4.2): pinned at `591ee59`, 450 tests passing, and `/standings`,
`/median`, `/trophies`, `/closestscores` and `/activity` all re-run against the
live league.

**Phase 1 — Data layer.** *`feat/ask-data`.* `scripts/makeAskFixtures.ts` and both
fixtures **first**, then `artifactSync.ts`, `shredder.ts`, `indexGenerator.ts`,
`historyCache.ts`. Verify: both fixtures shred; a mutated fixture missing a
required body throws and one with an unknown body does not; a **real fetch**
produces the §3.3 layout against the currently published artifact; the real WPFL
cache builds (~38,000 rows, ~15 s).

**Phase 2 — Persistence.** *`feat/ask-persistence`.* `migrations/009_ask_agent.sql`,
`ask/askDb.ts`, `ask/caps.ts`. Verify: cap boundaries behave at the edges against a
mocked `askDb`; the migration parses. **The migration is not applied** — that is
AJ's, per §17.

**Phase 3 — Tools (API).** *`feat/ask-tools`.* `wpfl/wpflApiTools.ts`,
`wpfl/espnTools.ts`. Verify: the three aggregate endpoints return typed rows
matching their recordings; all four ESPN tools return 2026 data through the fork.

**Phase 4 — SQL and MCP.** *`feat/ask-sql`.* `wpfl/sqlTool.ts`, `wpfl/mcpServer.ts`.
Verify: the statement guard rejects everything in its table; a cross-source join
across the artifact and the decade returns sane rows; the eight tools register
with the three `alwaysLoad` schemas. **This is where the DuckDB lockdown
semantics (§15.4) resolve** — confirm the setting names against the installed
version, and if they do not exist, say so and rely on the statement guard.

**Phase 5 — Runner.** *`feat/ask-runner`.* `ask/systemPrompt.ts`,
`ask/askRunner.ts`, `ask/concurrency.ts`, `ask/hooks.ts`. Verify: a scripted
stream produces the expected ticker and ledger row; a throwing generator still
writes the ledger; the path hook denies an escape attempt, including via symlink.
**Whether `Read(//DATA_DIR/**)` alone blocks a Grep escape resolves here**
(§15.5) — measure it and record which control is actually load-bearing.

**Phase 6 — Discord surface.** *`feat/ask-discord`.* `discordCommands/ask/ask.ts`,
thread creation and the non-thread fallback, the `messageCreate` continuation
branch in `index.ts`, the startup identity check, ticker rendering and throttling.
Verify: each branch of §6.1's routing table against stubs. End-to-end in a guild
is AJ's, per §17.

**Phase 7 — Integration and handoff.** *On `feat/ask` directly.* `.env.sample`,
`README.md`, `CLAUDE.md` command count, the final full-suite run, and the handoff
report. If a Claude credential is present, the capped live smoke test from §17
runs here and its measured cost is recorded in the log; if not, that is recorded
as skipped.

---

## 15. Open Risks and Unverified Assumptions

Listed explicitly because several are things this design **could not check from
the dev box**.

### 15.1 The auth question
The documented restriction on subscription credentials in third-party products
(§2) is unresolved. The code stays agnostic; the decision lives in one env var on
the host. Unchanged by this review.

### 15.2 The ESPN fork's age — RESOLVED 2026-08-31
The fork is version 0.16.1, based on an older upstream than 2.0.1, and ESPN had
indeed moved under it: `getRecentActivity` was broken by a retired host. Fixed at
fork commit `591ee59` and pinned by SHA. All four methods verified against the
live 2026 league, and all five ESPN-backed commands re-run clean (§4.2). Two
residual constraints — current-season-only transactions and blank team names —
are documented in §4.2 rather than carried as risks.

One note for whoever rebuilds the fork next: `npm run build` requires
`NODE_OPTIONS=--openssl-legacy-provider` on Node 17+, because webpack 4's Terser
uses an MD4 hash OpenSSL 3 rejects. This affects rebuilding only — consumers
install the committed bundles.

### 15.3 `npm install` must keep optional dependencies
Both the Agent SDK and DuckDB ship their native binaries as npm **optional**
dependencies. An install run with `--omit=optional` produces a bot that fails at
runtime with `Native CLI binary for <platform>-<arch> not found`.
`scripts/deploy.sh` currently uses plain `npm install`, which is correct — this is
a note not to change it. This absorbed the original §15.2 (DuckDB prebuilds on
Node 20.15.1), which dissolved: the bindings are Node-API and ABI-stable across
Node majors.

### 15.4 DuckDB lockdown semantics — RESOLVED 2026-08-31
Both settings exist in 1.5.5-r.4, both can be set at runtime after materializing,
and both behave as §4.3 assumed. With `enable_external_access=false` and
`lock_configuration=true`, agent SQL cannot read a file, glob, `COPY`, `ATTACH`,
`INSTALL`, `LOAD`, or turn either setting back on, and the lockdown covers every
connection on the instance — verified including a refused read of the bot's own
`.env`.

One correction: the statement guard is **not** "belt-and-braces on top of" this.
DuckDB executes every statement it is handed — `SELECT 1; DELETE FROM t` deletes
— and dropping an in-memory table is not external access, so the lockdown does
not cover it. The one-statement rule is the only control there. Log Stage 8.

### 15.5 `Read` rule coverage of Grep and Glob — OPEN, and not measurable here
The docs describe it as "best-effort", which is why the `PreToolUse` path hook
(§10.2) is the guarantee. Phase 5 was to measure whether the allow rule alone
also blocks an escape. **It could not be**: answering it needs a live `query()`
in which the model actually attempts a Grep outside the data directory, and
there is no Claude credential on this box (§15.12).

What is settled: the hook denies every escape vector — absolute path, `..`
traversal, relative climb, `Grep` and `Glob` paths outside, and a symlink inside
the directory pointing out of it — asserted in CI; and a `PreToolUse` deny is
documented to hold even in `bypassPermissions`. So the hook is load-bearing
either way. What is unknown is only whether the allow rule is additionally
redundant. Blocked on the same credential as §15.12.

### 15.6 The SDK does not read `.env`
Documented explicitly: *"The SDK reads the key from the environment of the process
that runs your agent; it doesn't load `.env` files automatically."* `index.ts`
already does `import 'dotenv/config'` at line 1, so the variables are present by
the time `query()` runs — but `agentEnv()` reads `process.env`, not the file, and
that ordering must hold.

### 15.7 Session storage growth
Addressed by `cleanupPeriodDays: 7` (§6.2), but the actual per-session transcript
size is **unmeasured**. Worth checking the directory once after a week of real
use.

### 15.8 Discord permissions
The bot needs **Create Public Threads** and **Send Messages in Threads** wherever
`/ask` is used. `MessageContent`, `GuildMessages`, `GuildMembers`, and `Guilds`
intents are already enabled (`index.ts:12–18`). The non-thread fallback (§6.1)
means a missing thread permission degrades rather than breaks — but it should
still be checked.

### 15.9 ESPN tools are being built against an empty season
It is 2026-08-31; kickoff is roughly ten days out. ESPN has rosters, a schedule,
and free agents, but every team is 0-0 and no game has been played. `espn_boxscores`
and `espn_teams` will be written and tested against data that does not
represent their real shape. First real verification is week 1.

### 15.10 The 2026 data gap
Until kickoff, the WPFL API returns `[]` for 2026, the artifact is a frozen
post-draft report, and ESPN has no results. **The web is the only source of
current events on launch day.** Handled honestly rather than hidden: `INDEX.md`,
the system prompt, and every answer footer state the as-of dates, and the
grounding rule requires the agent to say when its freshest source is stale for the
question asked.

### 15.11 Per-question cost is estimated, never measured
$0.13–0.16 is arithmetic, not observation, and on the Max key it is a proxy for
nothing billable. Resolves in Phase 7 **only if a credential is present** (see
§15.12) and then continuously through `ask_usage`.

### 15.12 No Claude credential exists on the dev box
Checked 2026-08-31: `.env` carries `DISCORD_TOKEN`, `ESPN_S2`, `SWID`,
`LEAGUE_ID`, `POSTGRES_*`, `FINNHUB_API_KEY` and the rest — but **neither
`ANTHROPIC_API_KEY` nor `CLAUDE_CODE_OAUTH_TOKEN`**. So the build cannot make a
real `query()` call unless AJ provisions one first.

The consequence is deliberate and non-blocking: the runner is fully covered by
the injected fake (§13.3), so the build never waits on this. Phase 7 checks for a
credential; if one is there it runs at most three `maxBudgetUsd`-capped smoke
queries and records the measured cost, which is what closes §15.11 and gives the
first real evidence that the permission config, the hooks and the MCP wiring work
together. If not, it records "skipped, no credential" and hands off — and the
first real execution of the Agent SDK integration is AJ's.

---

## 16. Appendix: Measurements

All taken 2026-08-31 on the dev box. Everything in this table was measured, not
recalled; several entries corrected the first draft of this document.

| Fact | Value | How |
| --- | --- | --- |
| Published artifact | 935,568 B on the wire, 862,867 B compact | `curl` + `json.dumps` |
| Published artifact newlines | **0** | `wc -l` |
| Whole-file read | ~216,000 tokens | bytes / 4 |
| Published vs local: top-level | pub-only `available`; loc-only `market` (35,622 B, 9 keys) | key-set diff |
| Published vs local: `league` | pub-only `grade_board`, `ridgeline`, `season_intro` | key-set diff |
| Published vs local: `night` | pub-only `clock`; loc-only `acts` | key-set diff |
| `meta`, `teams`, `news`, `history` | byte-identical across both builds | `json.dumps(sort_keys=True)` |
| `meta.generated` | **identical** (`2026-08-28 21:20`) across both builds | direct read |
| `league.dossiers` | 209,548 B, 196 entries | Python inspection |
| `news.players` | 180,933 B, 182 entries | Python inspection |
| `teams` | 119,535 B, 14 entries, ~8,538 B each | Python inspection |
| draft-2026 `DEAD_KEYS` | exactly the 4 pub-only keys above | `backend/analysis/artifact.py` |
| WPFL API 2026 | `[]` on every endpoint | `curl` |
| WPFL API 2025 | populated, weeks 1–14 | `curl` |
| `draft/history` 2010–2025 | 3,130 rows, 695,718 B | `curl` |
| `fantasyMatchupWinners` 2010–2025 | 1,449 rows, 330,731 B | `curl` |
| `playerscores` 2024 full season | 3,471 rows, 903,890 B, 1.28 s | `curl` + `time` |
| `expectedwins` is a computed aggregate | 3.92 (wk 1–5) / 9.06 (reg) / 10.67 (playoffs) | `curl`, AJ Boorde 2024 |
| `optimalcoaching` is a computed aggregate | 660.38 (wk 5) vs 2180.72 (full) optimal | `curl`, AJ Boorde 2024 |
| ESPN 2026 reachable | 14 teams at 0-0, wk-1 matchups, rosters with `injuryStatus` | `getTeamsAtWeek`, `getBoxscoreForWeek` |
| ESPN 2026 free agents | 837, with `percentOwned` / `auctionValueAverage` | `getFreeAgents` |
| Installed ESPN package | was **upstream 2.0.1**; now fork `@591ee59` | `package-lock.json` |
| Fork as-shipped `getRecentActivity` | **broken** — `Cannot read properties of undefined` | live probe |
| Retired ESPN host | `fantasy.espn.com` → 302 → `www.espn.com/fantasy/` (13 B) | `curl` |
| Working ESPN host | `lm-api-reads.fantasy.espn.com` → 200, 16 topics | `curl` |
| Stale hosts in fork source | 4, at `src/client/client.js:234,335,357,377` | grep |
| Fork after fix (`591ee59`) | all 4 methods PASS on 2026; 197/197 unit tests | live probe |
| ESPN `/communication` lifecycle | 2024 → 404, 2025 → 404, 2026 → 200 | `curl` |
| Fork `team.name` | `" "` (upstream returns real names); no `ownerName` | side-by-side |
| Standings fields fork vs upstream | **byte-identical** (W/L/T, finalPos, seed, PF) | side-by-side |
| Fork build on Node 17+ | needs `NODE_OPTIONS=--openssl-legacy-provider` | webpack 4 Terser MD4 |
| npm install without ssh | **succeeds** — pacote falls back to https | `GIT_SSH_COMMAND=/bin/false` |
| Bot after swap | typecheck 0, lint 0, 450/450 tests, 5 ESPN commands OK | `npm run` |
| Upstream 2.0.1 `getRecentActivity` | **absent** — `/activity` is broken today | method enumeration |
| Fork version / method | 0.16.1, `getRecentActivity` at `src/client/client.js:320` | shallow clone |
| ESPN methods used repo-wide | 4: `getRecentActivity`, `getBoxscoreForWeek`, `getTeamsAtWeek` | grep |
| discord.js | 14.27.0 | `package.json` |
| `editReply` returns | `Promise<Message<...>>` | `typings/index.d.ts:664` |
| `startThread` | `Promise<PublicThreadChannel<false>>` | `typings/index.d.ts:2538` |
| `startThread` guard | throws unless `GuildText` / `GuildAnnouncement` | `src/structures/Message.js:1033` |
| `ThreadAutoArchiveDuration` | 60 / 1440 / 4320 / 10080 | runtime enum dump |
| `@anthropic-ai/claude-agent-sdk` | 0.3.252; native binary via 8 optional platform packages | `npm view` |
| `@duckdb/node-api` | 1.5.5-r.4; bindings via 8 optional platform packages (Node-API) | `npm view` |
| Bot host | separate machine | no `pm2`, no `~/discord-bot` on dev box |
| Deploy | `git pull` + `npm install` + `pm2 restart` | `scripts/deploy.sh` |
| Canonical owners | 14, ids match `espnMembers.ts` | `../draft-2026/backend/config.py:57` |
| Claude credential in `.env` | **absent** — no `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN` | key-name scan |
| Largest tracked file in repo | 685 KB (`data/WPFLHistoryCondensed.xlsx`) | `git ls-files` + `du` |
| `tests/fixtures/` today | does not exist | `git ls-files` |
| Repo merge style, historically | `--no-ff` merge commits (`Merge branch 'feature/…'`) | `git log --merges` |
| Repo branch prefixes, historically | `feature/`, `bugfix/`, `hotfix/`, `fix/`, `chore/` | `git branch -a` |
| Jest | 29.7.0, ESM via `--experimental-vm-modules`; no coverage threshold | `jest.config.js` |
| Test seams in use | param DI (`standings.test.js`), `unstable_mockModule` (`achievementService.test.ts`) | source read |
| Node / npm on dev box | v24.14.1 / 11.11.0 | `node -v`, `npm -v` |
| Artifact etag, `curl -sI` | `"75c67b38…"` — strong | `curl` |
| Artifact etag, Node `fetch` | `W/"75c67b38…"` — weak, on HEAD *and* GET | `fetch` |
| Real shred of the published artifact | 53 files, 844,151 B, 5 ms | `shred()` |
| Team file sizes | 8,029–9,362 B (14 files) | shred output |
| `grep` one player in `dossiers.jsonl` | 1,079 B line (vs 935 KB whole file) | shred output |
| Generated `INDEX.md` | 11,196 B, ~2,800 tokens | `generateIndex()` |
| Fixtures | 76 KB published / 86 KB next, formatted | `makeAskFixtures.ts` |
| Real WPFL cache build | 40,261 rows, 9,325,799 B, 8–12 s | `refreshWpflCache()` |
| `draft_history` seasons present | 2010–2025 (2026 empty) | cache build |
| `player_scores` rows | 35,682, seasons 2015–2025 | cache build |
| Cold `ensureFresh()` | 8.0 s, 53 files | live run |
| Stale `ensureFresh()`, etag unchanged | 0.16 s | live run |
| `mkt` in either artifact build | **0 occurrences**; the field is `market` | key count |

---

## 17. Git Workflow and Handoff

### 17.1 Branches

`feat/ask` is cut from `main` and is the integration branch; nothing in this work
touches `main`. Slices are cut from `feat/ask` and merge back into it, named with
the `feat/ask-` prefix: `feat/ask-data`, `feat/ask-persistence`, `feat/ask-tools`,
`feat/ask-sql`, `feat/ask-runner`, `feat/ask-discord` (§14).

The first commit on `feat/ask` is this document, the log, and `plan-docs/prompt.md`
— `docs(ask): design, log and build prompt`. They must be tracked: the log is the
build's only progress file (§17.4), and log entries are commits.

### 17.2 The green gate

No slice merges unless all three are clean, run in this order:

```
npm run typecheck     # tsc --noEmit, exit 0
npm run lint          # eslint ., exit 0
npm test              # jest, 0 failures — and the count has gone UP
```

The baseline is **450 tests across 16 suites** on `main` at `eb32b4d`. A merge
that leaves the count flat means the slice shipped untested code; a merge that
lowers it means a test was removed, which §13.1 forbids.

Check the exit codes directly. Do not pipe the command into `head`/`tail` and read
`$?` — that reports the pager's status, not the build's. This was a real failure
during Stage 2 and it produced a confident false "EXIT=0" on a build that had in
fact failed.

### 17.3 Merging

```bash
git checkout feat/ask
git merge --no-ff feat/ask-data -m "Merge branch 'feat/ask-data' into feat/ask"
git branch -d feat/ask-data
```

`--no-ff` because this repo's own history merges branches that way
(`Merge branch 'feature/trivia-improvements'`), and because each log entry cites
its merge commit — a fast-forward would leave those citations pointing at nothing.
Commits follow the repo's conventional style with a scope: `feat(ask): …`,
`test(ask): …`, `fix(ask): …`, `docs(ask): …`, `chore(ask): …`.

### 17.4 The log is the only progress file

`plan-docs/2026-08-31-ask-agent-log.md` gets one Stage entry per merged slice,
written **immediately after that merge**, in the template the log already defines:
Changed / Verified / Open, plus the branch name and merge SHA. The phase-status
table is updated in the same edit.

No `tests.json`, no `progress.txt`, no scratch status files. Three things that
already exist and cannot go stale describe the state completely: the log's last
entry, `git log --oneline main..feat/ask`, and `npm test`. A fourth file would
only be a fourth thing to keep in sync.

### 17.5 The boundary

**In bounds, without asking:** creating and merging `feat/ask*` branches;
committing to them; read-only network calls (the published artifact, the WPFL
API, ESPN with the existing credentials, web docs); writing the shred and the
WPFL cache into `ASK.DATA_DIR`; installing the dependencies in §12; running
typecheck, lint and the test suite.

**Out of bounds:**

| Action | Why it is AJ's |
| --- | --- |
| Checking out or committing to `main` | `main` already carries an unpushed commit; merges are reviewed, not assumed |
| `git push` (any remote, any branch) | Pushing `main` is what `scripts/deploy.sh` acts on — it reaches the live bot |
| `npx tsx deploy-commands.ts` | Registers slash commands on the live Discord guild |
| Applying `009_ask_agent.sql` | Writes to the production database; `POSTGRES_URL` in `.env` is the real one |
| Anything in `../draft-2026` | A different repo; the pre-launch re-publish (§3.1a) is AJ's ritual |
| `git push --force`, `reset --hard`, deleting unmerged branches, `--no-verify` | Destructive or history-rewriting |

**The one conditional:** at Phase 7, if `ANTHROPIC_API_KEY` or
`CLAUDE_CODE_OAUTH_TOKEN` is present, run **at most three** live `query()` smoke
calls with `maxBudgetUsd` set, and record the measured cost. If absent, record
"skipped, no credential" and move on without waiting (§15.12).

### 17.6 Handoff

The build ends with `feat/ask` green and unmerged, and a report naming: every
branch and its merge SHA, the final test count against the 450 baseline, every
open item from §15 that closed and what closed it, every one that did not, and
the exact commands AJ runs next — in order:

```bash
npx tsx scripts/runMigration.ts migrations/009_ask_agent.sql   # apply 009
# add CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY) to .env
git checkout main && git merge --no-ff feat/ask
git push origin main                                           # deploys the bot
npx tsx deploy-commands.ts                                     # registers /ask
# and, in ../draft-2026:  scripts/deploy.sh                    # ship prerequisite, §3.1a
```
