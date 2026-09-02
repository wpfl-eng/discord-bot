/**
 * The /ask kill switch, in memory.
 *
 * The design's highest-ranked failure is the bot saying something stupid in
 * public, and the realistic moment for it is late, from a phone. The other
 * switch is SSH from a laptop to edit .env and restart. This one is flipped
 * by /ask-admin pause and resume and checked at the top of both entry points.
 * Not persisted: a restart is the SSH path anyway, and it clears the pause,
 * which is the right default for a switch meant for an incident.
 */

let paused = false;

export function isAskPaused(): boolean {
  return paused;
}

export function setAskPaused(value: boolean): void {
  paused = value;
}
