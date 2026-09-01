# Casino tables: why all three games stopped working

**Date:** 2026-09-01
**Symptom reported:** "None of the buttons are working or allowing the games to start or
progress. In blackjack, I can somewhat sit, but the timer goes from a countdown to a
count up and the session remains in a broken state."

---

## The cause

`wager_escrow` did not exist in the database.

Confirmed directly, by querying `information_schema.tables` against the database in
`.env` — the same one the live bot uses, evidenced by a `casino_table_state` row for
`blackjack` written at `2026-09-01T18:31Z`. Migrations `010`–`013` were all applied
(`craps_stats.odds_bets`, `blackjack_stats.p3_bets`, `casino_table_state` all present).
Only escrow was missing.

Every wager in all three games goes through `escrowDb.openEscrow`, which writes to that
table inside the same transaction as the wallet debit and **rethrows** on failure
(`economy/escrowDb.ts:115-117`). No coins were ever lost — the debit rolled back with
the insert — but no wager could be placed either.

### Why it went unnoticed

`sql/escrow.sql` defines the table. `/sql` has no runner and no tracking, and escrow was
never turned into a numbered migration, so it sat unapplied while everything in
`/migrations` landed. `CLAUDE.md` documents the migration situation carefully and says
applied-state is only knowable by inspecting the schema — but it describes `/migrations`
only. `/sql` is the same hazard with none of the warning.

Fixed by running `npx tsx scripts/runMigration.ts sql/escrow.sql`, which the runner
accepts since it takes any path.

---

## Why one missing table wedged the games instead of costing a round

Four structural faults turned a recoverable error into permanently stuck tables.

### 1. Timer callbacks were fire-and-forget

Every phase advance was reached from `setTimeout(() => void advance())`. A timer callback
has nobody to return an error to, so a throw became an unhandled rejection.

The blackjack path is the clearest. `closeSeating` sets `phase = 'dealing'` and
`deadline = null`, then charges each seat. `chargeSeat` threw on the missing table. By
then the phase had changed, the window timer was cleared, and **nothing had repainted** —
so the board went on showing the last `betting` frame, whose `<t:…:R>` deadline had
passed. Discord renders a passed relative timestamp as time elapsed, which is the
countdown "going from a countdown to a count up". No timer remained to move it on.

Fixed by `casino/casinoRecovery.ts`: every advance runs through a guard that logs, calls
the game's own recovery, and re-arms the table.

### 2. Recovery has to be phase-aware, or it double-pays

The obvious recovery — void the round's escrow — is wrong in one window. Both
`finishRound` (`blackjackState.ts`) and `settleResolution` (`crapsState.ts`) credit
wallets *before* calling `settleEscrowIds`. A throw in between leaves rows that are paid
but still `open`; voiding one returns a stake that has already been paid out.

Each game therefore tracks `settlementStarted` and exposes the rule as a predicate
(`canVoidRound`, `canVoidTurn`, `canVoidSpin`). Recovery returns stakes only before
settlement begins.

### 3. Recovery has to be able to give up

Recovery re-arms the table, so a fault still present at the next window fails again.
Against a database that is simply down that is an endless loop of refunds and board
edits. The guard counts consecutive failures and closes the table after three.

### 4. Acknowledgement came after the work

Discord gives three seconds to acknowledge a click. Eight handlers spent that budget
first: taking a seat read the wallet twice, posted the board and edited it before its
first reply; a craps board bet opened the table and took coins into escrow before
painting; Rebet looped an escrow transaction per bet. Those now acknowledge first.

Two acknowledgement modes exist and are **not** interchangeable — a private defer creates
an empty reply that must be filled with `editReply`, while a board defer creates no reply
at all — so they are named (`ackPrivate`, `ackBoard`) rather than inferred, and `whisper`
reads which was used. Neither may be used by a handler that opens a modal, since
`showModal` is itself the acknowledgement.

### 5. Clicks painted whatever message they came from

`paintViaInteraction` edited the message the click arrived on. Custom ids are static, so a
board left behind by an earlier run still works — and `restoreState` posted a *new* board
on every boot, accumulating them. A click on an old board painted live state onto it while
the painter kept editing the real one: two boards, both looking live, disagreeing.

Now it paints only when the click came from the live board, and `restoreState` reclaims
the previous board message rather than posting beside it.

---

## Two faults unrelated to the outage

Found while confirming the above; neither depends on the database.

**Roulette's empty-spin path was a dead end.** After a spin with no bets, `runSpin` left
`phase = 'betting'` with `closesAt = null` and armed a 30-second grace. `isBettingOpen()`
still reported true, so a stake was taken — but `extendWindow` declines to arm a window
when `closesAt` is null, so nothing was scheduled to turn the wheel, and `closeTable`
voided the bet 30 seconds later. Craps avoids this with an idle phase; roulette has none,
so the armed grace timer is now the marker, checked in `ensureTable` before any escrow
opens.

**Craps aggregated bets kept only their first escrow row.** `CrapsBet` held a single
`escrowId`, and the aggregate branch discarded every later one — despite the comment above
it describing the correct behaviour. Two 500 bets on Place 6, shown as one 1,000 bet:

| Outcome | What happened |
| --- | --- |
| Take down | 500 returned, player told 1,000 |
| Lose | one row settles, orphan refunded at close — 500 of a lost 1,000 recovered |
| Win | full payout on 1,000, orphan still refunded at close — half the stake back on top |

No coins were destroyed; the sweep always returns orphans. But the house bled on every
aggregated bet. `CrapsBet` now carries `escrowIds`.

---

## Smaller fixes

- **Craps Rebet replayed everything.** The per-player list in `craps.ts` was appended to
  on every bet and cleared nowhere, so Rebet repeated every bet since process start and
  the map grew without bound. Now rebuilt from the table each roll, as roulette already
  did per spin.
- **Declining insurance did nothing.** `insuranceSettled` was written in four places and
  read in none. The round now moves on once every seat has answered; the clock is a
  backstop again rather than a fixed 15 seconds.
- **A rejected stake became your default chip.** Both sit paths set `activeChip` before
  checking the result.

---

## Known remaining trade-off

`settleEscrowIds` runs once at the end of a settlement pass, after wallets are credited.
If that single call fails, the rows stay `open` and the startup sweep refunds them — on
top of a payout that already landed. This predates the work here and is deliberate; the
comment at `crapsState.ts` states the reasoning, which is that the alternative has the
database claim a payout the wallet never received. Narrowing it would mean settling each
row immediately after its own credit, at the cost of one transaction per bet instead of
one per pass. Not changed.

---

## Verification

- `npx tsc --noEmit` clean; `npm run lint` clean; Prettier clean.
- 964 tests across 40 suites, all passing (was 925 across 37).
- 39 new tests. The guard is covered directly. Everything else is covered as a pure
  predicate, because driving a real round means fake timers, animation sleeps and a
  Discord client — which is why `blackjackState` and `crapsState` had no suites at all.
- **Not covered by tests:** the acknowledgement and paint-routing changes. Neither is
  reachable without a live Discord interaction. These need a played round of each game.

## For next time

`/sql` holds unapplied schema with no runner and no tracking, exactly like `/migrations`
but without the warning in `CLAUDE.md`. Before assuming a table exists, check
`information_schema`.
