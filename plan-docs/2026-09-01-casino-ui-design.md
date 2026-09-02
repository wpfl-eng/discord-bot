# Casino UI & Game Depth — Design

**Branch:** `new-feats`
**Started:** 2026-09-01
**Status:** DESIGN IN PROGRESS — interview underway, not yet approved for implementation
**Log:** [2026-09-01-casino-ui-log.md](./2026-09-01-casino-ui-log.md)

---

## 1. Goal

Improve the UX and design of the three casino table games — **blackjack**, **craps**,
**roulette** — across both the interaction layer (Discord components) and game depth
(bet types, rules coverage).

Scope was chosen explicitly by the user as the widest of four options: *all three games,
UI + game depth*. This touches renderers, engines, payout math, and probably schema.

---

## 2. Platform research (verified, not recalled)

### 2.1 Installed versions

| Package | Version | Evidence |
|---|---|---|
| `discord.js` | **14.27.0** | `node_modules/discord.js/package.json` |
| `discord-api-types` | v10 payloads | `node_modules/discord-api-types/payloads/v10/message.d.ts` |
| `sharp` | 0.35.4 | devDependency, used by `scripts/buildEmoji.ts` |

### 2.2 Component types available

Confirmed by reading `ComponentType` at
`node_modules/discord-api-types/payloads/v10/message.d.ts:1071`.

| # | Component | Message | Modal | Needs V2 flag |
|---|---|---|---|---|
| 1 | ActionRow | yes | deprecated | no |
| 2 | Button | yes | no | no |
| 3 | StringSelect | yes | yes | no |
| 4 | TextInput | no | yes | no |
| 5-8 | User / Role / Mentionable / Channel select | yes | yes | no |
| 9 | **Section** | yes | no | **yes** |
| 10 | **TextDisplay** | yes | yes | **yes** |
| 11 | **Thumbnail** | yes | no | **yes** |
| 12 | **MediaGallery** | yes | no | **yes** |
| 13 | **File** | yes | no | **yes** |
| 14 | **Separator** | yes | no | **yes** |
| 17 | **Container** | yes | no | **yes** |
| 18 | **Label** | no | yes | no |
| 19 | **FileUpload** | no | yes | no |
| 21 | **RadioGroup** | no | yes | no |
| 22 | **CheckboxGroup** | no | yes | no |
| 23 | **Checkbox** | no | yes | no |

`MessageFlags.IsComponentsV2 = 32768` (`message.d.ts:438`).

### 2.3 Hard limits

- 40 components per message, **10 top-level**
- Container: **10 direct children**
- ActionRow: **5 buttons OR 1 select**
- StringSelect: **25 options**
- Button label: 80 chars
- Application emoji: 2000 per app (91 currently built)
- `content` and `embeds` are unavailable once `IsComponentsV2` is set

### 2.4 Builders present but UNUSED in this codebase

`SectionBuilder`, `MediaGalleryBuilder`, `ThumbnailBuilder`, `LabelBuilder`,
`RadioGroupBuilder`, `CheckboxGroupBuilder`, `CheckboxBuilder`, `FileUploadBuilder`.

Verified: zero references across `discordCommands/ economy/ interactions/ emoji/ helpers/`.

Notable consequences:
- **Section + button accessory** is the exact primitive blackjack's renderer says it
  wanted and could not find (see its own header comment).
- **Label + RadioGroup/Checkbox** modernises modals; the `ActionRow`-wrapped `TextInput`
  used by `roulette.ts:412` is now the deprecated form.
- **MediaGallery + `sharp`** would allow runtime-rendered board images.

---

## 3. Current state audit

| | Blackjack | Roulette | Craps |
|---|---|---|---|
| Rendering | Components V2 | Components V2 | **EmbedBuilder** |
| Input | Buttons | Buttons + selects + modal | **Slash + autocomplete only** |
| Router prefix | `bj:` | `rl:` | **none** |
| Renderer module | `blackjackRender.ts` | `rouletteRender.ts` | **none** |
| Art | 53 card emoji | 38 pocket emoji | **Unicode dice** |
| Tests | 3 files | 2 files | **none** |
| Visibility | fully ephemeral | public table + ephemeral panel | public embed |

### 3.1 Craps — furthest behind

- Every bet requires typing `/craps bet amount:100 type:pass_line` (`craps.ts:112`).
  No buttons anywhere.
- Only **5 bet types** (`crapsConfig.ts:82`): `pass_line`, `dont_pass`, `field`,
  `place_6`, `place_8`.
- **No odds bets** — the zero-house-edge bet that defines the game.
- No come / don't come, no place 4/5/9/10, no hardways, no props.
- `buildRollingEmbed` (`crapsState.ts:214`) renders "The dice are out!" with **no dice**.
- No rebet / undo / clear (roulette has all three).
- Dice rendered as Unicode U+2680-2685, near-illegible inline.

### 3.2 Roulette

- Betting a number costs 3 clicks + a scroll: `Numbers…` button -> ephemeral panel ->
  one of two 25-option selects.
- `ALL_BET_TYPES` (`rouletteConfig.ts:190`) has **no splits, streets, corners, lines,
  or basket** — only 12 outside bets plus 38 straight-ups.
- Bet board truncates at 8 bet types.
- Chip size lives in an in-memory `Map` (`roulette.ts:88`); resets on restart.
- Orphaned `/** Who opened the table */` comment with no field (`rouletteRender.ts:120`).
- Spin animation is 3 text frames at 800ms (`TIMING.SPIN_FRAME_MS`).

### 3.3 Blackjack

> Superseded in part by **D4**: blackjack is being reworked into one multi-seat table,
> so several of these are resolved by the rework rather than fixed in place.

- Fully ephemeral — zero social presence, unlike the other two.
- Renderer header concedes it wanted per-hand action rows and could not fit them; with
  4 split hands there is one shared row plus a text marker.
- "Play again" is hard-locked to the original stake via customId
  (`blackjackRender.ts:246`) — no way to change bet without re-running the command.
- No side bets (21+3, perfect pairs).

### 3.4 Cross-cutting duplication

- Three currency formatters: `formatAmount` in `rouletteConfig.ts` and
  `crapsConfig.ts`, plus `formatCurrency` in `economy/economyConfig.ts`.
- Three palettes: `EMBED_COLORS` (roulette), `EMBED_COLORS` (craps), `ACCENT`
  (blackjack).
- No shared casino design system.

---

## 4. Decisions

Recorded as they are made during the interview. Each carries the user's chosen option.

| # | Decision | Choice | Status |
|---|---|---|---|
| D1 | Scope | **All three games, UI + game depth** | DECIDED |
| D2 | Shared UI foundation | **Extract shared layer first, back-port roulette + blackjack** | DECIDED |
| D3 | Interaction model | **Public board + private ephemeral panel, all three games** | DECIDED |
| D4 | Blackjack structure | **One table, multi-seat** | DECIDED |
| D5 | Blackjack turn model | **Simultaneous action on one shared round clock** | DECIDED |
| D6 | Blackjack ruleset | **6 deck, S17, persistent shoe, 3:2** | DECIDED |
| D7 | Action surface | **Shared action row on the public board** | DECIDED |
| D8 | Seat count | **Unlimited** | DECIDED |
| D9 | Board layout | **Two-zone: acting seats full, settled seats collapsed** | DECIDED |
| D10 | Buy-in loop | **Chips + Sit, stake rides until changed or stood up** | DECIDED |
| D11 | Side bets | **Both 21+3 and Perfect Pairs** | DECIDED |
| D12 | Craps depth | **All but come/don't come: odds, place, hardways, props** | DECIDED |
| D13 | Craps input | **Phase-contextual board** | DECIDED |
| D14 | Craps shooter | **Shooter throws, rotates on seven-out, auto-roll fallback** | DECIDED |
| D15 | Roulette inside bets | **Number-anchored panel: pick a number, see every bet covering it** | DECIDED |
| D16 | Roulette bet board | **Player totals + biggest action** | DECIDED |
| D17 | Art strategy | **Emoji inline, sharp-rendered hero images once per round** | DECIDED |
| D18 | Channels | **Per-game channels + casino hub board** | DECIDED |
| D19 | Durability | **Persist between rounds; mid-round refunds via existing sweep** | DECIDED |
| D20 | Modals | **Adopt Label / RadioGroup / CheckboxGroup everywhere they fit** | DECIDED |
| D21 | Pacing | **Adaptive to money at risk** | DECIDED |
| D22 | Sequencing | **Foundation, craps, roulette, blackjack, polish** | DECIDED |
| D23 | Testing | **TDD for money math; existing pattern elsewhere** | DECIDED |
| D24 | Slash commands | **Kept as power-user paths, extended to new bet types** | DECIDED |

### D1 — Scope: all three, UI + game depth

Both the interaction layer and game content. Explicitly includes craps odds/come bets,
roulette inside combination bets, and blackjack depth. Accepted that this touches
engines, payout math, and DB schema.

### D2 — Foundation: extract shared layer first

Build `casino/` primitives up front, port the two existing renderers onto them, then
build craps and all new depth on that base.

Accepted cost: touches two files committed in the last two commits (`2a0157b`,
`03467bd`). Rationale for accepting it anyway: adding craps as a third copy would lock
in the palette/formatter/helper duplication permanently, and all three games are about
to grow substantially.

Planned shape (subject to later decisions):

```
casino/
  casinoTheme.ts    one palette, phase -> accent mapping
  casinoFormat.ts   single formatAmount / currency rendering
  casinoRender.ts   frame / section / button / separator helpers
```

`interactions/renderedMessage.ts` already defines the shared `RenderedMessage` payload
shape and stays where it is.

### D3 — Interaction model: public board + private panel

All three games converge on one pattern:

- **One shared, persistent public message per game** carrying table state and everyone's
  action. Roulette already does this (`rouletteState.paint`); craps has a public embed
  that becomes this; blackjack gains one.
- **A per-player ephemeral panel** for controls that will not fit on the shared message
  or must not be shared. Roulette already does this (`buildBetPanel`).

This is what the shared layer in D2 must serve: a board builder and a panel builder,
both emitting `RenderedMessage`.

### D4 — Blackjack: one table, multi-seat

Blackjack is **reworked**, not merely restyled. It becomes a single shared multi-seat
table against one dealer on one shoe, structurally like roulette and craps: a betting
window, a deal, seats acting, the dealer playing, then settlement.

Consequences already identified:

- The solo path is **replaced**. Today's per-user entry point `startGame({ interaction,
  amount, table })` and the one-hand-per-user guard `hasActiveGame(userId)`
  (`blackjackState.ts`) are no longer the right shape.
- The two rulesets `classic` (1 deck, S17, fresh shuffle) and `vegas` (6 deck, H17,
  persistent shoe) collapse into **one** table. Which ruleset survives is open (Q5).
- One shoe for the whole table makes card counting genuinely meaningful for the first
  time; the existing shoe machinery (`shoeRemaining`, `shoeSize`, `justShuffled`) is
  reusable.
- Player cards go on the public board. This is authentic: real casino shoe blackjack
  deals player cards face up. The private panel then carries only the acting player's
  buttons and wallet state.
- The turn model is resolved by D5.

### D5 — Blackjack turn model: simultaneous, shared clock

After the deal, every seat acts at once on a single shared round clock. The dealer
plays when all seats are finished or the clock expires; an idle seat is auto-stood.

Chosen because round length is then bounded regardless of how many seats are filled,
which suits Discord's asynchronous attention pattern. Strict sequential order was
rejected: five seats at 25s each is a three-minute round and any idle player stalls
everyone behind them.

Accepted trade-off: cards leave the shoe in click order rather than seat order. This
costs nothing statistically and counting still works, since every card becomes visible
by the end of the round — but it is not authentic seat-order play.

### D6 — Blackjack ruleset: 6 deck, S17

The single table runs today's `vegas` shoe depth with today's `classic` soft-17 rule.

| Rule | Value | Where it lives today |
|---|---|---|
| Decks | 6, persistent shoe with cut card | `TableConfig.deckCount` |
| Soft 17 | dealer **stands** | `TableConfig.dealerHitsSoft17: false` |
| Blackjack pays | 3:2 | `blackjackEngine.ts:249` (`bet * 2.5`) |
| Late surrender | half back | `blackjackEngine.ts:225` |
| Double after split | allowed | `canDoubleHand`, blocks split aces only |
| Max hands | 4 | `MAX_HANDS` |

House edge roughly 0.35%. `TABLES` and `DEFAULT_TABLE` in `blackjackUtils.ts` collapse
to this one configuration; the `table` slash option and the `:table` segment of the
play-again customId (`blackjackRender.playAgainId`) both go away.

### D7 — Action surface: shared board buttons

Hit / Stand / Double / Split / Surrender live in one action row on the **public board**.
The handler reads `interaction.user.id` and applies the action to that clicker's seat
and their current active hand. A click from someone not seated gets a quiet ephemeral
nudge.

Why this works here and not for roulette: D5 makes every seat live at once, so a shared
button is unambiguous per clicker. The existing `activeHandIndex` auto-advance already
picks which of a player's split hands is live.

Constraint that motivated the question: **Discord cannot push an ephemeral message to a
user unsolicited** — a private panel only exists as a response to that user's own
interaction. Putting actions on the board removes any dependence on interaction-token
lifetime. A private panel may still be added later for detail, but nothing requires it
to play.

Rendering consequence: with up to 5 seats all clicking at once, the board must debounce
its re-renders. Roulette already solves this with `schedulePaint` /
`cancelPendingPaint` (`rouletteState.ts:152`), which the shared layer should absorb.

## 5. Open questions

Tracked here as the interview proceeds; moved into section 4 once answered.

- **Q15 — Modal modernisation**: adopt `Label` + `RadioGroup` / `Checkbox`, replacing the
  deprecated `ActionRow`-wrapped `TextInput` at `roulette.ts:412`.
- **Q17 — Persistence**: chip size and seat/UI preferences currently in-memory only.
- **Q18 — Pacing / rate limits**: animation frame budget across three live tables.
- **Q19 — Testing and rollout expectations.**

---

## 6. Phase plan

To be written once the interview completes.

### D8 — Seats: unlimited

No cap. Anyone who buys in during the betting window plays.

Two consequences follow and are resolved here:

**Shoe exhaustion.** Cut card reached triggers a reshuffle *before the next round*. If a
single round outruns the remaining cards mid-deal, reshuffle immediately and continue
dealing — what a real pit does, and it keeps `justShuffled` meaningful. Not put to the
user as a question; raise it if this assumption is wrong.

**Board length** — resolved by D9.

Shoe life at 6 decks (~234 playable cards behind a 75% cut card, ~2.7 cards per hand):

| Seats | Hands/round | Cards/round | Rounds per shoe |
|---|---|---|---|
| 3 | 4 | ~11 | ~21 |
| 5 | 6 | ~16 | ~14 |
| 7 | 8 | ~22 | ~10 |
| 10 | 11 | ~30 | ~7 |

### D9 — Board layout: two zones

- **ACTING** — seats still deciding, shown with full cards and totals.
- **DONE** — seats stood, busted, or surrendered, collapsed to one result line each and
  packed several per line.

The board therefore shrinks as the round resolves and attention stays on live action.
A hard cap with an overflow line applies only at extreme table sizes.

Constraint that shaped this: **a shared public message renders identically for every
viewer**, so no per-viewer personalisation is possible on that surface — "your seat
pinned to the top" cannot be done on the board, only on an ephemeral panel.

### D10 — Buy-in loop: chips, then the stake rides

Chip buttons set the stake and `Sit` seats the player, mirroring roulette's chip flow so
the shared layer serves both. The stake then **rides automatically each round** until the
player changes it or stands up — chips stay in the circle, and the table keeps moving
with nobody clicking.

Controls during the betting window: `[100] [1K] [10K] [50K] [Custom]` and
`[Sit] [Change] [Stand Up]`.

Defined edge case: escrow already debits atomically (`escrowDb.openEscrow`). If a wallet
cannot cover the next round's auto-rebet, the player is **stood up with a notice** rather
than having their stake silently reduced.

Accepted trade-off: a distracted player can lose money without clicking. The stop-loss
variant was offered and not chosen.

### D11 — Side bets: both 21+3 and Perfect Pairs

Both resolve **at the deal**, before any seat acts, so they add a second optional stake
per seat and a paytable but **no turn-model complexity**.

**21+3** — player's two cards plus the dealer upcard, as a three-card poker hand:

| Hand | Pays |
|---|---|
| Suited trips | 100:1 |
| Straight flush | 40:1 |
| Three of a kind | 30:1 |
| Straight | 10:1 |
| Flush | 5:1 |

House edge ~3.2% on 6 decks.

**Perfect Pairs** — the player's first two cards:

| Hand | Pays |
|---|---|
| Perfect pair (rank + suit) | 25:1 |
| Coloured pair (rank + colour) | 12:1 |
| Mixed pair (rank only) | 6:1 |

House edge ~4.1% on 6 decks.

Both need paytable config, engine evaluation at deal time, a board line, and stats
columns in `blackjack/blackjackDb.ts`.

---

## Craps branch

### D12 — Craps depth: everything except come / don't come

Craps goes from 5 bet types to roughly 20.

**Free odds** (the headline addition — the only bet in the building with no house edge):

| Point | Pass odds pays | Don't pass lay |
|---|---|---|
| 4 or 10 | 2:1 | 1:2 |
| 5 or 9 | 3:2 | 2:3 |
| 6 or 8 | 6:5 | 5:6 |

Capped at conventional 3-4-5x (3x on 4/10, 4x on 5/9, 5x on 6/8).

**Place** — 4 and 10 at 9:5, 5 and 9 at 7:5, 6 and 8 at 7:6 (6 and 8 already exist).

**Hardways** — hard 4 and hard 10 at 7:1, hard 6 and hard 8 at 9:1. Multi-roll: lose on
the easy way or a 7.

**One-roll props** — any seven 4:1, any craps 7:1, yo (11) 15:1, snake eyes (2) 30:1,
boxcars (12) 30:1.

**Deliberately excluded: come and don't come.** They are the one piece requiring a
per-player sub-state machine — every player can carry up to six live come points, each
separately backable with its own odds — which would explode board state under an
unlimited-player table. Everything in this tier resolves off the roll total plus the
dice pair, so no new per-player state is introduced. Come bets can be added later on
this same foundation.

### D13 — Craps input: phase-contextual board

The board swaps its rows as the table moves between come-out and point, showing only
bets that are legal right now. Illegal bets are **unreachable rather than rejected**.

This leans on structure that already exists: `COMEOUT_BET_TYPES` and `POINT_BET_TYPES`
(`crapsConfig.ts:141`) already gate the autocomplete the same way.

```
COME-OUT                      POINT IS 6
[100][1K][10K][50K][Custom]   [100][1K][10K][50K][Custom]
[Pass][Don't Pass][Field]     [Odds 3x][Field][Take Down]
                              v Place a number (4-10)
                              v Hardways & props
[Slip][Rebet][Undo][Clear]    [Slip][Rebet][Undo][Clear]
```

Budget: Container + 5 action rows = 6 top-level, ~32 components. Inside the 10/40 caps.

### D14 — Craps shooter: throws, rotates, auto-fallback

Today the shooter is set **once**, to whoever opens the table (`crapsState.ts:641`),
never rotates, and has no ability — `executeRoll` fires off the betting timer regardless.
The role is purely decorative, which is backwards for the game built around who holds
the dice.

New behaviour:

- When betting closes, a `ROLL` button appears that **only the shooter** can use.
- The shooter keeps the dice until they **seven out**, then the dice pass to the next
  bettor in the queue, announced on the board.
- If the shooter is idle for a short grace (~15s), the table rolls for them, so an
  absent shooter never freezes the game.


---

## Roulette branch

### D15 — Inside bets: number-anchored panel

American roulette's full bet space is roughly **146 inside bets** plus the 12 outside
bets that exist today:

| Family | Count | Pays |
|---|---|---|
| Straight up | 38 | 35:1 |
| Split | ~62 | 17:1 |
| Street | 12 | 11:1 |
| Corner | 22 | 8:1 |
| Six line | 11 | 5:1 |
| Five-number basket | 1 | 6:1 (edge 7.89%) |

Buttons are impossible and category-then-instance selects break the 25-option cap on
splits alone. Instead the panel is **anchored on a number**: pick a pocket, and one
select lists every bet that covers it.

For 17 that is 1 straight + 4 splits + 1 street + 4 corners + 2 six lines + 4 outside
memberships = **16 options**, always inside the cap. This also matches how a player
actually thinks — "I want 17 covered" — rather than making them reason about felt
geometry.

Implementation note: this needs a generic `betCovers(betType, pocket)` predicate plus a
reverse index from pocket to covering bets. Both are pure functions and directly
testable.

### D16 — Bet board: player totals + biggest action

Today `betBoard` groups by bet type, sorts by money, and truncates at 8 with a
`+N more bet types` line — fine for 12 outside bets, useless once five players can put
30 distinct bet types on the table.

Replaced with two short blocks:

```
ON THE TABLE          14.2K

  AJ      6.5K   9 bets
  Nixon   4.2K   3 bets
  Dave    2.5K   1 bet

BIGGEST ACTION
  2.5K  Dave    17 straight     35:1
  2.0K  Nixon   RED             1:1
  1.5K  AJ      13-14-16-17     8:1
```

Length scales with **player count**, not bet variety. Full detail stays in the player's
own slip, which `buildSlipText` already produces.

---

## Cross-cutting

### D17 — Art: emoji inline, images for hero frames

**New application emoji (~13; cap is 2000, 91 currently used):**

- `d1`–`d6` — craps dice faces, replacing Unicode `⚀⚁⚂⚃⚄⚅`
- `chip100`, `chip1K`, `chip10K`, `chip50K` — chip denominations
- `puckOn` / `puckOff` — the craps point marker

**Hero images**, rendered with `sharp` into a MediaGallery, once per round only:

| Game | Moment |
|---|---|
| Roulette | the winning pocket, once per spin |
| Craps | the dice, once per roll |
| Blackjack | the final board, once per round |

Live boards stay pure text so they repaint instantly. A render plus attachment upload is
*estimated* at a few hundred ms — **not measured** — which is affordable once a round but
not on a board that repaints on every chip click.

**Consequence:** `sharp` moves from devDependency to runtime dependency, and it ships
native binaries. Hero rendering must therefore **degrade to the text frame on failure**,
mirroring `emojiRegistry`'s stated philosophy that art is "an upgrade, never a
dependency". Not put to the user as a question.

### D18 — Channels: per-game rooms plus a hub

A live board is a message edited in place, so any new message in its channel pushes it
out of view. Three tables in one room would bury each other constantly.

- `ROULETTE_CHANNEL_ID` — exists (`rouletteState.ts:502`)
- `CRAPS_CHANNEL_ID` — exists (`crapsConfig.ts:377`)
- `BLACKJACK_CHANNEL_ID` — **new**, blackjack has no channel gate today
- `ECONOMY_CASINO_CHANNEL_ID` — exists but is only referenced by `economyConfig.ts:270`;
  becomes the **hub**

The hub is a single message summarising what is live across all three, with a jump button
per table, so three quiet rooms are still discoverable:

```
#casino
  ROULETTE   betting · closes in 22s · 14.2K
  CRAPS      point 6 · AJ shooting · 8 rolls
  BLACKJACK  4 seated · dealing
  [Go to table] x3
```


### D19 — Durability: persist between rounds

| Survives a restart | Refunded on restart |
|---|---|
| Seats and riding stakes | Any wager open mid-round |
| Shoe composition and cut-card position | |
| Craps point and shooter queue | |
| Session totals | |

Shoe continuity matters specifically because D6 makes counting meaningful — a shoe that
silently resets invalidates anyone's count.

Mid-round state is deliberately **not** serialised. `runStartupRefundSweep`
(`economy/startupSweep.ts`, already wired at `index.ts`) refunds every open escrow, so
money is always correct; the round is simply redealt.

### D20 — Modals: adopt the new components

`ActionRow`-wrapped `TextInput` is deprecated; `Label` (type 18) is the replacement.
`RadioGroup` (21) and `CheckboxGroup` (22) are modal-only and must sit inside a `Label`.

| Where | Components | Why |
|---|---|---|
| Blackjack `Sit` | `Label`+`TextInput` (stake), `Label`+`CheckboxGroup` (21+3, Perfect Pairs) | Collapses three clicks into one submit |
| Craps odds | `Label`+`RadioGroup` (2x / 3x / 5x) | Single choice, self-labelling |
| Roulette chip | `Label`+`TextInput` | Fixes the deprecated form at `roulette.ts:412` |

### D21 — Pacing: adaptive to money at risk

| Money on the round | Frames | Approx. | Extras |
|---|---|---|---|
| under 5K | 1 | ~0.8s | — |
| 5K – 25K | 3 | ~2.4s | — |
| over 25K | 5 | ~4.0s | hero image + callout |

Routine play stays fast; the drama lands only where players actually care. D18 put each
table in its own channel, so the three no longer compete for one channel's edit rate
limit.

### D22 — Sequencing

Foundation, then craps, then roulette, then blackjack, then polish. Craps goes first
among the games because it is both the largest visible win and the first game built
natively on the new shared layer — which proves the layer before blackjack's much
riskier multi-seat rework depends on it.

### D23 — Testing: TDD for money, existing pattern elsewhere

**Tests written first**, for everything that moves coins:

- Craps odds resolution per point (4, 5, 6, 8, 9, 10) for both pass and don't pass
- Hardways, the five props, and the field's 2x/3x special cases
- 21+3 and Perfect Pairs paytables
- `betCovers(betType, pocket)` exhaustively: ~146 bet types x 38 pockets

**Existing pattern** (written alongside, as `tests/` already does) for renderers, config,
and component-budget assertions. Craps gets its first tests — it currently has none.

### D24 — Slash commands: kept as power-user paths

All betting subcommands survive and are extended to the new bet types, with autocomplete
covering them. Buttons are primary; typing stays the fast lane.

- `/roulette bet <amount> <type>` — autocomplete over ~146 bet types
- `/craps bet <amount> <type>` — autocomplete over ~20, still phase-gated
- `/blackjack sit <amount>` — replaces `/blackjack <amount>`
- **Removed:** the `/blackjack table` option, since D6 collapses the two tables

---

## 6. Phase plan

### Phase 0 — Shared foundation

Pure refactor. **No behaviour change**; the existing render tests must pass untouched.

| File | Action |
|---|---|
| `casino/casinoTheme.ts` | new — one palette, phase -> accent |
| `casino/casinoFormat.ts` | new — single `formatAmount`, reconciled with `economyConfig.formatCurrency` |
| `casino/casinoRender.ts` | new — frame / section / button / separator helpers, board + panel builders |
| `casino/casinoPaint.ts` | new — debounced repaint, extracted from `rouletteState.schedulePaint` / `cancelPendingPaint` |
| `discordCommands/roulette/rouletteRender.ts` | port onto `casino/` |
| `discordCommands/blackjack/blackjackRender.ts` | port onto `casino/` |

Also fixes the orphaned `/** Who opened the table */` comment at `rouletteRender.ts:120`.

Retires: `EMBED_COLORS` in `rouletteConfig.ts`, `EMBED_COLORS` in `crapsConfig.ts`,
`ACCENT` in `blackjackRender.ts`, and the two duplicate `formatAmount` implementations.

### Phase 1 — Craps

| File | Action |
|---|---|
| `discordCommands/craps/crapsRender.ts` | **new** — V2, phase-contextual board |
| `discordCommands/craps/crapsConfig.ts` | expand `BET_TYPES` 5 -> ~20; drop `EMBED_COLORS` |
| `discordCommands/craps/crapsEngine.ts` | resolution for odds, place 4/5/9/10, hardways, props |
| `discordCommands/craps/crapsState.ts` | embeds -> `RenderedMessage`; shooter rotation, ROLL button, auto-fallback; escrow-backed |
| `discordCommands/craps/craps.ts` | `registerComponentHandler('cr:')`; extend autocomplete |
| `scripts/buildEmoji.ts` | add `d1`–`d6`, `puckOn`, `puckOff` |
| `migrations/010_craps_bet_types.sql` | new bet-type stats |
| `tests/craps/*` | **first craps tests**; payouts TDD |

### Phase 2 — Roulette

| File | Action |
|---|---|
| `discordCommands/roulette/rouletteConfig.ts` | generate ~146 bet types; `betCovers()` + pocket -> bets index |
| `discordCommands/roulette/rouletteRender.ts` | new board (D16); number-anchored panel (D15) |
| `discordCommands/roulette/roulette.ts` | chip modal -> `Label`; autocomplete over all bet types |
| `discordCommands/roulette/rouletteDb.ts` | inside-bet stats |
| `migrations/011_roulette_inside_bets.sql` | new |
| `tests/roulette/*` | exhaustive `betCovers` grid, payouts TDD |

### Phase 3 — Blackjack multi-seat

The largest and riskiest phase. Lands last, on a layer already proven by two games.

| File | Action |
|---|---|
| `discordCommands/blackjack/blackjackUtils.ts` | `TABLES` collapse to one (6 deck, S17) |
| `discordCommands/blackjack/blackjackEngine.ts` | 21+3 and Perfect Pairs evaluation |
| `discordCommands/blackjack/blackjackState.ts` | **rewrite** — table session, betting window, unlimited seats, simultaneous action on a shared clock, auto-stand, riding stakes, shoe persistence |
| `discordCommands/blackjack/blackjackRender.ts` | two-zone board (D9), shared action row (D7) |
| `discordCommands/blackjack/blackjack.ts` | `/blackjack sit`; remove `table` option; Sit modal |
| `blackjack/blackjackDb.ts` | side-bet stats |
| `migrations/012_blackjack_multiseat_sidebets.sql` | new |

### Phase 4 — Hub, hero images, polish

| Item | Detail |
|---|---|
| `casino/casinoHub.ts` | hub board in `ECONOMY_CASINO_CHANNEL_ID` (D18) |
| Hero images | `sharp` -> MediaGallery, once per round; **sharp moves to `dependencies`**; degrade to text on failure |
| Adaptive pacing | D21 thresholds across all three games |
| Persistence | D19 between-round state tables |
| `.env.sample` | add `BLACKJACK_CHANNEL_ID` |
| Deploy | `npx tsx deploy-commands.ts` after the command surface settles |

---

## 7. Explicitly out of scope

- **Craps come / don't come bets** (D12). The one piece needing a per-player sub-state
  machine. Addable later on this foundation.
- **Multi-seat anything except blackjack.** Roulette and craps are already inherently
  multi-player.
- **Mid-round restart recovery** (D19). Money is protected by the escrow sweep; the round
  is redealt.
- `migrations/008_remove_nflmon_rob_training.sql` stays unapplied, per `CLAUDE.md`.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Phase 0 touches two files committed hours ago | Pure refactor; existing tests must pass unchanged |
| Blackjack rewrite is large and last | Layer proven by craps and roulette first; TDD on money paths |
| `sharp` as a runtime dep ships native binaries | Hero images degrade to text frames on any failure |
| ~146 roulette bet types is a big payout surface | Exhaustive `betCovers` grid test, written first |
| Three live tables plus a hub means four boards to keep consistent | Single shared paint/debounce module in `casino/` |

---

## 9. Adversarial review of this plan (2026-09-01, before implementation)

The plan was reviewed against the code it actually has to touch. Seven problems found;
all are resolved here and the phase plan above is amended accordingly.

### R1 — Craps ends the shooter's session on every come-out decision (pre-existing bug)

`resolveAllBets` (`crapsEngine.ts`) sets `sessionEnded = sessionOutcome !== null`, and
`determineSessionOutcome` returns `natural` on a come-out 7/11 and `craps` on 2/3/12.

In real craps **only a seven-out passes the dice**. A natural or a craps on the come-out
resolves the line bets and the *same shooter* immediately rolls another come-out. So
today the "session" ends on every come-out decision, which is why the shooter never
meaningfully persists and why `craps_sessions` rows are per-decision rather than
per-shooter.

D14 (shooter rotates on seven-out) **cannot be implemented without fixing this.**

Fix: separate *decision* from *session*. `resolveAllBets` reports the decision;
only `seven_out` sets `sessionEnded` and rotates the shooter.

### R2 — Odds bets are not expressible in the current flat bet model

`CrapsBet` is a flat record and `resolveBet` switches on `betType` alone. An odds bet:

- attaches to a **parent** pass / don't-pass bet,
- pays by the **point that was on when it was placed**, not by bet type,
- is capped **relative to the parent stake** (3-4-5x),
- must resolve **when the parent resolves**.

Fix: add `parentBetId?: string` and `oddsPoint?: number` to `CrapsBet`, and resolve odds
alongside their parent.

### R3 — `EscrowGame` does not include craps

`escrowDb.ts:20` declares `type EscrowGame = 'roulette' | 'blackjack'`. Making craps
escrow-backed requires widening it, and `EscrowPurpose` needs `'odds'` and `'sidebet'`.

**No migration needed**: `sql/escrow.sql` declares `game VARCHAR(20)` and
`purpose VARCHAR(20)` with **no CHECK constraint**, and `sweepOpenEscrows` is
game-agnostic. TypeScript-only change.

### R4 — `formatCurrency` must not be touched

`economy/economyConfig.ts:282` is imported by **24 files** across the whole bot, not just
the casino. The Phase 0 wording "reconciled with `economyConfig.formatCurrency`" was
dangerous.

Corrected: `casino/casinoFormat.ts` **adds** a compact `formatAmount` and re-exports
`formatCurrency` unchanged. `economyConfig` is not modified.

### R5 — `update()` and debounce are different mechanisms; the plan conflated them

An interaction must be acknowledged within 3 seconds, so a player's click **must** paint
immediately via `interaction.update()` — it cannot wait on a debounce. Debouncing applies
only to **timer-driven** repaints (countdown ticks, spin frames).

Since all three games use a single shared board message, one player's `update()` repaints
it for everyone, so a click costs exactly one edit. Rapid clicking by many players can
still approach the per-message edit budget; discord.js retries 429s automatically.

Fix: `casino/casinoPaint.ts` exposes two distinct entry points — `paintNow(interaction)`
for interaction-driven edits and `schedulePaint(session)` for timer-driven ones.

### R6 — Concurrency interleaving around escrow

`await escrowDb.openEscrow(...)` is a yield point. Two players clicking simultaneously can
interleave between reading table state and writing it.

Fix: re-validate preconditions **after** the await returns, and perform every in-memory
state mutation synchronously in the same tick as the write. Where a bet cannot be
attached after a successful debit, refund immediately rather than waiting for the sweep —
the pattern `roulette.ts` already uses.

### R7 — Phase ordering bug: persistence lands after the phase that needs it

D19 persistence was scheduled in Phase 4, but blackjack (Phase 3) depends on seats and
shoe surviving a restart.

Accepted resolution: Phases 1-3 run their tables **in memory**, exactly as roulette and
craps do today, and Phase 4 adds persistence for all three at once. Each phase remains
independently shippable; the escrow sweep protects money throughout. This is stated
rather than hidden.

### Schema constraints discovered

| Column | Type | Consequence |
|---|---|---|
| `craps_bets.bet_type` | `VARCHAR(16)` | Longest new key `dont_pass_odds` = 14. Fits. |
| `roulette_bets.bet_type` | `VARCHAR(20)` | Forces compact inside-bet keys (below). |
| `wager_escrow.game` | `VARCHAR(20)`, no CHECK | Craps needs no migration. |
| `craps_stats` | per-bet-type counters | Needs new columns -> migration 010. |

**Roulette inside-bet key scheme** (all <= 12 chars, unambiguous, human-readable):

| Family | Key | Covers |
|---|---|---|
| Straight | `17` | 17 |
| Split | `split-17-20` | 17, 20 |
| Street | `street-16` | 16, 17, 18 |
| Corner | `corner-13` | 13, 14, 16, 17 |
| Six line | `line-13` | 13-18 |
| Basket | `basket` | 0, 00, 1, 2, 3 |

### Verification limits — stated plainly

There is no Discord token or live guild in this environment. **The rendered UI cannot be
verified.** Verification available and used:

- `npm run typecheck` — tsc --noEmit
- `npm run lint` — ESLint
- `npm test` — Jest

Component budgets are asserted structurally in tests (the existing render tests already
do this), which catches over-budget payloads that Discord would reject outright. It does
not catch anything about how the result *looks*.

Migrations are **not auto-applied** — this repo has no runner. Migrations 010-012 are
written but the user must run them before the features that need them will work.
