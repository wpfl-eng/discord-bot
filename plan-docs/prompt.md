Build the WPFL `/ask` agent to completion.

<mission>
`/ask` is a Discord slash command that answers open-ended questions about the WPFL
fantasy football league, running on the Claude Agent SDK. It is fully specified —
your job is to build it, test-first, on a branch, and to leave a written record of
what you actually verified.

Work through it end to end. Do not stop after the first slice to check in.
</mission>

<authoritative_documents>
Read all three of these in full before you write any code. They are in this repo.

1. **`plan-docs/2026-08-31-ask-agent-design.md`** — the specification. 17 sections.
   This is what to build and why. Where this prompt and the design doc disagree
   about the *product*, the design doc wins. Where they disagree about *how to run
   the build*, this prompt wins.

2. **`plan-docs/2026-08-31-ask-agent-log.md`** — how the work reached this point.
   Stages 0–3 are done and are context, not instructions. You write Stages 4–11.

3. **`CLAUDE.md`** — the repo's standing rules. The ones that bite here: explicit
   types on every parameter, variable and return; fix root causes rather than
   working around them; never replace an existing component with a simplified
   version; state plainly when you could not read something completely.

Never make a claim about this codebase without opening the file first. If the
design doc references `discordCommands/ewins/ewins.ts:43` or `index.ts:78`, read
those lines rather than trusting the quotation.
</authoritative_documents>

<state_of_the_repo>
- `main` is at `eb32b4d`, with **450 tests passing across 16 suites**. That is the
  baseline every merge is measured against.
- `main` carries one unpushed commit. Leave it alone.
- The ESPN dependency work is already done: pinned to fork `591ee59`, verified
  against the live 2026 league. Do not redo it.
- `plan-docs/` is currently untracked. Its first commit is yours (step 1 below).
- `.env` has ESPN, Postgres and Discord credentials. It has **no**
  `ANTHROPIC_API_KEY` and **no** `CLAUDE_CODE_OAUTH_TOKEN`.
- No test database exists. `POSTGRES_URL` in `.env` is the production database.
</state_of_the_repo>

<how_to_start>
In order:

1. `git checkout -b feat/ask` from `main`. Commit the three plan-docs files —
   design, log, and this prompt — as `docs(ask): design, log and build prompt`.
   They must be tracked, because the log is the build's only progress file and
   log entries are commits.
2. Read the three documents above.
3. Install the dependencies in design §12, then confirm the native binaries for
   `@anthropic-ai/claude-agent-sdk` and `@duckdb/node-api` actually landed on this
   platform. If they did not, that is a blocker — say so rather than proceeding.
4. Build Phase 0 (design §14) directly on `feat/ask`. Write Stage 4 in the log,
   commit it, and move on.
5. Then the six slices, in the order design §14 gives, each on its own branch.
</how_to_start>

<tdd>
Every module in design §13.3's mandatory table is written test-first: a failing
test that expresses one behaviour, then the smallest change that makes it pass,
then cleanup with the test still green. Commit the red test and the green
implementation separately — `test(ask): …` then `feat(ask): …` — so the trail
shows the order actually happened.

Design §13.3 also names three carve-outs — the WPFL API tools, the ESPN tools, and
`discordCommands/ask/ask.ts` — where a real response or a stub is recorded first
and the test is written against that recording. Red-green applies from that point
on. The carve-out is about which step comes first, not about skipping tests.

Two rules with no exceptions:

- **Never delete, weaken, skip, or `.only`-around a failing test to make the build
  green.** If a test is genuinely wrong, fix it as its own commit with its own
  stated reasoning. Silently loosening an assertion to get past a gate is the one
  failure mode that makes the whole suite worthless as a progress signal.
- **Implement the general behaviour, not the assertion.** Tests verify
  correctness; they do not define the solution. Code that satisfies the fixture
  and nothing else has failed even when the suite is green. Do not special-case
  test inputs, and do not write helper scripts to get around a hard piece of work.

Follow the repo's existing test idioms rather than inventing a third — parameter
injection as in `tests/standings.test.js`, and `jest.unstable_mockModule` plus
dynamic import as in `tests/services/achievementService.test.ts`. `askDb` is
always mocked; **no test touches the real Postgres**.

If part of the design turns out to be untestable as written, or a test you wrote
turns out to be asserting the wrong thing, say so explicitly and fix it in the
open. Do not work around it quietly.
</tdd>

<branches_and_merges>
`feat/ask` is the integration branch. Six slices hang off it, named exactly:

```
feat/ask-data          fixtures + generator, artifactSync, shredder, indexGenerator, historyCache
feat/ask-persistence   migration 009, askDb, caps
feat/ask-tools         wpflApiTools (3), espnTools (4)
feat/ask-sql           sqlTool, mcpServer          (needs data)
feat/ask-runner        systemPrompt, askRunner, concurrency, hooks   (needs tools + persistence)
feat/ask-discord       ask.ts, threads, ticker, messageCreate branch, identity check   (needs runner)
```

Cut each from the current `feat/ask`, not from `main`. Merge it back with:

```bash
git checkout feat/ask
git merge --no-ff feat/ask-data -m "Merge branch 'feat/ask-data' into feat/ask"
git branch -d feat/ask-data
```

`--no-ff` because this repo merges branches that way (`git log --merges` shows
`Merge branch 'feature/trivia-improvements'`), and because each log entry cites
its merge SHA — a fast-forward would leave those citations pointing at nothing.

Commits use the repo's conventional style with a scope: `feat(ask):`,
`test(ask):`, `fix(ask):`, `docs(ask):`, `chore(ask):`.
</branches_and_merges>

<green_gate>
Nothing merges unless all three are clean, in this order:

```
npm run typecheck     # exit 0
npm run lint          # exit 0
npm test              # 0 failures, and the test count has gone UP
```

Read the exit codes directly. Do **not** pipe these into `head` or `tail` and then
check `$?` — that reports the pager's status, not the build's, and it produced a
confident false "EXIT=0" on an actually-failed build earlier in this project.
Redirect to a file if you need to page the output.

A merge that leaves the count at 450 means the slice shipped untested code. A
merge that lowers it means a test was removed.
</green_gate>

<the_log>
Write one Stage entry immediately after each merge — not batched at the end. The
log is the only progress file: there is no `tests.json`, no `progress.txt`, no
scratch status file. Three things that already exist describe the state
completely, and none of them can go stale: the log's last entry,
`git log --oneline main..feat/ask`, and `npm test`.

Each entry follows the template at the bottom of the log file: the stage heading
with its branch, the merge SHA, then **Changed** / **Verified** / **Open**. Update
the phase-status table in the same edit, and commit the log as part of that stage.

**Verified means measured.** Record what you ran and what came back — exit codes,
row counts, byte sizes, response shapes, test counts before and after. Not "tests
pass". If a design-doc claim turned out to be wrong, say so plainly in the entry
and edit the design doc to match; the design doc always describes current intent,
the log describes how it got there. Each stage's skeleton in the log already names
the specific things that stage is expected to record — Stage 8 owes the DuckDB
lockdown finding, Stage 9 owes the Grep-escape measurement.
</the_log>

<boundary>
In bounds, no permission needed: creating and merging `feat/ask*` branches;
committing to them; read-only network calls (the published artifact, the WPFL API,
ESPN with the credentials already in `.env`, documentation on the web); writing
the shred and the WPFL cache into `ASK.DATA_DIR`; installing the dependencies in
design §12; running typecheck, lint and the suite.

Out of bounds — these are AJ's, and the handoff report tells them to do it:

| Never | Why |
| --- | --- |
| Check out or commit to `main` | It already carries an unpushed commit; the merge is reviewed, not assumed |
| `git push`, any remote, any branch | Pushing `main` is what `scripts/deploy.sh` acts on — it reaches the live bot |
| `npx tsx deploy-commands.ts` | Registers slash commands on the live Discord guild |
| Apply `migrations/009_ask_agent.sql` | Writes to the production database |
| Touch `../draft-2026` | A different repo; the pre-launch re-publish is AJ's ritual |
| `push --force`, `reset --hard`, `--no-verify`, deleting unmerged branches | Destructive or history-rewriting |

**One conditional.** At Stage 11, check for `ANTHROPIC_API_KEY` or
`CLAUDE_CODE_OAUTH_TOKEN`. If present, run **at most three** live `query()` smoke
calls with `maxBudgetUsd` set, and record the measured per-question cost against
the design's $0.13–0.16 estimate. If absent, record "skipped, no credential" and
continue — do not wait for one, and do not ask for one mid-build.

When you hit an obstacle, do not reach for a destructive shortcut. Do not discard
unfamiliar files, bypass a hook, or delete a branch to get unstuck.
</boundary>

<escalation>
Run straight through all seven phases. Stop early only for one of these, and when
you stop, say which one and what you need:

1. A green gate you cannot make green after a real attempt at the root cause.
2. Something you measure that contradicts the design doc in a way that changes
   what should be built — not a detail you can correct in the doc and note in the
   log, but a load-bearing assumption that turns out to be false.
3. A decision where different readings would lead to materially different work,
   and the design doc does not settle it.
4. A dependency that will not install, or a native binary that is not there.

Everything short of that is a routine judgment call. Make it, note it in the log,
and keep going.
</escalation>

<working_style>
- **Deliver the scope asked for.** Build what design §14 specifies for the slice
  you are on. Do not add features, extra configurability, or "improvements"
  outside it. If you think something in the design is wrong, say so in a sentence
  and continue with the task as specified rather than quietly reshaping it.

- **Keep it minimal.** No abstraction without a second caller. No helper for a
  one-time operation. No error handling for states that cannot occur — validate at
  the boundaries (user input, external APIs, the artifact) and trust our own code
  in between. No comments on code you did not change, and comments only where the
  logic is not self-evident. The build-readiness review already cut this design
  from 20 files to 17 and from 9 tools to 8 on exactly these grounds; do not spend
  that back.

- **Delegate only for research.** Write all the code yourself, sequentially. You
  may spawn read-only subagents for bounded investigations — reading Agent SDK
  documentation for hook signatures, confirming DuckDB's lockdown setting names,
  checking discord.js typings — so large doc dumps stay out of your context. Do
  not delegate implementation, do not use a subagent to check your own work, and
  do not run the six slices in parallel: they share `feat/ask` and the test suite.

- **Parallelize tool calls, not agents.** When several reads or searches are
  independent, issue them together. When one depends on another's result, do not.

- **Report briefly.** Say in one sentence what you are about to do before starting
  a slice. While working, speak up when you find something important or change
  direction. When a slice lands, lead with the outcome — what merged, what the
  test count is now, what you measured. Keep it short; the log is where the detail
  goes.

- **Your context will be compacted as it fills.** Do not wrap up early or narrow
  the work because of remaining tokens. Before context runs low, make sure your
  progress is committed and the current stage's log entry is written, so a fresh
  window can reorient from the log, `git log --oneline main..feat/ask`, and
  `npm test`.
</working_style>

<definition_of_done>
`feat/ask` is done when all of these are true:

1. All seven phases of design §14 are built, and all six slices are merged into
   `feat/ask` with `--no-ff`.
2. `npm run typecheck`, `npm run lint` and `npm test` are clean on `feat/ask`, and
   the test count is well above 450.
3. Every module in design §13.3's mandatory table has tests that were written
   before it, and the three carve-outs have tests written against recordings.
4. Log Stages 4 through 11 are written, each with its branch, its merge SHA, and
   real measurements under **Verified**.
5. Every open item in design §15 is either closed — with the log saying what
   closed it — or explicitly still open, with the reason.
6. `.env.sample`, `README.md` and `CLAUDE.md`'s command count are updated.
7. Nothing on the out-of-bounds list has happened.

Then give AJ a handoff report: every branch and its merge SHA, the final test
count against the 450 baseline, what closed and what did not, and the exact
commands to run next — migration, credential, merge, push, `deploy-commands`, and
the `draft-2026` re-publish.
</definition_of_done>

Start with step 1 of `<how_to_start>`.
