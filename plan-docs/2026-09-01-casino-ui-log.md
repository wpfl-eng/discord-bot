# Casino UI & Game Depth — Execution Log

**Design doc:** [2026-09-01-casino-ui-design.md](./2026-09-01-casino-ui-design.md)
**Branch:** `new-feats`
**Base commit:** `03467bd` refactor(casino): remove dead state, dedup renderers, cut per-click queries

This log is append-only. Newest entries at the bottom of each section.

---

## Phase 0 — Research & Interview

**Status:** IN PROGRESS

### 2026-09-01 — Research

- Read `package.json`; confirmed `discord.js@14.27.0` installed (`^14.15.2` in manifest,
  14.27.0 resolved).
- Enumerated available builders from `node_modules/@discordjs/builders/dist/index.d.ts`.
  Found `LabelBuilder`, `RadioGroupBuilder`, `CheckboxGroupBuilder`, `FileUploadBuilder`,
  `SectionBuilder`, `MediaGalleryBuilder`, `ThumbnailBuilder`, `FileBuilder` all present.
- Read the `ComponentType` enum at
  `node_modules/discord-api-types/payloads/v10/message.d.ts:1071` for authoritative
  type numbers and modal/message applicability.
- Cross-checked against Discord's live component reference and 2026 developer changelog.
  Radio/Checkbox/Label modal components shipped early 2026; `ActionRow`-wrapped
  `TextInput` in modals is deprecated in favour of `Label`.
- Confirmed by grep that none of the newer builders are referenced anywhere in
  `discordCommands/ economy/ interactions/ emoji/ helpers/`.
- Audited all three games: read `blackjackRender.ts`, `rouletteRender.ts`,
  `crapsConfig.ts`, `craps.ts`, `crapsState.ts` (embed builders), `index.ts`,
  `interactions/componentRouter.ts`, `interactions/renderedMessage.ts`,
  `emoji/emojiRegistry.ts`.
- Confirmed craps has no renderer module, no router registration, and no tests.
- Confirmed roulette `ALL_BET_TYPES` contains no inside combination bets.
- Read `blackjackUtils.TABLES`: only `deckCount` and `dealerHitsSoft17` differ between
  the two tables; every other rule is fixed in the engine.
- Read `blackjackEngine.ts`: blackjack pays 3:2 (`bet * 2.5`, line 249), surrender
  returns half (line 225), DAS allowed, split aces get one card, `MAX_HANDS` = 4.

**No source files modified during research.**

### 2026-09-01 — Interview

| Q | Question | Answer |
|---|---|---|
| D1 | Scope of the effort | All three games, UI + game depth |
| D2 | Shared UI foundation vs self-contained | Extract shared layer first, back-port roulette + blackjack |
| D3 | Interaction model to converge on | Public board + private ephemeral panel, all three |
| D4 | Blackjack structure | One table, multi-seat (reworked, not restyled) |
| D5 | Blackjack turn model | Simultaneous action, one shared round clock |
| D6 | Blackjack ruleset | 6 deck, S17, persistent shoe, 3:2 |
| D7 | Action surface | Shared action row on the public board |
| D8 | Seat count | Unlimited |
| D9 | Board layout under unlimited seats | Two-zone: acting full, settled collapsed |
| D10 | Buy-in loop | Chips + Sit; stake rides until changed or stood up |
| D11 | Blackjack side bets | Both 21+3 and Perfect Pairs |

| D12 | Craps depth | All but come/don't come: odds, place, hardways, props |
| D13 | Craps input | Phase-contextual board, rows swap by phase |
| D14 | Craps shooter | Shooter throws, rotates on seven-out, auto-roll fallback |

| D15 | Roulette inside bets | Number-anchored panel |
| D16 | Roulette bet board | Player totals + biggest action |
| D17 | Art strategy | Emoji inline, sharp hero images once per round |
| D18 | Channels | Per-game channels + casino hub board |
| D19 | Durability across restarts | Persist between rounds; mid-round refunded by sweep |
| D20 | Modal components | Adopt Label / RadioGroup / CheckboxGroup where they fit |
| D21 | Animation pacing | Adaptive to money at risk |
| D22 | Build sequencing | Foundation, craps, roulette, blackjack, polish |
| D23 | Testing expectation | TDD for money math; existing pattern elsewhere |
| D24 | Slash commands | Kept as power-user paths, extended to new bet types |

**Interview complete at D24.** Full phase plan written to the design doc, section 6.

Confirmed `migrations/` runs to `009_widen_economy_money_columns.sql`, so new migrations
start at 010. `008_remove_nflmon_rob_training.sql` remains deliberately unapplied per
CLAUDE.md and is untouched by this plan.

**Blackjack complete at D11. Craps complete at D14. Roulette complete at D16.**
Cross-cutting decisions run from D17.

Verified channel wiring by grep: `ROULETTE_CHANNEL_ID` and `CRAPS_CHANNEL_ID` are read
in their configs; `ECONOMY_CASINO_CHANNEL_ID` is defined in `.env.sample` and mapped at
`economyConfig.ts:270` but otherwise unused. Blackjack has no channel gate.

Read `crapsState.ts:641` to confirm the shooter is assigned once at table open and never
rotates; `executeRoll` is driven purely by the betting timer, so the shooter has no
agency today.

**Course correction at D4.** I initially framed D3's answer as ruling multi-seat
blackjack out, and was about to ask what a non-table "public board" for blackjack
should show. The user corrected this: the two are orthogonal — D3 chose the *pattern*,
and blackjack being multi-seat is a separate call. Blackjack is to be reworked into one
shared multi-seat table. The question about a presence/history board was withdrawn
before being answered.

Interview ongoing. Implementation has **not** started and will not start until the user
confirms shared understanding.

---

## Adversarial review

**Status:** COMPLETE — see design doc section 9

Seven problems found and resolved in the plan before implementation:

| # | Finding | Severity |
|---|---|---|
| R1 | Craps ends the shooter session on every come-out decision (pre-existing rules bug); D14 cannot work without fixing it | HIGH |
| R2 | Odds bets are not expressible in the flat `CrapsBet` model | HIGH |
| R3 | `EscrowGame` union excludes craps (TS-only fix, no migration) | MEDIUM |
| R4 | Plan risked changing `formatCurrency`, used by 24 files | MEDIUM |
| R5 | `update()` vs debounce conflated; interaction paints cannot be debounced | MEDIUM |
| R6 | Escrow await is an interleaving point; no serialization stated | MEDIUM |
| R7 | Plan scheduled persistence (P4) after the phase depending on it (P3) | LOW |

Also recorded: schema width constraints, the compact roulette bet-key scheme they force,
and an explicit statement that the rendered UI cannot be verified in this environment.

---

## Phase 0 — Shared foundation

**Status:** COMPLETE

Created:

| File | Purpose |
|---|---|
| `casino/casinoTheme.ts` | `CASINO_COLORS` named palette, `resultAccent`, `bar` |
| `casino/casinoFormat.ts` | single `formatAmount`, `formatSigned`, `plural`, `relativeTime` |
| `casino/casinoRender.ts` | `frame` / `text` / `separator` / `button` / `row` / `section` / `rendered`, plus `BUDGET` and `assertWithinBudget` |
| `casino/casinoPaint.ts` | `createPainter` (timer-driven, coalesced) and `paintViaInteraction` / `whisper` (interaction-driven) — the R5 split |
| `tests/casino/casinoFormat.test.ts` | includes an identity test proving roulette and craps now share one implementation |
| `tests/casino/casinoRender.test.ts` | row cap, V2 flags, mention suppression, budget guards, theme |

Modified:

- `discordCommands/blackjack/blackjackRender.ts` — ported onto `casino/`; local `ACCENT`
  now maps onto `CASINO_COLORS`. Blackjack's push-is-blue kept deliberately (craps uses
  purple); unifying that is a design change, not a refactor.
- `discordCommands/roulette/rouletteRender.ts` — ported; removed the orphaned
  `/** Who opened the table */` comment.
- `discordCommands/roulette/rouletteConfig.ts` — `EMBED_COLORS` deleted; `formatAmount`
  now re-exported from `casino/casinoFormat.ts`.
- `discordCommands/craps/crapsConfig.ts` — `formatAmount` re-exported. `EMBED_COLORS`
  retained until Phase 1 rewrites `crapsState`.

**Verification:** `npm test` 664 passed / 29 suites; `npm run typecheck` clean;
`npx eslint` clean on all touched paths. The 640-test baseline passed unchanged before
the new casino tests were added, which is the evidence the port altered no behaviour.

Note: running bare `npx jest` fails 8 suites with a top-level-`await` SyntaxError. That is
not a regression — those suites need `NODE_OPTIONS=--experimental-vm-modules`, which
`npm test` sets. Always use `npm test`.

Planned: `casino/casinoTheme.ts`, `casinoFormat.ts`, `casinoRender.ts`, `casinoPaint.ts`;
port `rouletteRender.ts` and `blackjackRender.ts`. Pure refactor — existing render tests
must pass unchanged.

---

## Phase 1 — Craps

**Status:** COMPLETE

Craps went from an embed-and-autocomplete game with 5 bet types to a Components V2
board with 20.

**Created**

| File | Purpose |
|---|---|
| `discordCommands/craps/crapsRender.ts` | V2 phase-contextual board, slip |
| `casino/casinoPacing.ts` | D21 adaptive pacing (see deviation below) |
| `casino/casinoModal.ts` | D20 `Label` / `RadioGroup` / `CheckboxGroup` modals |
| `migrations/010_craps_bet_expansion.sql` | new stats columns, bet_type length constraint |
| `tests/craps/crapsPayouts.test.ts` | 105 assertions, written before the engine |
| `tests/craps/crapsRender.test.ts` | budget, phase rows, shooter, board scaling |

**Rewritten**

- `crapsConfig.ts` — 5 bet types to 20. Odds tables, place targets, hardway targets,
  prop winners, 3-4-5x caps, `endsSession`, dice/puck emoji lookups.
- `crapsEngine.ts` — resolution for every new family; `parentBetId` / `oddsPoint` on
  `CrapsBet`; `canPlaceOdds`; `canTakeDown`; **R1 fix** — only a seven-out ends a session.
- `crapsState.ts` — embeds to `RenderedMessage`, escrow-backed stakes, shooter rotation
  with a ROLL button and grace fallback, coalesced painting, session bet log.
- `craps.ts` — `registerComponentHandler('cr:')`, phase-aware autocomplete over all 20
  bets, chip modal, odds `RadioGroup` modal, slip / rebet / undo / take-down.

**Rules corrected while implementing** (beyond R1)

- Place bets now ride through a point hit instead of being returned, and sit off during
  a come-out. The old code pushed them back on a point hit, which is not how a craps
  table works.
- The pass line is now a contract bet: it cannot be taken down once a point is on.
  Everything else, don't pass included, comes down freely.

**Art** — `scripts/buildEmoji.ts` now renders 103 tiles (was 91): 6 dice faces with
proper pip layouts, 2 point pucks, 4 chip denominations. Verified by eye, not just by
the ink heuristic — the heuristic counts a light card face as ink and would not have
caught a blank die.

**Verification:** `npm test` 786 passed / 31 suites; typecheck clean; `npx eslint .`
clean. Migration 010 is written but NOT applied — this repo has no runner.

---

## Phase 2 — Roulette

**Status:** NOT STARTED

---

## Phase 3 — Blackjack multi-seat

**Status:** NOT STARTED

---

## Phase 4 — Hub, hero images, polish

**Status:** NOT STARTED

---

## Deviations from plan

None yet.

---

## Verification record

| Date | Check | Result |
|---|---|---|
| — | — | — |
