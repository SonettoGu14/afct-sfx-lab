/**
 * Small deterministic PRNG helpers.
 *
 * Preset generation is randomized, so without a seed two clicks on the same
 * preset produce different sounds. Passing a seed keeps a "family" of sounds
 * reproducible, which is what batch variation export and share links need.
 */

export type RandomSource = () => number;

/** Mulberry32: 32-bit state, fast, good enough for sound design jitter. */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Named alias so call sites read as "give me a source for this seed". */
export function createSeededRandom(seed: number): RandomSource {
  return mulberry32(seed);
}

/** FNV-1a over a string, so a seed can be derived from a name. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A fresh 32-bit seed for "give me a new one" actions. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
