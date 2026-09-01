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
| 8 | 4 | `feat/ask-sql` | SQL and MCP — DuckDB, statement guard, `mcpServer` | NOT STARTED |
| 9 | 5 | `feat/ask-runner` | Runner — system prompt, `askRunner`, concurrency, hooks | NOT STARTED |
| 10 | 6 | `feat/ask-discord` | Discord surface — `/ask`, threads, ticker, continuation | NOT STARTED |
| 11 | 7 | `feat/ask` | Integration and handoff — docs, full suite, conditional smoke test | NOT STARTED |

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

## Stage 8 — SQL and MCP (Phase 4) — `feat/ask-sql` — NOT STARTED

_Should record: **the DuckDB lockdown finding (§15.4)** — the actual setting names
in the installed version and whether they behave as §4.3 assumed, or plainly that
they do not; the rejected-statement table; a real cross-source join and its rows;
that eight tools register with three `alwaysLoad`._

---

## Stage 9 — Runner (Phase 5) — `feat/ask-runner` — NOT STARTED

_Should record: **the Grep-escape measurement (§15.5)** — whether
`Read(//DATA_DIR/**)` alone blocks it or the hook is the only control standing
there; that a throwing generator still writes the ledger row; the ticker output
for a scripted stream including `thinking_delta`._

---

## Stage 10 — Discord surface (Phase 6) — `feat/ask-discord` — NOT STARTED

_Should record: each branch of design §6.1's routing table exercised against
stubs; the startup identity check's behaviour on an unresolvable snowflake;
confirmation that `deploy-commands.ts` was **not** run._

---

## Stage 11 — Integration and handoff (Phase 7) — `feat/ask` — NOT STARTED

_Should record: final test count against the 450 baseline; every §15 open item
that closed and what closed it, and every one that did not; whether the live smoke
test ran or was skipped for want of a credential, and if it ran, the **measured**
per-question cost against the $0.13–0.16 estimate; the handoff command list._

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
