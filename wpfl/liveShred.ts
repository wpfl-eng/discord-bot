/**
 * The live shred, as something readers borrow.
 *
 * One process-wide generation, in a module of its own so that the readers --
 * a running agent, and the SQL materializer reading ~11 MB off disk -- do not
 * have to import the fetch-and-swap machinery to say "I am inside this
 * directory". artifactSync is the only writer.
 */

import { createGenerations, type Generations, type Release } from '../ask/generations.js';

const shred: Generations = createGenerations('shred');

/** Borrow the live shred for as long as you read it. Release when done. */
export function borrowShred(): Release {
  return shred.enter();
}

/**
 * Retire the live shred. `dispose` deletes the directory the swap renamed
 * aside, once nobody is reading it any more.
 */
export function retireShred(dispose: () => void): void {
  shred.rotate(dispose);
}

/** Readers inside the live shred, and retired shreds still on disk waiting on one. */
export function shredReaders(): number {
  return shred.readers();
}

export function retiredShreds(): number {
  return shred.pending();
}
