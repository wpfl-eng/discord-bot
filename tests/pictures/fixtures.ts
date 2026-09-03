import { expect } from '@jest/globals';
import type { Built } from '../../pictures/shared.js';

/** The league's fourteen owners, as the canonical names the tools see. Names only. */
export const OWNERS: readonly string[] = [
  'Nixon Ball',
  'Forrest Britton',
  'AJ Boorde',
  'Jimmy Simpson',
  'David Evans',
  'Ryan Salchert',
  'Mike Simpson',
  'Todd Ellis',
  'David Adler',
  'Neill Bullock',
  'Doug Black',
  'Rick Kocher',
  'Jonathan Mims',
  'Michael Hoyle',
];

/** The built value; a refusal is the failure, and its text the message. */
export function valueOf<T>(built: Built<T>): T {
  if (!built.ok) throw new Error(built.refusal);
  return built.value;
}

/** The refusal; a build that went through is the failure. */
export function refusalOf<T>(built: Built<T>): string {
  expect(built.ok).toBe(false);
  return built.ok ? '' : built.refusal;
}
