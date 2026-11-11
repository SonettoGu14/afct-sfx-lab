import { describe, expect, it } from 'vitest';
import { createSeededRandom, hashSeed, randomSeed } from './prng';

function take(source: () => number, count: number): number[] {
  return Array.from({ length: count }, () => source());
}

describe('seeded random source', () => {
  it('replays the same sequence for the same seed', () => {
    expect(take(createSeededRandom(42), 8)).toEqual(take(createSeededRandom(42), 8));
  });

  it('diverges for different seeds', () => {
    expect(take(createSeededRandom(1), 8)).not.toEqual(take(createSeededRandom(2), 8));
  });

  it('stays inside the unit interval', () => {
    for (const value of take(createSeededRandom(7), 500)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('hashes strings stably and distinctly', () => {
    expect(hashSeed('click')).toBe(hashSeed('click'));
    expect(hashSeed('click')).not.toBe(hashSeed('Clack'));
    expect(hashSeed('')).toBe(0x811c9dc5);
  });

  it('produces 32-bit seeds', () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
