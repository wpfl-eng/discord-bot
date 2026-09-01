// Casino Failure Recovery
//
// A table advances itself. A betting window closes, cards go out, a wheel spins, the
// dice pass - and every one of those advances is reached from a timer callback, which
// has nobody to return an error to.
//
// Before this module those callbacks were written `setTimeout(() => void advance())`,
// so a throw anywhere inside one became an unhandled rejection. That is how a single
// missing database table turned into permanently wedged tables: the advance died
// part-way, leaving the phase changed, no timer armed and no repaint, so the board went
// on showing a countdown whose deadline had passed - which Discord renders as a clock
// running backwards, forever.
//
// Every advance now runs through a guard. A throw is logged, handed to the game's own
// recovery, and the table is put back into a state it can move out of.
//
// WHY THE GAME OWNS RECOVERY
//
// Only the game knows whether handing the round's stakes back is safe. Once a round has
// started crediting wallets, its escrow rows are paid but not yet marked settled, and
// voiding one there would pay the same stake a second time. Recovery therefore receives
// the failure and decides for itself; this module only guarantees that it is called,
// exactly once, and that a throw from recovery cannot escape either.
//
// WHY THERE IS A LIMIT
//
// Recovery re-arms the table, so a fault that is still there when the next window
// closes fails again. Against a database that is simply down, that is an endless loop of
// refunds and board edits. After a few consecutive failures the table gives up and
// closes instead, and the next player opens a fresh one.

/** Consecutive failed advances a table tolerates before it closes instead of re-arming. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface RecoveryContext {
  /** Name of the advance that threw, for logs */
  readonly step: string;
  readonly error: unknown;
  /** Failures in a row, this one included. 1 on the first. */
  readonly consecutive: number;
  /** True when the table has failed too often to be worth re-arming. */
  readonly exhausted: boolean;
}

export interface AdvanceGuard {
  /** Run one phase advance. Never throws. */
  run(step: string, body: () => Promise<void>): Promise<void>;
  /** Consecutive failures so far. Exposed for tests and boot logging. */
  readonly failures: number;
  /** Forget the failure streak. Called when a table closes or a test resets. */
  reset(): void;
}

/**
 * Build a guard for one game's table.
 *
 * @param label - log prefix, e.g. 'BLACKJACK'
 * @param recover - the game's own recovery, called once per failure
 */
export function createAdvanceGuard(
  label: string,
  recover: (context: RecoveryContext) => Promise<void>
): AdvanceGuard {
  let consecutive = 0;

  return {
    get failures(): number {
      return consecutive;
    },

    reset(): void {
      consecutive = 0;
    },

    async run(step: string, body: () => Promise<void>): Promise<void> {
      try {
        await body();
        // An advance that completed is proof the table is healthy again.
        consecutive = 0;
      } catch (error: unknown) {
        consecutive += 1;
        const exhausted: boolean = consecutive >= MAX_CONSECUTIVE_FAILURES;

        console.error(
          `[${label}] ${step} failed (${consecutive}/${MAX_CONSECUTIVE_FAILURES}` +
            `${exhausted ? ' - closing the table' : ''}):`,
          error
        );

        try {
          await recover({ step, error, consecutive, exhausted });
        } catch (recoveryError: unknown) {
          // Recovery is the last line. If it throws too, the only thing left is to say
          // so - rethrowing would recreate the unhandled rejection this exists to stop.
          console.error(`[${label}] recovery after ${step} also failed:`, recoveryError);
        }
      }
    },
  };
}
