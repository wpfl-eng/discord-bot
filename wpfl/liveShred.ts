/**
 * The live shred, as something readers borrow.
 *
 * One process-wide generation, in a module of its own so that the readers --
 * a running agent, and the SQL materializer reading ~11 MB off disk -- do not
 * have to import the fetch-and-swap machinery to say "I am inside this
 * directory". artifactSync is the only writer: it `rotate()`s with a dispose
 * that deletes the directory the swap renamed aside, once nobody reads it.
 */

import { createGenerations, type Generations } from '../ask/generations.js';

export const liveShred: Generations = createGenerations('shred');
