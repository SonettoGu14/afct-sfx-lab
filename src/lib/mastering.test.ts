import { describe, expect, it } from 'vitest';
import {
  applyTargetPeak,
  masterForExport,
  measurePeak,
  measurePeakDb,
  trimSilence,
} from './mastering';

const RATE = 44100;

function clipAt(start: number, length: number, total: number, value: number): Float32Array {
  const samples = new Float32Array(total);
  samples.fill(0, 0, start);
  samples.fill(value, start, start + length);
  return samples;
}

describe('export mastering', () => {
  it('measures peak and peak dBFS', () => {
    expect(measurePeak(new Float32Array(64))).toBe(0);
    expect(measurePeakDb(new Float32Array(64))).toBe(Number.NEGATIVE_INFINITY);

    const samples = clipAt(0, 10, 100, 0.5);
    expect(measurePeak(samples)).toBeCloseTo(0.5, 6);
    expect(measurePeakDb(samples)).toBeCloseTo(-6.02, 1);
  });

  it('trims leading and trailing silence while keeping a short pre-roll', () => {
    const total = RATE;
    const samples = clipAt(2000, 1000, total, 0.4);
    const trimmed = trimSilence(samples, RATE, { thresholdDb: -60, keepMs: 5, tailMs: 20 });

    expect(trimmed.length).toBeLessThan(samples.length);
    expect(trimmed[0]).toBe(0);
    expect(measurePeak(trimmed)).toBeCloseTo(0.4, 6);

    // 5 ms pre-roll plus the 1000 audible samples plus 20 ms tail.
    const expected = Math.round(0.005 * RATE) + 1000 + Math.round(0.02 * RATE);
    expect(trimmed.length).toBe(expected);
  });

  it('returns an empty buffer when the whole clip is silent', () => {
    expect(trimSilence(new Float32Array(1000), RATE).length).toBe(0);
  });

  it('scales a clip to the requested peak', () => {
    const samples = clipAt(0, 100, 200, 0.2);
    const scaled = applyTargetPeak(samples, -3);

    expect(measurePeakDb(scaled)).toBeCloseTo(-3, 3);
    expect(measurePeak(scaled)).toBeLessThanOrEqual(1);
  });

  it('leaves the clip alone when no target is set', () => {
    const samples = clipAt(0, 100, 200, 0.2);
    expect(applyTargetPeak(samples, null)).toBe(samples);
  });

  it('composes trim and peak targeting', () => {
    const samples = clipAt(1000, 500, 4000, 0.3);
    const mastered = masterForExport(samples, RATE, { trim: true, targetPeakDb: -6 });

    expect(mastered.length).toBeLessThan(samples.length);
    expect(measurePeakDb(mastered)).toBeCloseTo(-6, 3);
  });
});
