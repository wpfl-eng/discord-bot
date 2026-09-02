# WPFL Ask Agent — Build Log

Stage-by-stage progress against `plan-docs/2026-08-31-ask-agent-design.md`.

**How to use this file.** One entry per stage, appended in order, newest at the
bottom. Every entry records what changed, what was *verified* (not what was
assumed), and what it left open. When something in the design turns out to be
wrong, the correction is recorded here and the design doc is edited to match —
the design doc always describes the current intent, this log describes how we
got there.

Status legend: `DONE` · `IN PROGRESS` · `BLOCKED` · `NOT STARTED`

---

## Phase status

Build stages map 1:1 onto branches (design §14, §17). Everything below Stage 3
happens on `feat/ask` or a `feat/ask-*` slice of it; nothing touches `main`.

| Stage | Phase | Branch | Description | Status |
| --- | --- | --- | --- | --- |
| 0 | — | — | Design | DONE |
| 1 | — | — | Adversarial review + decision revision | DONE |
| 2 | — | `fix/espn-fork-pin` | ESPN fork fixed (`591ee59`), pinned, verified | DONE |
| 3 | — | — | Build-readiness review: TDD, branches, conciseness, `prompt.md` | DONE |
| 4 | 0 | `feat/ask` | Scaffolding — deps, `askConfig`, `askAuth`, `wpflMembers` | DONE |
| 5 | 1 | `feat/ask-data` | Data layer — fixtures + generator, sync, shredder, INDEX.md, history cache | DONE |
| 6 | 2 | `feat/ask-persistence` | Persistence — migration 009, `askDb`, caps | DONE |
| 7 | 3 | `feat/ask-tools` | Tools (API) — 3 WPFL aggregates, 4 ESPN | DONE |
| 8 | 4 | `feat/ask-sql` | SQL and MCP — DuckDB, statement guard, `mcpServer` | DONE |
| 9 | 5 | `feat/ask-runner` | Runner — system prompt, `askRunner`, concurrency, hooks | DONE |
| 10 | 6 | `feat/ask-discord` | Discord surface — `/ask`, threads, ticker, continuation | DONE |
| 11 | 7 | `feat/ask` | Integration and handoff — docs, full suite, conditional smoke test | DONE |
| 12 | — | `feat/ask` | Adversarial review — eight fixes, each with tests | DONE |
| 13 | — | `feat/ask` | The two lifetime races — deferred teardown for shred and SQL | DONE |
| 14 | — | `feat/ask` | Second adversarial review with AJ — nineteen decisions, first live runs | IN PROGRESS |

**AJ's, not the build's** (design §17.5): applying migration 009, merging to
`main`, `git push`, `deploy-commands.ts`, and the pre-launch re-run of
`draft-2026/scripts/deploy.sh`.

---

## Stage 0 — Design — 2026-08-31 — DONE

Full requirements interview with AJ, walking the decision tree in dependency
order. No code written. Output is the design doc.

### Decisions reached

Recorded in full in the design doc §2. The load-bearing ones and why:

- **Agent SDK over the Messages API tool runner.** The value is exploration we
  didn't pre-script; a fixed tool surface would have capped the feature at
  whatever queries we thought of in advance.
- **Fetch + shred rather than vendoring or live HTTP slices.** Forced by
  measurement — see below.
- **No shell; a read-only DuckDB SQL tool instead.** Keeps real aggregation
  power without putting a shell on the host that untrusted Discord text can
  steer.
- **`/ask` opens a thread; anyone continues it.** Thread id maps 1:1 to session
  id, so conversation costs no bookkeeping we invented.
- **Grounded-or-silent with an inline source footer.** Carried over from
  draft-2026's prose discipline. One confidently wrong figure about someone's
  real team costs more trust than ten good answers earn.
- **Opus 5 at effort `high` everywhere.** AJ chose one config over a
  latency/quality split.
- **No scheduled or proactive jobs, and `/ask` is the only command.** Both
  proposed and both declined — the bot never speaks unprompted.
- **Auth stays swappable.** See open items.

### Verified during this stage

Every claim in the design doc's Appendix §16 was measured, not recalled. The
findings that actually changed the design:

1. **The bot host is a different machine.** No `pm2`, no `~/discord-bot` on the
   dev box; `scripts/deploy.sh` pulls from GitHub and restarts under pm2 in
   `$HOME/discord-bot`. This killed any design that read `../draft-2026`
   directly and forced the published-artifact path.

2. **The published artifact is publicly fetchable.**
   `https://wpfl-receipts-694ed0.pages.dev/postdraft.json` → HTTP 200,
   `application/json`, `access-control-allow-origin: *`, etag present. This is
   the one coupling between the bot and draft-2026, and it needs no
   coordination between the two machines.

3. **The artifact has zero newlines and is ~239K tokens.** `wc -l` = 0 (deploy.sh
   writes it with `json.dump`). `Grep` against it returns the whole 955 KB line;
   `Read` costs 239K tokens. This measurement is the entire justification for
   the shred, and for `.jsonl` on `league.dossiers` (196 entries) and
   `news.players` (182 entries).

4. **The WPFL API has no 2026 data.**
   `/api/expectedwins?seasonMin=2026&seasonMax=2026` returns `[]`; 2025 is
   populated through week 14. So ESPN is the *only* source of current-season
   truth, which is why the ESPN tool set is non-optional rather than a nice-to-have.

5. **`allowedTools` confines nothing.** From the permissions doc: a tool not
   listed "is still available to Claude and falls through to the permission
   mode," and a **bare** `Read` allow auto-approves reads anywhere on disk. The
   earlier sketch in this session was wrong on this point. Corrected to
   `permissionMode: 'dontAsk'` plus a **path-scoped** `Read(//<dataDir>/**)`
   using the `//` absolute anchor — a single leading slash would have anchored
   at cwd instead, which is a subtle and expensive difference.

6. **`editReply()` returns a `Message`** (`typings/index.d.ts:664`) and
   `fetchReply` is deprecated in 14.27.0. `Message.startThread()` at `:2538`.
   This let the design put the ticker *inside the thread* rather than on the
   interaction reply — which sidesteps the 15-minute interaction-token expiry
   entirely and gives the ticker its own rate-limit bucket.

7. **Prompt cache TTL defaults to 5 minutes on API-key auth.** A Discord bot is
   exactly the bursty-with-gaps pattern that keeps missing that window, so
   `ENABLE_PROMPT_CACHING_1H` goes in `agentEnv()`.

8. **Cost must be read from `total_cost_usd` / `modelUsage`, never `usage`** —
   the docs state `usage` excludes subagent tokens. No subagents in v1, but
   reading the right field now means adding them later can't silently
   under-report.

9. **The identity gap.** `constants/espnMembers.ts` has ESPN ids but no Discord
   snowflakes; the only file with snowflakes is `constants/sleeperMembers.ts`, a
   different 12-team league that `CLAUDE.md` says to leave alone. AJ supplied all
   14 snowflakes during the interview; they map cleanly onto
   `../draft-2026/backend/config.py:57` `TEAM_OWNERS`. Two spellings normalized
   to canonical: "michael simpson" → Mike Simpson (8), "dave evans" → David
   Evans (6).

### Raised with AJ, decided by AJ

The Agent SDK docs state, in both the overview and the quickstart:

> "Unless previously approved, Anthropic does not allow third party developers to
> offer claude.ai login or rate limits for their products, including agents built
> on the Claude Agent SDK."

AJ intends to run on a 20x Max plan token and made that call with the language in
view. Consequences folded into the design: the code is auth-agnostic
(`llm/auth.ts` prefers `ANTHROPIC_API_KEY`, falls back to
`CLAUDE_CODE_OAUTH_TOKEN`), `total_cost_usd` is treated as a consumption proxy
rather than a bill, and `DAILY_QUESTIONS_PER_USER` becomes the real limiter.

### Open at end of stage

| # | Item | Resolves in |
| --- | --- | --- |
| 1 | Auth question above | AJ / ongoing |
| 2 | DuckDB prebuilds on host Node 20.15.1 — dev box runs 24.14.1, so untested | Phase 3 |
| 3 | DuckDB lockdown setting names (`enable_external_access`, `lock_configuration`) unverified | Phase 3 |
| 4 | Session storage growth under `~/.claude/projects/` unmeasured | Phase 5 |
| 5 | Discord *Create Public Threads* / *Send Messages in Threads* permissions unconfirmed on the guild | Phase 5 |
| 6 | Per-question cost is estimated ($0.13–0.16), never measured | Phase 6 |
| 7 | Host `npm install` must keep optional deps or the native binary is missing | Phase 6 |

### Deliberately not built

Proposed during the interview and declined, recorded so they aren't re-litigated
by accident: Tuesday recap, Sunday lineup guard, Thursday preview, waiver
Wednesday, `/scout`, `/roast`, `/lineup`, `/trade`, economy coin pricing, channel
gating, Postgres as an agent tool, subagents, Sleeper.

---

## Stage 1 — Adversarial review + decision revision — 2026-08-31 — DONE

A second interview, this time adversarial: every load-bearing claim in the Stage 0
design was re-derived from the live artifact, the live Agent SDK docs, the
installed packages, and the running APIs rather than taken on trust. Twelve claims
were wrong or incomplete. No code written; the design doc was rewritten to match.

### The finding that mattered most

**The design was measured against a file the bot will never fetch.** §3.1, §3.3
and §16 described `../draft-2026/data/cache/postdraft_2026.json` (955,019 B). The
published URL serves a *different, older* build (935,568 B). Both carry the same
`meta.generated` (`2026-08-28 21:20`) and byte-identical `meta`, `teams`, `news`
and `history`, because draft-2026's part-18 `prune` and `swap_body` ran locally
after the last publish and **neither touches `meta.generated`**. Exact diff:

| | Published | Local (publishes next) |
| --- | --- | --- |
| top-level | `available` | `market` (35,622 B, 9 keys) |
| `league` | `grade_board`, `ridgeline`, `season_intro` | — |
| `night` | `clock` | `acts` |

Three consequences, all now in the design:

1. `available` alone would have tripped the "unknown body → hard error" rule on
   the very first shred.
2. The whole `market/` directory in §3.3 does not exist at the URL yet.
3. The three `league` extras and `night.clock` are **exactly** draft-2026's
   `DEAD_KEYS` — retired analysis. A tolerant shredder would have shredded them
   and the agent would have cited retired work as current.

`meta.generated` therefore cannot identify an artifact version. Only the etag can.

### Findings, in the order they change the design

1. **Fail-loud was inverted.** The in-season pipeline (`backend.analysis.week`,
   the `race` body) will add a body the shredder doesn't know. Aborting the shred
   and retaining the previous one means the bot answers confidently from August
   data — the exact failure §3.6 existed to prevent.
2. **Bare `Grep`/`Glob` were the hole in §10.** File checks consult only
   `Read(path)` and `Edit(path)` rules; `Glob(path)` rules are documented as
   accepted and never consulted. A *bare* allow entry auto-approves every call,
   and `Grep` returns file contents — reaching `~/discord-bot/.env` and its
   `DISCORD_TOKEN`, `POSTGRES_*`, `ESPN_S2`, `SWID`. §10.1's minimal env keeps
   those out of the process; it does nothing about reading the file. The Bash
   sandbox is Bash-only and does not apply.
3. **`tools: [...]` is the right knob.** The custom-tools doc separates
   availability from permission: `tools` removes unlisted built-ins from context.
   The four-name `disallowedTools` denylist goes stale as the SDK adds built-ins.
4. **The SQL tool was pointed at the wrong dataset.** §4.3 scoped DuckDB to the
   shredded artifact — under 1 MB across ~40 files, already sized for `Read` and
   `Grep` — and excluded the WPFL decade, the only thing too large to read
   (`playerscores` 2015–2025 is ~38,000 rows, ~10 MB, ~2.5M tokens). The design's
   own motivating question about paying up for a WR cannot be answered from the
   artifact at all.
5. **Two WPFL endpoints are server-computed aggregates, not rows.** Measured for
   AJ Boorde in 2024: `expectedwins` returns 3.92 (wk 1–5), 9.06 (regular
   season), 10.67 (with playoffs); `optimalcoaching` returns 660.38 optimal
   through week 5 vs 2180.72 full-season. `optimalPointsFor` needs a lineup solve
   that cannot be reconstructed from raw scores. They cannot be replaced by a
   cache, and a hand-computed figure would contradict `/ewins` in the same
   channel.
6. **`/activity` is broken today.** `package.json` pins upstream
   `espn-fantasy-football-api@2.0.1`, not the fork `CLAUDE.md` claims and
   `types/espn-fantasy.d.ts` is written against. Upstream has no
   `getRecentActivity`; `discordCommands/activity/activity.ts:29` calls it. The
   types describe the fork while the lockfile installs upstream, which is why it
   compiles and fails only at runtime. §4.2's `espn_transactions` had nothing to
   call.
7. **`query()` throws after yielding an error result.** §5.3 had no `try`/`catch`,
   so a budget stop would have taken down the handler and skipped the ledger write
   §6.4 promises.
8. **Nothing bounded concurrency or wall-clock time.** Every `/ask` spawns a
   Claude Code subprocess; 14 members at 20/day is up to 280 spawns. `maxBudgetUsd`
   caps spend, not duration.
9. **`startThread` throws outside text channels.**
   `node_modules/discord.js/src/structures/Message.js:1033-1039` requires
   `GuildText` or `GuildAnnouncement`. `/ask` run inside an existing ask thread —
   the most likely misuse — hit the generic "There was an error" path.
10. **The dollar ceiling was built on a field the docs say not to decide from.**
    `total_cost_usd` is a client-side estimate from a bundled price table; on
    subscription auth it approximates no bill at all; and
    `error_during_execution` after a crash can arrive with every cost field
    zeroed, so a spend ceiling under-counts exactly the runs that ran longest.
11. **`ENABLE_PROMPT_CACHING_1H` was over-justified.** Subscription auth already
    gets the 1-hour TTL on its own turns until drawing on usage credits.
    `promptCacheTtl: '1h'` is the knob that survives them.
12. **Smaller corrections.** Tool search defers SDK MCP schemas by default, so
    nine custom tools cost an extra round trip (`alwaysLoad: true` on the three
    hot ones). `cleanupPeriodDays` is a settings key reached through the
    `settings` option, not a top-level `Options` field. On Opus 5
    `thinking.display` defaults to `omitted`, so the ticker would have shown dead
    air across every thinking stretch.

### Verified as correct

Not everything was wrong, and the parts that held are worth recording so they
aren't re-checked: discord.js 14.27.0 with `editReply` → `Message`
(`typings/index.d.ts:664`) and `startThread` → `PublicThreadChannel` (`:2538`);
the `ThreadAutoArchiveDuration` enum; the WPFL API's 2025-through-week-14 /
2026-empty split; all 14 ESPN id ↔ canonical owner pairs against
`../draft-2026/backend/config.py:57`; the loader rule at `index.ts:71-93`;
`messageCreate` handling DMs only at `index.ts:196`; and, against the live SDK
docs, `permissionMode: 'dontAsk'`, the `//` absolute anchor, `maxBudgetUsd`,
`effort`, `settingSources`, `strictMcpConfig`, `includePartialMessages`,
`total_cost_usd` / `modelUsage`, and the `error_max_budget_usd` subtype.

Also newly verified: ESPN's 2026 league is readable now — 14 teams at 0-0, week-1
matchups scheduled, rosters carrying `injuryStatus`, 837 free agents with
`percentOwned` and `auctionValueAverage`.

### Decisions reached, by AJ

| # | Area | Decision |
| --- | --- | --- |
| 1 | Shred policy | Tolerant + loud. Unknown body → generic shred + `INDEX.md` flag + `WARN`. **Required** body missing or wrong container type → abort, keep previous shred |
| 2 | Freshness | Publishing stays draft-2026's manual ritual. As-of dates always shown in `INDEX.md` and the answer footer; no age-detection logic. Pre-launch re-deploy is a ship prerequisite |
| 3 | Dead keys | Mirror `artifact.DEAD_KEYS` in the shredder and skip them |
| 4 | Confinement | `tools` allowlist + `Read(//DATA_DIR/**)` + `dontAsk` + a `PreToolUse` realpath hook on Read/Grep/Glob |
| 5 | SQL scope | Shred **and** a cached WPFL decade (draft history 3,130; matchups 1,449; player scores ~38,000) |
| 6 | WPFL tools | Split by kind. Row-shaped → SQL only. Computed aggregates stay live tools; prompt forbids hand-computing them |
| 7 | ESPN dep | Switch to the fork in this work; fixes `/activity`, unlocks `espn_transactions` |
| 8 | Runtime guard | Semaphore at 2 with visible queue position; 4-minute wall-clock deadline that still posts partials and writes the ledger |
| 9 | Model | `claude-opus-5`, `effort: 'high'` (re-confirmed against the `xhigh` recommendation), `thinking.display: 'summarized'` rendered in the ticker |
| 10 | Caps | 20/day/user, 1500 queries/month league-wide, `maxBudgetUsd` $1.00. `cost_usd` recorded for observability, gates nothing |
| 11 | Thread edge | Text channel → thread; inside a thread → run in place and resume if it's a known ask session; forum/voice-text → new session in place |
| 12 | Identity | Startup resolution check on all 14 snowflakes + owner attribution in the answer footer |
| 13 | Sessions | `cleanupPeriodDays: 7`, archive stays `OneDay`, `closed` on archive, revived dead thread → fresh session. `resume` drives live continuation only |
| 14 | WebFetch | Host allowlist replaces the blanket refusal of user-pasted links; denials logged so the list grows from evidence |
| 15 | Sequencing | Build all of phases 0–6 including all five ESPN tools; one launch, one deploy |

### Stage 0 open items, revisited

| # | Item | Status after this review |
| --- | --- | --- |
| 1 | Auth question | **Unchanged.** AJ's call; code stays agnostic |
| 2 | DuckDB prebuilds on Node 20.15.1 | **Resolved.** Bindings ship as per-platform Node-API optional packages, ABI-stable across Node majors. Collapses into item 7 |
| 3 | DuckDB lockdown setting names | **Open.** Still Phase 3; statement guard is the independent fallback |
| 4 | Session storage growth | **Mitigated** by `cleanupPeriodDays: 7`; actual transcript size still unmeasured |
| 5 | Discord thread permissions | **Open**, but now degrades rather than breaks — the non-thread fallback covers it |
| 6 | Per-question cost estimated | **Open.** Also demoted: it no longer gates anything |
| 7 | `npm install` must keep optional deps | **Open and now doubled** — both the Agent SDK and DuckDB depend on it |

### New open items

| # | Item | Resolves in |
| --- | --- | --- |
| 8 | The ESPN fork is 0.16.1, based on an older upstream; whether its four methods still work against ESPN's 2026 endpoints is unverified, and it gates five existing commands | Phase 3 |
| 9 | ESPN tools are being written against a 0-0 preseason; their real shape is unverified until week 1 | Week 1 |
| 10 | Whether `Read(//DATA_DIR/**)` alone blocks a Grep escape, or whether the hook is the only thing standing there | Phase 4 |
| 11 | Pre-launch re-run of `draft-2026/scripts/deploy.sh` so the published artifact carries the market study and drops the dead keys | Phase 6 |

### Deliberately not built

Unchanged from Stage 0 and not re-litigated: Tuesday recap, Sunday lineup guard,
Thursday preview, waiver Wednesday, `/scout`, `/roast`, `/lineup`, `/trade`,
economy coin pricing, channel gating, Postgres as an agent tool, subagents,
Sleeper. Added this stage: the agent does not read Discord channel history.

---

## Stage 2 — ESPN fork fixed, pinned, verified (Phase 0 slice) — 2026-08-31 — DONE

AJ's instruction: verify the ESPN fork works before anything else. It did not.
The break was found, fixed in the fork, pushed, pinned, and verified end to end.

### Changed
- `aboorde/ESPN-Fantasy-Football-API` → commit **`591ee59`** on `master`:
  four `baseURL` strings in `src/client/client.js` (lines 234, 335, 357, 377)
  moved from the retired `https://fantasy.espn.com/` to
  `https://lm-api-reads.fantasy.espn.com/`; all four bundles rebuilt.
- `package.json` → `espn-fantasy-football-api` pinned by SHA to that commit.
- `package-lock.json` → regenerated.
- Design doc §4.2, §12, §14, §15.2 and §16 updated to match.

### Verified

**The fork was broken as-shipped.** Its last commit before this
(`5f838e0`, 2024-05-31, *"Updated api url"*) moved `axios.defaults.baseURL` and
the leagueHistory route to `lm-api-reads` but missed four call sites, three of
them inside `getRecentActivity`. Measured directly:

```
fantasy.espn.com/...communication      -> 302 -> www.espn.com/fantasy/ (13 bytes)
lm-api-reads.fantasy.espn.com/...      -> 200, 20,578 bytes, 16 topics
```

axios follows redirects, so `response.data` was an HTML page,
`response.data.topics` was `undefined`, and the method threw
`TypeError: Cannot read properties of undefined (reading 'map')`. Reproduced on
both 2025 and 2026 before the fix.

**Method-by-method, against the live 14-team league:**

| Method | Before fix | After fix (2026) |
| --- | --- | --- |
| `getTeamsAtWeek` | PASS | PASS — 14 teams, 14-man rosters |
| `getBoxscoreForWeek` | PASS | PASS — 7 matchups |
| `getFreeAgents` | PASS | PASS — 837 players |
| `getRecentActivity` | **FAIL** | **PASS** — 16 topics, 29 actions |

**Commands re-run against the live league after the swap:**

- `/activity` — was broken, now returns real transactions:
  *"Jimmy added Jaylen Wright from Free Agency … Doug dropped Baker Mayfield"*
- `/standings`, `/trophies`, `/median`, `/closestscores` — all clean on 2025 wk 1.
- `npm run typecheck` 0 · `npm run lint` 0 · `npm test` **450/450 across 16 suites**.
- The fork's own suite: **197/197 across 11 suites**.

### Findings this stage produced

1. **`espn_transactions` can only ever be current-season.** ESPN serves
   `/communication` for the current season and 404s for prior ones — 2024 → 404,
   2025 → 404, 2026 → 200 — independent of client. The tool description has to
   say so or the agent will retry historical questions until it gives up. Now in
   design §4.2.

2. **The fork returns blank team names.** `team.name` is `" "` where upstream
   returns `"Ball's Balls"`, and the fork has no `ownerName` field. Checked
   side-by-side: every field `/standings` actually sorts and prints
   (`wins`, `losses`, `ties`, `finalStandingsPosition`, `playoffSeed`,
   `regularSeasonPointsFor`) is **byte-identical** to upstream, so nothing
   regresses — the repo maps team ids through `espnMembers`
   (`standings.ts:44`, `trophies.ts:142`) and never reads ESPN's team name. But
   it makes `constants/wpflMembers.ts` the *only* owner mapping available, not
   merely the preferred one.

3. **Rebuilding the fork needs a flag.** `npm run build` fails on Node 17+ with
   `error:0308010C:digital envelope routines::unsupported` — webpack 4's Terser
   uses an MD4 hash OpenSSL 3 rejects. `NODE_OPTIONS=--openssl-legacy-provider`
   fixes it. Affects rebuilding only; consumers install the committed bundles.

4. **The ssh-in-lockfile scare is not real.** npm normalizes GitHub deps to
   `git+ssh://git@github.com/…` in `resolved`, which looked like it would break
   `scripts/deploy.sh` on a host with no GitHub SSH key. Tested with
   `GIT_SSH_COMMAND=/bin/false` and a fresh `HOME` (no keys, no `known_hosts`):
   **install succeeds** — pacote falls back to https. Deploy is safe.

5. **Pinned by SHA rather than by branch.** `#591ee59a…` means the bot host can
   never silently install a fork commit nobody tested. Future fork fixes need a
   `package.json` bump, which for a repo whose previous commit was 2024 is a
   feature.

### Open

- `package.json` and `package-lock.json` are modified but **not committed** in
  `discord-bot` — left for AJ.
- Design-doc open item 8 (fork compatibility) is **closed**. Item 9 (ESPN tools
  written against a 0-0 preseason) stands: rosters, schedule and free agents are
  real, but no game has been played, so `espn_boxscores` and `espn_standings`
  are still unverified against live scoring until week 1.

---

## Stage 3 — Build-readiness review — 2026-08-31 — DONE

A third pass over the design, this time asking not "is it correct?" but "is it
buildable, testable, and no larger than it needs to be?" No code written. The
design doc was edited; `plan-docs/prompt.md` was created as the operating contract
for the build itself.

### Changed

- Design §1 — seventh design principle: the minimum that does the job.
- Design §2 — decisions table gains Tests / Fixtures / Git rows.
- Design §4.2 — ESPN tools **5 → 4**; `alwaysLoad` trio updated.
- Design §8, §10.3 — `ask_tool_calls` narrowed to denials and failures.
- Design §11 — file structure **20 → 17** source files; `llm/` removed,
  `wpfl/glossary.ts` folded away; `scripts/makeAskFixtures.ts` and three test
  files added.
- Design §13 — rewritten from a test inventory into a **TDD contract**.
- Design §14 — rewritten as phases mapped onto branches, with the dependency
  graph drawn explicitly.
- Design §15.4 / §15.5 / §15.11 — phase numbers corrected for the new ordering;
  new §15.12 records the missing Claude credential.
- Design §16 — nine measurements added.
- Design §17 — **new**: git workflow, green gate, autonomy boundary, handoff.
- `plan-docs/prompt.md` — **new**.

### Verified

Measured on the dev box, not assumed:

| Fact | Value | Consequence |
| --- | --- | --- |
| `.env` credential scan | no `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN` | the live smoke test becomes conditional and non-blocking (§15.12) |
| Largest tracked file | 685 KB (`data/WPFLHistoryCondensed.xlsx`) | two 950 KB fixtures would have been the repo's largest files; trimmed instead |
| `tests/fixtures/` | does not exist | no precedent to follow; §13.2 establishes one |
| Historical merge style | `--no-ff` merge commits, `Merge branch 'feature/…'` | §17.3 matches the repo rather than the last five linear commits |
| Historical branch prefixes | `feature/`, `bugfix/`, `hotfix/`, `fix/`, `chore/` | `feat/ask` is new but consistent with the conventional-commit scopes in use |
| Test seams in use | param DI (`standings.test.js`), `unstable_mockModule` (`achievementService.test.ts`) | §13.4 reuses both rather than inventing a third |
| Jest config | 29.7.0, ESM, **no coverage threshold** | the gate is "count went up", not a percentage |
| Baseline suite | 450 tests / 16 suites at `eb32b4d` | the number every merge is measured against |

Two duplications found and removed, both of which had survived two prior reviews:

1. **`espn_roster` and `espn_standings` were the same call.** Both
   `getTeamsAtWeek`, both returning the same objects; they differed only in which
   fields the description pointed at. Two schemas and two deferred tool-search
   loads for one question.
2. **`llm/` held three constants and one function.** `modelConfig.ts` contradicted
   the design's own sixth principle — config lives in `askConfig.ts` — and
   `auth.ts` had no reason to sit outside the feature directory when `economy/`,
   `trivia/` and `wordle/` all keep their own concerns together.

Also reconciled against the current prompting guidance for Opus 5, which changed
what went into `prompt.md`: **remove** verification-step and "double-check your
work" instructions (they compound with the model's own behaviour and cost tokens
for no gain), **add** explicit scope constraint and delegation caps (Opus 5
expands scope and delegates readily), and prompt explicitly for conciseness
(effort does not reliably shorten visible output).

### Decisions reached, by AJ

| # | Area | Decision |
| --- | --- | --- |
| 1 | Review mandate | Trim the clear over-build; keep every capability |
| 2 | TDD | Strict red-green-refactor, three named carve-outs; never weaken a test to go green |
| 3 | Fixtures | Trimmed + committed generator + a live shape-check skipped in CI |
| 4 | Branches | Six `feat/ask-*` slices, forked where the dependency graph forks |
| 5 | Merges | `--no-ff` behind a typecheck/lint/test green gate; branch deleted after |
| 6 | Autonomy | Stop at `feat/ask`. No `main`, no push, no `deploy-commands`, no live migration, no draft-2026 |
| 7 | Live calls | Read-only freely; `query()` smoke only if a credential exists, non-blocking |
| 8 | Tool audit | `ask_tool_calls` records exceptions only |
| 9 | `prompt.md` | Operating contract that points at the design doc, not a second copy of it |
| 10 | Cadence | Run straight through; halt only on the defined escalation list |
| 11 | Delegation | Single builder; read-only research subagents permitted |

### Open

| # | Item | Resolves in |
| --- | --- | --- |
| 12 | No Claude credential on the box, so the SDK wiring is unproven until AJ provides one or runs it | Stage 11, conditionally |
| 13 | Whether the trimmed fixtures stay faithful as draft-2026's shape moves — guarded by a skipped test nobody is scheduled to run | Whenever the artifact is republished |

Stage 1 open items 1, 3–7 and 9–11 are unchanged. Item 8 (fork compatibility)
closed in Stage 2.

---

## Stage 4 — Scaffolding (Phase 0) — `feat/ask` — 2026-08-31 — DONE

Committed directly to `feat/ask` (no merge SHA — every later slice depends on all
of it, so a branch here would only have added a merge).

### Changed
- `package.json` / `package-lock.json` — added `@anthropic-ai/claude-agent-sdk`,
  `@duckdb/node-api`, `zod`.
- `ask/askAuth.ts` — **new.** `agentEnv()`: credential precedence and the minimal
  subprocess environment.
- `ask/askConfig.ts` — **new.** Every tuning constant, model config folded in.
- `constants/wpflMembers.ts` — **new.** Discord ↔ ESPN id ↔ canonical owner, 14 rows.
- `tests/ask/askAuth.test.ts` — **new**, 8 tests, written first.

### Verified

**Dependencies resolved, and both native binaries are present and execute.** This
was §15.3's risk — an install that drops optional dependencies produces a bot that
fails at runtime — so it was checked by loading them, not by reading the lockfile:

| Package | Resolved | Native artifact | Loads |
| --- | --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | 0.3.252 | `claude-agent-sdk-linux-x64/claude`, 214,371,672 B | yes — `query`, `tool`, `createSdkMcpServer` all `function` |
| `@duckdb/node-api` | 1.5.5-r.4 | `node-bindings-linux-x64/duckdb.node` 436 KB + `libduckdb.so` 68 MB | yes — `SELECT 42, version()` → `{"x":42,"v":"v1.5.5"}` |
| `zod` | 4.5.4 | — | — |

`npm install` emitted `EBADENGINE` (`package.json` requires Node 20.15.1, dev box
runs v24.14.1). Pre-existing, unrelated to these packages, and not acted on.

**TDD, red then green.** `tests/ask/askAuth.test.ts` was committed failing
(`98bd79c`, module not found) before `ask/askAuth.ts` existed (`a195008`).

**One test was wrong and was fixed in the open, not weakened** (`b95ad5e`). Two
assertions required `BotError.userMessage` — the text a league member reads in
Discord — to name `ANTHROPIC_API_KEY` and `PATH`. Telling a member which
environment variable the host is missing is worse behaviour, not better. The
names were moved to the assertion that fits them, `originalError.message`, which
`BotError.toLogObject()` already surfaces to the operator, and the member-facing
half is now asserted *negatively* as well: `userMessage` must not carry either
variable name. Net coverage went up, not down.

**`agentEnv()` leaks nothing.** With `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
`POSTGRES_URL`, `POSTGRES_PASSWORD`, `ESPN_S2`, `SWID`, `OPEN_API_KEY` and
`FINNHUB_API_KEY` all set in `process.env`, the returned object's key set is
exactly `['ANTHROPIC_API_KEY', 'ENABLE_PROMPT_CACHING_1H', 'HOME', 'PATH']` —
asserted as an exact sorted array, so a future leak fails rather than passes.

**`wpflMembers` cross-checked at runtime:** 14 rows; `espnId`, `discordId` and
`owner` each 14 unique values; and the ESPN id sequence is byte-equal to
`constants/espnMembers.ts` (`1,3,4,5,6,7,8,9,10,11,12,13,14,15`).

**`askConfig` resolves:** `DATA_DIR` → `/home/aboorde/wpfl-data`,
`THREAD_AUTO_ARCHIVE` → `1440`, model `claude-opus-5` / `high` / `summarized`,
14 WebFetch hosts.

**Green gate:**

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | clean |
| `npm test` | 0 | **458 passed / 17 suites** (baseline 450 / 16) |

### Open
- Nothing new. §15.12 (no Claude credential) is unchanged and still resolves
  conditionally at Stage 11; nothing in this stage needed one.

---

## Stage 5 — Data layer (Phase 1) — `feat/ask-data` — 2026-08-31 — DONE

Merged to `feat/ask` as **`c43a225`** (`--no-ff`); branch deleted.

### Changed
- `scripts/makeAskFixtures.ts` — **new.** Generates both fixtures from the two
  real builds.
- `tests/fixtures/postdraft-published.json` (76 KB), `postdraft-next.json` (86 KB)
  — **new**, generated.
- `wpfl/shredder.ts` — **new.** `BODY_PLANS`, `DEAD_KEYS`, tolerant-and-loud shred.
- `wpfl/indexGenerator.ts` — **new.** `INDEX.md` including the glossary constants.
- `wpfl/historyCache.ts` — **new.** The cached WPFL decade.
- `wpfl/artifactSync.ts` — **new.** Fetch, etag check, atomic swap.
- `ask/askConfig.ts` — WPFL API base, timeout and season floors added.
- Tests: `shredder` (25), `indexGenerator` (14), `historyCache` (9),
  `artifactSync` (11).

### Verified

**Fixtures are faithful, not hand-written.** The published fixture's key set is
identical to the live artifact's at every level; the next fixture's is identical
to draft-2026's local build plus the `available` wrapper `deploy.sh` adds. Dead
keys present in one and absent in the other; `market` and `night.acts` only in
next; `news.teams` (14 keys) preserved whole while `dossiers` (196),
`news.players` (182) and `news.reads` (57) truncate.

**The real 935 KB artifact shreds to exactly the §3.3 layout**, not only the
fixture: 53 files, 844,151 B, **5 ms**. 14 team files with correct owner slugs
(8,029–9,362 B each), `league/dossiers.jsonl` 196 lines, `news/players.jsonl`
182 lines, `available` ignored, four dead keys skipped, nothing undocumented.

The design's central claim holds: `grep "Bijan Robinson" league/dossiers.jsonl`
returns a **1,079 byte line** rather than the 935 KB single line the unshredded
artifact would match.

**The real WPFL cache builds.** Against the live API: **40,261 rows,
9,325,799 B, 12.0 s** — `draft_history` 3,130 (2010–2025), `matchups` 1,449,
`player_scores` 35,682 across 2015–2025. Every 2026 request returned `[]`,
confirming §15.10 and confirming that an unplayed season is data, not failure.

**End-to-end sync against the live artifact:** cold `ensureFresh()` produced the
full tree in **8.0 s** — 53 shred files, three cache files, `INDEX.md`, `.etag`
— and the second call short-circuited to `fresh`. Forced stale (mtime pushed
back 7 h), it returned `unchanged` in **0.16 s**.

**Green gate on `feat/ask` after the merge:**

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | clean |
| `npm test` | 0 | **517 passed / 21 suites** (was 458 / 17) |

### Findings that corrected the design

1. **Cloudflare returns a weak etag on a compressed response and a strong one
   otherwise.** `curl -sI` sends no `Accept-Encoding` and gets
   `"75c67b38…"`; Node's `fetch` always negotiates gzip and gets
   `W/"75c67b38…"` on both HEAD and GET, for the same build. §3.5 compared the
   raw strings, so the unchanged short-circuit would never have fired: every
   stale window would have paid a full re-shred plus a cache rebuild, forever,
   and nothing would have looked broken. `normalizeEtag` strips the prefix and
   quotes at the boundary. Now in design §3.5 and §16.

2. **The glossary term `mkt` does not exist.** §3.4 listed it. Counting keys
   across both builds: `mkt` 0 occurrences, `market` 4 and 5. The glossary
   defines `market`. Design corrected.

3. **`seasonMax` cannot be hardcoded to 2025.** §3.7's own prose says the
   refresh "matters in season" because the API populates the current year as
   weeks complete — which a 2025 cap makes impossible. It is now the current
   year; an unplayed season costs one request and returns `[]`. Design
   corrected, with the reasoning.

4. **Three size estimates were wrong** and are corrected in place: `INDEX.md`
   11,196 B not ~2 KB (it describes all 53 files individually, so the §3.2
   worked example is ~5K tokens not ~3K); `player_scores` 35,682 rows not
   ~38,000; a cold cache build 8–12 s not ~15 s. The fixtures came out at 76/86
   KB against an estimated ~30 KB, because they are formatted rather than
   minified so a shape change is legible in a diff.

### TDD notes

Every module was committed red before green. One test was corrected rather than
weakened, in Stage 4 (`b95ad5e`); none were in this stage.

`tests/wpfl/artifactSync.test.ts` is **not** in the design's mandatory table —
§13.3 treats `artifactSync` as I/O orchestration. It was tested anyway, and
narrowly: etag normalization and swap atomicity, the two parts that measurably
can break. The weak-etag bug was found by writing that test. Design §11's test
list updated to match.

### Open
- Nothing new. §15.10 (the 2026 data gap) is now measured rather than assumed:
  every WPFL endpoint returns `[]` for 2026 today.

---

## Stage 6 — Persistence (Phase 2) — `feat/ask-persistence` — 2026-08-31 — DONE

Merged to `feat/ask` as **`1e21fe3`** (`--no-ff`); branch deleted.

### Changed
- `migrations/009_ask_agent.sql` — **new.** `ask_sessions`, `ask_usage`,
  `ask_tool_calls`, wrapped in `BEGIN`/`COMMIT` to match 008 and what
  `runMigration.ts` expects.
- `ask/askDb.ts` — **new.** Cap counts, session upsert / turn bump / close, the
  usage ledger, and the tool-exception insert.
- `ask/caps.ts` — **new.** Daily, monthly and turn caps.
- `tests/ask/caps.test.ts` — **new**, 17 tests, written first.

### Verified

**The migration does more than parse.** `runMigration.ts --dry-run` only prints
the file, so it proves nothing. Applied instead against a **throwaway Postgres
16 container on localhost** — never the production database, whose URL sits in
`.env`:

| Check | Result |
| --- | --- |
| Applies | clean |
| Applies a second time | clean — `IF NOT EXISTS` throughout makes it idempotent |
| Schema | exactly §8: 9 / 10 / 8 columns across the three tables, `jsonb` for `tool_input`, `timestamptz` throughout |
| Indexes | all six — 3 primary keys plus `idx_ask_usage_user_day`, `idx_ask_usage_created`, `idx_ask_tool_calls_thread` |
| `ask_usage → ask_sessions` FK | **enforced** — an insert for an unknown thread is rejected |
| Every statement `askDb` issues | runs: the session upsert, `recordTurn` returning `turns = 2`, the ledger insert, the tool-exception insert, and the cap count |

The container was removed afterwards; nothing persists.

**Caps are correct at the boundaries.** The day and month windows are New York
calendar boundaries, matching the trivia scheduler. Asserted at
`2026-09-15T18:00Z` → day start `2026-09-15T04:00Z` (EDT) and month start
`2026-09-01T04:00Z`; at `2026-01-15T18:00Z` → `2026-01-15T05:00Z`, so the DST
offset is handled rather than hardcoded; and across a real rollover, where
`03:59Z` and `04:01Z` on 16 September land in different days.

Daily and monthly caps tested one short of, at, and past their limits. Turn caps
tested at 14/15/16 and 19/20/21: 14 is silent, 15 through 19 answer with a
nudge, 20 and 21 decline. The hard turn cap is checked before any database round
trip, verified by asserting neither count function was called.

**No test touched the real Postgres.** `askDb` is mocked with
`jest.unstable_mockModule`, per the repo's existing idiom.

**Green gate on `feat/ask` after the merge:**

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | clean |
| `npm test` | 0 | **534 passed / 22 suites** (was 517 / 21) |

### Two of my own assertions were wrong, and were corrected rather than weakened

1. One demanded the monthly refusal contain the literal word "month". It names
   the actual month — "September" — which is better. Re-aimed at the month name
   and the limit figure.
2. One tried to prove refusal precedence by asserting the turn-cap message does
   *not* contain `DAILY_QUESTIONS_PER_USER`. That value is 20 and so is
   `HARD_TURN_CAP`, so the string "20 turns" matched by coincidence and the test
   proved nothing. Both precedence tests now assert on the text that actually
   distinguishes the two refusals.

### Open

| # | Item | Resolves in |
| --- | --- | --- |
| 14 | The `ask_usage → ask_sessions` FK means the session row must be written **before** the ledger row. Proven enforced; the ordering is Stage 9's and Stage 10's to respect | Stages 9–10 |

**The migration was not applied to the production database**, per design §17.5.
That remains AJ's.

---

## Stage 7 — Tools, API (Phase 3) — `feat/ask-tools` — 2026-08-31 — DONE

Merged to `feat/ask` as **`515b161`** (`--no-ff`); branch deleted.

### Changed
- `wpfl/wpflApiTools.ts` — **new.** The three computed aggregates.
- `wpfl/espnTools.ts` — **new.** The four ESPN 2026 tools.
- `types/espn-fantasy.d.ts` — extended with the fields these tools read; one
  existing declaration corrected.
- `scripts/makeAskFixtures.ts` — now records the seven tool responses too.
- Seven recordings under `tests/fixtures/`.
- Tests: `wpflApiTools` (17), `espnTools` (26), written against the recordings.

### Verified

**Recorded shapes, 2026-08-31.** These are §13.3's carve-outs — the interfaces
could not honestly be designed before the payload was known.

| Tool | Recorded | Shape |
| --- | --- | --- |
| `expected_wins` | 14 rows, 2.3 KB | `owner, expectedWins, actualWins, seasonMin, seasonMax, weekMin, weekMax` |
| `optimal_coaching` | 14 rows, 1.9 KB | `owner, actualPointsFor, optimalPointsFor, season, week` |
| `drafted_points` | 14 rows, 1.7 KB | `owner, draftedPoints, rosteredOptimalPoints, actualPoints` |
| `espn_teams` | 14 teams | 25 fields per team, roster of 19-field players |
| `espn_boxscores` | 7 matchups | `home/awayTeamId`, `home/awayScore`, rosters of `{player, position, totalPoints}` |
| `espn_free_agents` | 837 players | `{player, rawStats, projectedRawStats}` |
| `espn_transactions` | 29 actions in 16 topics | `{team, player, ids, action, date, bidAmount, targetId}` |

**All seven return live data through the fork:**

| Tool | Latency | Result |
| --- | ---: | --- |
| `espn_teams` | 486 ms | 14 rows, 30.6 KB |
| `espn_boxscores` | 373 ms | 7 matchups, 16.8 KB |
| `espn_free_agents` | 297 ms | 50 rows, 8.6 KB |
| `espn_transactions` | 913 ms | 29 rows, 5.0 KB |
| `expected_wins` | 748 ms | 14 rows |
| `optimal_coaching` | 753 ms | 14 rows |
| `drafted_points` | 1,295 ms | 14 rows |

**Green gate on `feat/ask` after the merge:** typecheck 0 · lint 0 · `npm test`
**577 passed / 24 suites** (was 534 / 22).

### What the recordings changed

1. **Every ESPN tool has to project, and the numbers say why.** Raw
   `getRecentActivity` for 29 transactions is **196 KB** — almost all of it the
   full ESPN team object, roster included, embedded in *every* action, of which
   the tool reads only `team.id`. Projected: **5 KB**. Design §4.2 said these
   tools "return rows"; it did not say the raw rows would be unusable, and they
   are.

2. **The free-agent pool needed a cap that the design does not mention.**
   Measured: **837 players, 513 KB raw**, and ~140 KB even after projection —
   roughly 35,000 tokens in one tool result, a third of a context window spent
   on players nobody would claim. Added test-first: sort by percent owned, keep
   50. Now **8.8 KB, ~2,200 tokens**. This mirrors the row cap §4.3 already
   specifies for the SQL tool.

3. **`tool()` does not expose `alwaysLoad` as a property.** It writes
   `_meta['anthropic/alwaysLoad']`, which is what the API reads. A test caught
   this by asserting the wrong access path; both tool suites now assert the
   wire-level metadata instead.

4. **`drafted_points` returns two dead fields.** `rosteredOptimalPoints` and
   `actualPoints` come back as `0.0` for every owner; only `draftedPoints` is
   populated. The tool description says so, or the agent would cite zeroes as
   findings.

5. **`ActivityPlayer.player` is optional, not required.** The repo's type
   declaration had it required. A recorded `FA ADDED` action carries
   `playerPoolEntry` and no `player` at all. `activity.ts:69` already read it
   with optional chaining, so nothing changes for the existing command — but
   the type was wrong and is now right.

6. **`optimal_coaching`'s week parameter is cumulative.** `week=5` is weeks
   1–5, not week 5 alone. The endpoint does not signal this; the tool
   description now does.

### Open
- Nothing new. §15.9 stands unchanged: these tools are written against a 0-0
  preseason. Every score in every recording is 0, so `espn_boxscores` is
  verified for shape and not for scoring until week 1.

---

## Stage 8 — SQL and MCP (Phase 4) — `feat/ask-sql` — 2026-08-31 — DONE

Merged to `feat/ask` as **`618b220`** (`--no-ff`); branch deleted.

### Changed
- `wpfl/sqlTool.ts` — **new.** In-memory DuckDB, statement guard, row cap.
- `wpfl/mcpServer.ts` — **new.** `createSdkMcpServer` wiring all eight tools.
- `ask/askConfig.ts` — `SQL_ROW_LIMIT`, `SQL_TIMEOUT_MS`.
- Tests: `sqlTool` (41), `mcpServer` (6).

### The DuckDB lockdown finding — §15.4 CLOSED

Both setting names the design guessed are real in the installed version
(1.5.5-r.4), both can be set at runtime after materializing, and both behave as
§4.3 assumed. Probed directly:

| After `SET enable_external_access=false` + `SET lock_configuration=true` | |
| --- | --- |
| `SELECT` from a materialized table | **works** |
| `read_json_auto('/etc/passwd')` | Permission Error — file system operations disabled |
| `read_csv`, `read_text`, `glob('/etc/*')` | Permission Error |
| `COPY … TO` | Permission Error |
| `ATTACH`, `INSTALL`, `LOAD` | Permission Error |
| `SET enable_external_access=true` | Invalid Input Error — configuration is locked |
| `SET lock_configuration=false` | Invalid Input Error — configuration is locked |
| `SET allowed_directories=['/etc']` | Invalid Input Error — configuration is locked |
| A **new connection** on the same instance | inherits the lockdown; cannot read files |

Confirmed again against the real database: an attempt to read the bot's own
`.env` through `read_json_auto` is refused by DuckDB.

### The statement guard is the control, not a second layer

The design called it "belt-and-braces on top of" the lockdown. Measured, it is
load-bearing on its own: **DuckDB executes every statement it is handed.**
Running `SELECT 1; DELETE FROM probe` against a seeded table emptied it. So the
one-statement rule is what stops `SELECT 1; DROP TABLE wpfl_player_scores` from
destroying the agent's own dataset mid-session — lockdown does not touch that,
because dropping an in-memory table is not external access.

The guard strips string literals, quoted identifiers, and both comment styles
before matching, so it rejects statements rather than text: `WHERE owner = 'Drop
Table Guy'`, `SELECT 'copy that'`, and a column named `dropped_players` all pass,
while every keyword in the §4.3 list is rejected as a whole word.

### Verified

**Materialization against the real shred:** 43 tables in **272 ms** — 39 from
the artifact, `teams` from the 14 owner files, and the three `wpfl_*` files.

**The cross-source join the tool exists for.** Design §3.7's motivating question
— *"has anyone ever paid up for a WR the way I did and had it work?"* — over
3,130 draft rows joined to 35,682 player-score rows, in **9 ms**:

```
2023  Doug Black      Tyreek Hill       $64  299.2 pts  4.68 per $
2024  Nixon Ball      Ja'Marr Chase     $69  318.9 pts  4.62 per $
2021  Rick Kocher     Davante Adams     $62  274.3 pts  4.42 per $
```

An artifact-to-decade join also works: 2026 draft grade against career picks,
reading a nested struct field (`t.grade.letter`) straight out of the shred.

**Eight tools register, three always loaded** — `sql`, `espn_teams`,
`expected_wins` — matching §4.2.

**Green gate on `feat/ask` after the merge:** typecheck 0 · lint 0 · `npm test`
**624 passed / 26 suites** (was 577 / 24).

### Findings that changed the implementation

1. **DuckDB's JS values are not JSON-serializable.** A `COUNT(*)` comes back as
   a JS `BigInt`, which `JSON.stringify` throws on outright, and a STRUCT comes
   back as `{entries: {...}}`. The library ships `getRowObjectsJson()`, which
   converts BIGINT, DECIMAL, DATE, TIMESTAMP, STRUCT and LIST to plain JSON;
   the tool uses it. The consequence the agent sees: **integers arrive as
   strings**, to keep full precision. The tool description says so.

2. **Table naming is generated, not the design's list.** §4.3's list mixed
   prefixed with unprefixed names (`board`, `standings`, but `news_players`) and
   would have collided — `news/teams.json` against the `teams` collection. Every
   file is now `<directory>_<file>`, plus `teams` and `wpfl_*`. Uniform, cannot
   collide, and needs no code change when the artifact grows a body. The tool
   description tells the agent to list the tables rather than guess.

3. **There is no statement-timeout setting in DuckDB 1.5.5**, but
   `connection.interrupt()` exists, so the wall-clock timeout actually cancels
   the query rather than abandoning it.

### Open
- Nothing new. §15.4 is closed.

---

## Stage 9 — Runner (Phase 5) — `feat/ask-runner` — 2026-08-31 — DONE

Merged to `feat/ask` as **`08ccdbc`** (`--no-ff`); branch deleted.

### Changed
- `ask/concurrency.ts` — **new.** Semaphore and wall-clock deadline.
- `ask/hooks.ts` — **new.** Path guard, WebFetch allowlist, exception audit.
- `ask/systemPrompt.ts` — **new.** Static/dynamic halves and the as-of reader.
- `ask/askRunner.ts` — **new.** `query()` invocation and stream consumption.
- Tests: `concurrency` (10), `hooks` (28), `systemPrompt` (15), `askRunner` (21).

### The Grep-escape measurement — §15.5 NOT measured, and why

§15.5 asked whether `Read(//DATA_DIR/**)` *alone* blocks a Grep escape, or
whether the `PreToolUse` hook is the only control standing there. **This could
not be measured.** Answering it requires a live `query()` in which the model
actually attempts a Grep outside the data directory, and there is no Claude
credential on this box (§15.12). The permission evaluation happens inside the
Claude Code subprocess; there is no way to drive it without the model.

Recorded rather than guessed. What *is* established:

- The hook denies every escape vector, asserted in CI: an absolute path out, a
  `..` traversal, a relative climb, a `Grep` path outside, a `Glob` path
  outside, and a **symlink created inside the data directory pointing out of
  it** — the case that motivated resolving with `realpath` instead of
  normalising the string.
- Per the SDK documentation, a `PreToolUse` deny holds even in
  `bypassPermissions` and runs before every other permission step, so the hook
  cannot be undone by a configuration mistake elsewhere.

So the hook is load-bearing whatever the answer turns out to be; what remains
unknown is only whether the allow rule is *additionally* redundant. §15.5 stays
open, now bundled with §15.12 rather than with this phase.

### Verified

**The ledger survives every way a run can end.** query() is documented as
throwing *after* yielding an error result, so the design's original loop would
have taken down the handler and skipped the ledger write on precisely the runs
that most need recording. Three cases asserted: a clean success; a throw after
an `error_max_budget_usd` result, which keeps that result's cost (1.01) and
subtype and returns the partial prose; and a throw before any result at all,
which synthesises an `error_during_execution` row at cost 0 rather than losing
the run. A failing ledger write logs and still returns the answer.

**Cost comes from `total_cost_usd` and the model from `modelUsage`**, never from
`usage` — the docs are explicit that `usage` excludes subagent tokens.

**The security surface is pinned by test**, not by review: `permissionMode:
'dontAsk'`, `settingSources: []`, `strictMcpConfig: true`, `cwd` on the data
dir, the five-name `tools` allowlist, `Read(//DATA_DIR/**)` with its `//`
anchor, `mcp__wpfl__*`, both PreToolUse matchers registered, and an `env` with
no `DISCORD_TOKEN` and no `POSTGRES_URL` in it.

**The system prompt's static half is byte-identical** for two different callers
on two different dates, and carries none of the varying values.

**Green gate on `feat/ask` after the merge:** typecheck 0 · lint 0 · `npm test`
**698 passed / 30 suites** (was 624 / 26).

### Findings

1. **The SDK has a supported cache-boundary marker.**
   `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, passed as a standalone element of a
   `string[]` `systemPrompt`, gives blocks before it global cache scope. §5.1
   showed `systemPrompt` as a plain string with the static part merely written
   first. The marker is strictly better: the boundary is enforced by the SDK
   rather than by our ordering.

2. **`PostToolUse` does not fire for a tool that threw.** There is a separate
   `PostToolUseFailure` event, and it carries the error string directly. §4.1
   registered the audit on `PostToolUse` only, which would have recorded error
   *results* but silently missed outright failures. Both are now registered.

3. **A naive host suffix match would have let a lookalike through.**
   `espn.com.evil.io` ends with nothing on the list, but `notespn.com` ends with
   `espn.com` as a substring. The guard matches on a label boundary — `host ===
   allowed || host.endsWith('.' + allowed)` — and both cases are asserted.

4. **`typeof query` is not a usable seam.** The SDK's `Query` return type
   carries control methods (`interrupt`, `setPermissionMode`, …), so a plain
   async generator is not assignable to it and §5.3's "tests substitute a fake
   async generator" would not typecheck. `QueryFn` is declared as what the
   runner actually consumes: a function returning `AsyncIterable<SDKMessage>`.
   The real `query` still satisfies it.

5. **One test expectation was wrong and was corrected.** It asserted that 15
   September 2026 is NFL week 2. Labor Day is the 7th, so the season opens
   Thursday the 10th and the 15th is week 1. A second date was added so the test
   proves the week is computed rather than printed.

6. **The runner's tests need a credential in `process.env`.** `agentEnv()` runs
   before `query()` can be called, so with no credential the runner records a
   visible `error_during_execution` and writes the ledger — correct behaviour,
   now asserted as its own test, with the rest of the suite supplying a dummy
   key. Nothing in the suite reaches the network.

### Open

| # | Item | Resolves in |
| --- | --- | --- |
| 15 | §15.5 — whether the `Read` allow rule alone blocks a Grep escape. Needs a live `query()`, so it is blocked on the same missing credential as §15.12 | With a credential |

---

## Stage 10 — Discord surface (Phase 6) — `feat/ask-discord` — 2026-09-01 — DONE

Merged to `feat/ask` as **`e9f301f`** (`--no-ff`); branch deleted.

### Changed
- `ask/ticker.ts` — **new.** Ticker, edit throttle, Discord length splitting.
- `discordCommands/ask/ask.ts` — **new.** The command, routing, continuation,
  identity check.
- `index.ts` — `messageCreate` gains the continuation branch; `ready` gains the
  identity check and the first artifact sync.
- Tests: `ticker` (20), `askCommand` (18).

### Verified

**Every row of §6.1's routing table**, against hand-built stubs:

| Channel | Session | Result |
| --- | --- | --- |
| `GuildText`, `GuildAnnouncement` | — | new thread |
| `PublicThread` / `PrivateThread` / `AnnouncementThread` | live | in place, resuming it |
| thread | none | in place, fresh |
| thread | **closed** | in place, **fresh** — not resumed |
| `GuildVoice`, `GuildStageVoice`, `GuildForum`, `GuildMedia`, `DM` | — | in place |

The last row is the one that matters operationally: `startThread` throws
`MessageThreadParent` outside `GuildText` and `GuildAnnouncement`
(`node_modules/discord.js/src/structures/Message.js:1035`, read directly), so
anything else must never reach it.

**The command registers correctly through the repo's own loader rule.**
`discordCommands/ask/` contains exactly `ask.ts`, so `index.ts:78` selects it;
`isValidCommandModule` returns true; the built option is
`{type: 3, name: 'question', required: true, max_length: 1000}`.

**The identity check** resolves all 14 snowflakes, returns the canonical names
of any that fail, and warns loudly. Asserted that it checks 14 distinct ids.

**The ticker's throttle** sends the first update immediately, coalesces
everything inside the 1.5 s window down to the newest state, always flushes the
final state, and survives a failed edit — a rate limit must not stop the next
one.

**Green gate on `feat/ask` after the merge:** typecheck 0 · lint 0 · `npm test`
**736 passed / 32 suites** (was 698 / 30).

**`deploy-commands.ts` was NOT run.** `/ask` is not registered on the live
guild; that remains AJ's, per §17.5.

### Notes

- `answer()` takes a `User` rather than a `ChatInputCommandInteraction`, because
  the same path serves both `/ask` and a plain message continuing a thread.
- The session row is written before the ledger row, since `ask_usage` carries a
  foreign key onto `ask_sessions` — the constraint Stage 6 proved is enforced.
- `isAskThreadMessage` is a pure predicate so the `messageCreate` handler, which
  runs on every guild message, reaches the database only once the cheap checks
  pass.

### Open
- Nothing new. §15.8 (Discord thread permissions) is still unconfirmed on the
  live guild, but now degrades rather than breaks: a failed `startThread` is
  caught and the answer is posted in the channel instead.

---

## Stage 11 — Integration and handoff (Phase 7) — `feat/ask` — 2026-09-01 — DONE

Committed directly to `feat/ask`.

### Changed
- `.env.sample` — the two Claude credentials and `WPFL_DATA_DIR`.
- `README.md` — an `/ask` section, the new variables, `ask/` and `wpfl/` in the
  structure listing, command count 47 → 48.
- `CLAUDE.md` — `/ask` in the architecture summary, `ask/` and `wpfl/` in the
  feature-module list, the three new dependencies, the new background
  behaviour, command count 47 → 48.
- Prettier run over the files this branch touched.

### Final state

| | |
| --- | --- |
| Branch | `feat/ask`, 46 commits ahead of `main`, unmerged |
| Merges | six, all `--no-ff`; every slice branch deleted |
| Source files added | **21** — the 17 the design specifies, plus `constants/wpflMembers.ts`, `discordCommands/ask/ask.ts`, `migrations/009_ask_agent.sql`, `scripts/makeAskFixtures.ts` |
| `npm run typecheck` | **0** |
| `npm run lint` | **0** |
| `npm test` | **736 passed / 32 suites**, up from the 450 / 16 baseline |

Twelve new test suites, 286 new tests. Every module in §13.3's mandatory table
was committed red before green; the three carve-outs were written against
recordings taken from live calls.

`npm run format:check` still reports 76 files, exactly as it does on `main` —
this branch added none.

### The live smoke test — SKIPPED, no credential

Checked at this stage: `.env` carries neither `ANTHROPIC_API_KEY` nor
`CLAUDE_CODE_OAUTH_TOKEN`. Per §17.5's one conditional, the capped live
`query()` calls were skipped and the build did not wait for one. **The Agent SDK
integration has therefore never executed against a real model.** Everything
around it has: the tools, the SQL, the shred, the hooks and the runner are
covered by tests and by live calls to ESPN, the WPFL API and the artifact host.

What was verified instead, without a model: the whole module graph imports in
926 ms, all eight tools are reachable through the MCP server, and the options
`runAsk` hands to `query()` build exactly as specified —

```
model claude-opus-5 · effort high · permissionMode dontAsk
cwd /home/aboorde/wpfl-data · tools 5 · allowedTools 4
systemPrompt 3 parts, 3,766 bytes · hooks PreToolUse, PostToolUse, PostToolUseFailure
env exactly ANTHROPIC_API_KEY, ENABLE_PROMPT_CACHING_1H, HOME, PATH
```

**One thing to report plainly:** that dry run loaded the real `.env`, so
`recordUsage` issued an `INSERT` against the production database. It failed at
parse — `relation "ask_usage" does not exist` — so nothing was written, created
or altered. It does independently confirm that migration 009 has **not** been
applied. Unintended nonetheless; no further dry run was made with live
credentials loaded.

### Every open item in §15, reckoned

| # | Item | Status |
| --- | --- | --- |
| 15.1 | The subscription-auth question | **Open — AJ's.** Code stays agnostic; one env var on the host decides it |
| 15.2 | The ESPN fork's age | **Closed** in Stage 2. Fixed at `591ee59`, pinned, all four methods verified live |
| 15.3 | `npm install` must keep optional deps | **Verified here, standing note for the host.** Plain `npm install` pulled both native binaries on this box and both execute. `scripts/deploy.sh` uses plain `npm install`, which is correct — do not add `--omit=optional` |
| 15.4 | DuckDB lockdown semantics | **Closed** in Stage 8. Both settings real, both behave as assumed, verified including a refused read of `.env` |
| 15.5 | Whether the `Read` rule alone blocks a Grep escape | **Open, and not measurable here.** Needs a live `query()`. The hook denies every escape vector in CI and a `PreToolUse` deny is documented to hold even in `bypassPermissions`, so the hook is load-bearing either way |
| 15.6 | The SDK does not read `.env` | **Closed.** `index.ts:1` is `import 'dotenv/config'`, and `agentEnv()` reads `process.env`; confirmed in the dry run, where a key set in `process.env` appeared in the built subprocess env |
| 15.7 | Session transcript growth | **Open.** Mitigated by `cleanupPeriodDays: 7`; actual size is unmeasurable before real use |
| 15.8 | Discord thread permissions | **Open, but now degrades rather than breaks.** A failed `startThread` is caught and the answer posts in the channel instead |
| 15.9 | ESPN tools written against a 0-0 preseason | **Open until week 1.** Every score in every recording is 0, so `espn_boxscores` is verified for shape and not for scoring |
| 15.10 | The 2026 data gap | **Measured, no longer an assumption.** Every WPFL endpoint returns `[]` for 2026 and `draft_history` stops at 2025. Handled honestly: `INDEX.md`, the system prompt and the answer footer all state the as-of dates |
| 15.11 | Per-question cost is estimated, never measured | **Open.** Blocked on the credential |
| 15.12 | No Claude credential on the box | **Open — AJ's.** The build never waited on it |
| 14 | Session row must precede the ledger row (Stage 6) | **Closed.** `ask.ts` writes the session first; the FK was proven enforced |

### Open at handoff

Three items need a Claude credential (15.1, 15.5, 15.11, 15.12), one needs week
1 (15.9), one needs a week of real use (15.7), and one needs a guild check
(15.8). None of them block merging.

## Stage 12 — Adversarial review of `feat/ask` — `feat/ask` — 2026-09-01 — DONE

Not a build stage. A staff-level adversarial read of everything Stages 4–11
produced, against the design, the log, and ordinary practice — then the fixes,
each with tests. Eight commits, no merge: this ran directly on `feat/ask`.

The finding that matters most is structural rather than any single bug. **Every
defect worth the name sat where nothing could execute.** The suite was 736 green
against mocks, the typechecker was clean, and the feature would not have worked
on first contact — because the three things it depends on (the SDK's permission
model, a real Postgres, a real DuckDB parser) were all stubbed. Three of the
fixes below were found by reading a `.d.ts`, running one container, and running
one five-line script.

### Changed

- `ask/askRunner.ts` — `Grep` and `Glob` added to `allowedTools`; blanket
  `as Options` assertion dropped
- `migrations/009_ask_agent.sql` — `ask_usage.thread_id` foreign key removed,
  `idx_ask_usage_thread` added
- `wpfl/artifactSync.ts` — single-flight map, fetch deadline, existence check on
  the unchanged short-circuit
- `wpfl/sqlTool.ts` — newline-delimited row-cap wrapper, `DESCRIBE`/`SUMMARIZE`
  accepted, DuckDB connections closed on rebuild
- `wpfl/shredder.ts` — `safeName()` on every artifact-derived path component,
  plus a resolve-and-refuse check in the writer
- `wpfl/indexGenerator.ts` — a section for the cached WPFL decade
- `wpfl/espnTools.ts`, `wpfl/historyCache.ts` — `getCurrentNFLSeason()`
- `wpfl/wpflApiTools.ts` — response body shape check
- `ask/systemPrompt.ts` — `America/New_York` for the date and season
- `ask/ticker.ts` — `render()` capped to Discord's limit, `renderFull()` added
- `discordCommands/ask/ask.ts` — `onThreadArchived()`; `publish()` takes
  `renderFull()`
- `index.ts` — `Events.ThreadUpdate` wired
- `helpers/utils.ts` — `getCurrentNFLSeason()`, beside `getCurrentNFLWeek`
- `tests/ask/migration009.test.ts` — new; 49 tests added across nine suites

### Verified

**Grep and Glob were denied on every call.** `permissionMode: 'dontAsk'` is
documented in the SDK's own types as *"Don't prompt for permissions, deny if not
pre-approved"* (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1826`).
`tools` exposed five built-ins; `allowedTools` pre-approved three of them. So
every Grep and Glob the agent attempted was denied — and the JSONL shredding of
`league/dossiers` and `news/players` exists for no other purpose, INDEX.md says
"Grep this by player name" for both, and §10.2 built a path guard whose matcher
is `Read|Grep|Glob`. Four independent parts of the design pointed at a capability
the runner had switched off. Fixed by bare name, not path-qualified, because
§10.2 already records that `Grep(path)` rules are accepted but never consulted.
The regression test is general: every tool in `tools` must be pre-approved.

**The caps counted nothing.** `ask_usage.thread_id` carried a foreign key onto
`ask_sessions` (design §8, line 1091), but `runAsk` writes the ledger before the
Discord layer writes the session row. Reproduced on Postgres 16 in a throwaway
container, issuing the two inserts in the order the code issues them:

```
ERROR:  insert or update on table "ask_usage" violates foreign key constraint
        "ask_usage_thread_id_fkey"
DETAIL:  Key (thread_id)=(1410000000000000001) is not present in table "ask_sessions".
--- rows now in ask_usage ---
0
```

`writeLedger` catches and logs, so nothing surfaced. `checkCaps` counts rows in
that table, so the daily per-user and monthly league-wide limits both counted
zero — for every `/ask` from a text channel, which is all of them, since
`resolveTarget` always opens a fresh thread there. The design's `MAX_BUDGET_USD`
still capped a single runaway, but the two limits meant to bound the month did
nothing at all.

The fix is not to reorder. The ledger has to record a run that died before the
SDK emitted a session id, and there is no parent row to point at in that case.
**Design §8 is corrected**: an append-only accounting ledger does not take a
foreign key onto a mutable, prunable session table. Re-verified after the change
— both inserts land in the code's order, a crashed run with no session lands,
`checkCaps`' own daily query returns 1, and the migration still re-runs clean.

**`ensureFresh` could wedge permanently.** The unchanged branch touched INDEX.md
to restart the staleness window, but is only reached when INDEX.md is missing or
stale. Missing file plus matching `.etag` → `ENOENT` → the outer catch → `failed`
— and the etag still matched next time, forever. The bot would have answered
from a shred it could never replace, with nothing in the logs but a recurring
sync failure.

**DuckDB, measured rather than assumed** (`@duckdb/node-api` 1.5.5-r.4):

| Probe | Result |
| --- | --- |
| `SELECT * FROM (SELECT 1 AS a -- note) LIMIT 5` | `Parser Error: syntax error at end of input` |
| same, with newlines around the statement | `[{"a":1}]` |
| `SELECT * FROM (DESCRIBE t) LIMIT 5` | OK — returns `column_name`, `column_type`, … |
| `SELECT * FROM (SUMMARIZE t) LIMIT 5` | OK |

The row cap wraps the agent's statement in `SELECT * FROM (…) LIMIT n` on one
line, so any query ending in a `--` comment lost its closing paren and its
LIMIT. And the `sql` tool's own description told the agent to run `DESCRIBE
<table>` while `MUST_START_WITH` refused it — the documented move for "I don't
know this table's shape" was the one that always failed.

**The shredder wrote wherever the artifact told it to.** Body and key names went
from a network-fetched JSON document straight into `path.join`. Owner names were
slugged; nothing else was. The first draft of the escape tests *passed against
the unfixed code*, because keys are written as `<body>/<key>.json` and the body
directory absorbs the first `../`. Rewritten to bury the shred root several
levels deep and assert on every file anywhere under the sandbox: five tests, all
confirmed red against the previous shredder and green against this one.

**§6.2's session lifecycle did not exist.** `closeSession()` was written,
exported, and mocked in the tests — with no caller anywhere in the repo. Threads
auto-archive after a day and the SDK prunes transcripts after seven, so a
message in a week-old thread passed `resume: <deleted session>`; the run failed
rather than starting fresh, and the "context has aged out" line the design
specifies could never fire, because the flag driving it was never set. Both
`resolveTarget` and `continueThread` already handled `closed` correctly. Only the
event was missing.

**Two more that only a member would have seen.** The dynamic prompt built its
date with `toISOString()` (UTC) and its season with `getFullYear()` (host-local),
while `caps.ts` uses `America/New_York` — so after 8pm ET the agent was told
tomorrow's date and put it in a public source footer. And `render()` was
unbounded while being pushed into `message.edit()` on every stream event, so past
2,000 characters every remaining edit threw and the ticker froze for the rest of
the run. Capping it turned out to need care: `publish()` calls the same method
and continues long answers into follow-up messages, so a naive cap would have
truncated the final answer — hence `renderFull()`, with a test asserting a
5,000-character answer still splits into more than one message.

**Gates.** Read directly, never through a pager:

| | Before | After |
| --- | --- | --- |
| `npm run typecheck` | 0 | 0 |
| `npm run lint` | 0 (2 warnings) | 0 (0 warnings) |
| `npm test` | 736 passed / 32 suites | 785 passed / 33 suites |

`main` untouched at `61c2229`. Nothing pushed to any remote by this stage; the
branch push at the end of it was explicitly requested.

### Open

- **Still unmeasurable without a credential.** §15.1, §15.5, §15.11 and §15.12
  are unchanged — including whether the `Read` allow rule redundantly covers a
  Grep escape. Note that this stage found the allow rule was not merely
  redundant but *absent* for Grep, which makes the PreToolUse hook the only
  control that was ever protecting that path. It held.
- **An abandoned queue waiter would hold a slot forever.** `requestSlot()`
  increments `held` when a waiter is granted, whether or not anyone is still
  awaiting the promise. No caller abandons one today — `runAsk` always awaits —
  so this is latent, not live. Left alone rather than fixed speculatively.
- **`getCurrentNFLWeek` still returns 1 in January**, so the prompt will name the
  right season and the wrong week during the playoffs. Fixing it changes shared
  behaviour for `/median` and four other commands and is outside this branch.
- **Five commands still compute the season inline** as `getFullYear()`. The
  helper now exists next to `getCurrentNFLWeek` for them; they were not touched.
- Nothing here was executed against a live model. Every fix above is verified
  against the SDK's types, a real Postgres, a real DuckDB, or the test suite —
  none of it against a real `query()`.

---

## Stage 13 — the two lifetime races the cleanup review found — `feat/ask` — 2026-09-01 — DONE

Not merged yet; on `feat/ask`.

`/simplify` reported two things it could not fix inside its own remit, because
both are correctness rather than cleanup. They are the same defect twice:
shared readable state is replaced by overwriting a variable and destroying the
old value on the spot, with nothing recording that a reader is still inside it.

- `artifactSync.swap()` renamed the live shred aside and `rmSync`'d it while an
  agent whose cwd is that directory was still reading, for up to
  QUERY_TIMEOUT_MS.
- `sqlTool.build()` called `closeSync()` on the connection an in-flight
  `runSql` was reading through.

### Changed
- `ask/generations.ts` — NEW. `enter()` / `rotate(dispose)`: retiring a
  generation defers its teardown to its last reader and never blocks. That
  `rotate()` returns immediately is the load-bearing property — it is what
  makes it safe to call from inside the swap, and it is why coupling the swap
  to the concurrency semaphore (deadlock: `ensureFresh` runs before
  `requestSlot`) was the wrong answer.
- `wpfl/liveShred.ts` — NEW. The one process-wide generation for the shred, so
  readers do not import the fetch-and-swap machinery to say they are inside it.
- `wpfl/artifactSync.ts` — `swap()` retires instead of deleting, and sweeps
  `*.old-*` / `*.new-*` siblings it does not itself owe a teardown. Deferring
  the delete is what makes a sweep necessary: a crash mid-window used to strand
  nothing and now strands ~10 MB.
- `ask/askRunner.ts` — borrows the shred for the run, after the slot, released
  in the existing `finally`.
- `wpfl/sqlTool.ts` — `current` plus a generation, borrowed in the same
  synchronous step so the pair is atomic; `install()` retires the previous
  connection rather than closing it. `build()` also borrows the shred while it
  reads ~11 MB off disk.

### Verified
- **The rename was never the problem; the delete was.** A child process with
  its cwd on the directory read straight through `renameSync` — 4 reads,
  correct content, its own snapshot — and every read after `rmSync` was
  `ERROR ENOENT`. A cwd is a reference to the inode, not to the path.
- **`closeSync()` under an in-flight `runAndReadAll` is worse than an error.**
  Measured against DuckDB 1.5.5: it does not throw and the query does not
  reject — the promise never settles. `interrupt()` on the closed connection
  does not rescue it, and the stranded native thread then blocked process exit
  (probe killed at 30 s having reached `process.exit(0)`). In the bot that is
  one member's question wedged until QUERY_TIMEOUT_MS, holding one of the two
  concurrency slots, and a shutdown that hangs.
- Mutation, artifact sync: reverting `swap()` to the shipped `rmSync` turns
  both new directory tests red.
- Mutation, SQL: reverting `install()` to the shipped `close(previous)` turns
  the new test red at its 20 s timeout — the hang above, reproduced through the
  real code path.
- typecheck 0, lint 0, prettier clean, 808 tests / 34 suites (from 796 / 33).
- Nothing here was executed against a live model.

### Open
- A run reads its own directory generation by relative path while `readAsOf()`
  and the PreToolUse guard resolve the *live* path. Post-swap those are two
  different inodes, so a mid-run reshred can pair old file contents with new
  as-of dates. Not a breach — the guard's root string is unchanged — and not
  new. Fixing it means giving a run a generation-specific path rather than
  `ASK.DATA_DIR`.

---

---

## Stage 14 — Second adversarial review, with AJ — `feat/ask` — 2026-09-02 — IN PROGRESS

Not a build stage. A second adversarial read of the whole branch, this time as
an interview: every finding put to AJ as one question with a recommendation,
each recommendation attacked on request before AJ confirmed it, decisions
resolved in dependency order. Nineteen decisions. Two recommendations reversed
under their own review (3 became hygiene rather than a defect; 18 was dropped).
A Claude credential was provided for this stage, so it also carries the
branch's first live `query()` calls.

### The probe that ran before any fix

`Glob` with pattern `/etc/host*` and no `path`, through the shipped hook, via
`runAsk` directly (the ledger insert failed on the unapplied migration, as
expected, and was logged):

```
RESULT: /etc/avahi/hosts /etc/nvme/hostnqn /etc/nvme/hostid /etc/hostname
        /etc/host.conf /etc/hosts /etc/ansible/hosts
success · 2 turns · 3,593 ms · $0.0826 estimated
```

So §15.5 closes measured rather than assumed, and not the way the design hoped:
the hook inspected only `path` and `file_path`, and the CLI's Glob honours an
absolute pattern. Names, not contents — a Read of anything it found is still
denied — but an agent that can list the host is not what §10.2 promised. It
was also the first proof that the auth, the permission configuration, the
hooks and the built-in tools work together on a real model. The ticker's
`[settled]` fired before the Glob result arrived, confirming decision 6.

### Decisions (the design sections each rewrites are in parentheses)

1. Credential in `.env` on the dev box; live runs after the fixes, except the
   probe above.
2. All eight MCP tools always loaded via the server-level `alwaysLoad`; the
   per-tool flags deleted. The docs advise upfront loading under ten tools and
   say deferral costs a round trip; the design had that backwards (§4.2).
3. `DATA_DIR` resolved absolute with `~` expanded; the Read rule built as `//`
   plus the path without its leading slash. The CLI's parser drops one
   character after `//` and normalises, so `///home/…` worked by accident;
   hygiene, plus a real fix for a `~/` override (§10.2).
4. Migration renamed `014_ask_agent.sql`; two 009s existed (§8, §17.6).
5. Per-thread serialisation inside `answer()`, ahead of the global slot, depth
   cap two, a waiting line on the ticker (§5.3, §6.2).
6. Ticker steps settle on the matching `tool_result`, by `tool_use` id; ✗ with
   a one-line reason on `is_error`; `assistant` is no longer a signal (§5.3).
7. `deferReply()` before the session lookup and cap check; refusals delete
   the placeholder and follow up ephemerally (§6.1).
8. `{ parse: [] }` on every `/ask` send and edit that carries foreign text;
   refusal replies untouched (§6.3).
9. Glob's pattern treated as a path: containment on its static prefix, `~` and
   `..` denied (§10.2).
10. The NFL week from `helpers/espnPeriod.ts`, resolved once per run, stated
    with its source; tools default through `resolvePeriod` (§5.2, §4.2).
11. The decade cache refreshes on its own twenty-four-hour window, decoupled
    from the artifact etag; the index reports each source's season and week
    extents; every literal year removed from prompt, index and descriptions.
    Evidence for in-season loading: commit `c95de89`, 2025-11-04, bumped
    `/ewins` and `/optimal` to 2025 mid-season (§3.7).
12. `ask_usage.counted` and `ask_usage.error`; a run is uncounted when no
    session id was observed or an assistant message carried one of the six
    ops-failure codes; caps count counted rows; a `ready` log line and an
    early "not configured" refusal; six member-facing error lines (§6.4, §9).
13. A message continues a thread when it mentions the bot, replies to it, or
    comes from the opener in a bot-created thread; replies to people never
    do; `ask_sessions.bot_thread`; bind everywhere; one hint on a thread's
    first answer (§6.2).
14. Exact pins on the SDK and DuckDB; `@modelcontextprotocol/sdk` a direct
    dependency; the fork at `b8c2e61` returns real team and owner names, so
    §4.2's "only mapping available" is rewritten; no owner cross-check.
15. Opus 5 at `high`, summarised thinking, unchanged.
16. 👍/👎 buttons with in-place counts; `ask_feedback`; `ask_usage.message_id`.
17. `/ask-admin` with `status`, `resync`, `usage`, `pause`, `resume`, gated by
    `Administrator` on the builder; `force` on `ensureFresh`.
18. No elapsed time on answers. Duration stays in the ledger and `usage`.
19. Nothing returns from the out-of-scope list. Follow-ups recorded below.

### Changed
- (filled in as the work lands)

### Verified
- The Glob probe above.

### Follow-ups, deliberately not built here
- `private` answers: an ephemeral mode for strategy questions. First follow-up.
- Same-author coalescing in the per-thread queue.
- A client-wide `allowedMentions` default for the other commands.
- An ESPN `ownerName` cross-check in the startup identity check.
- A migration tracking table for the whole repo.
- `maxTurns` as a third bound, if the ledger ever shows a run that needed it.

### Open
- (filled in at the end)

---

<!--
Template for new entries:

## Stage N — <name> (Phase X) — `<branch>` — YYYY-MM-DD — STATUS

Merged to `feat/ask` as <merge SHA>.

### Changed
- files added/modified, one line each

### Verified
- what was actually run and what it returned. Measurements, not assumptions.
- typecheck / lint / test exit codes, and the test count before and after.
- if a design-doc claim turned out wrong, say so plainly and note the doc edit.

### Open
- what this stage leaves unresolved, and which stage resolves it
-->
