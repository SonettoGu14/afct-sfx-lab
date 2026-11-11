import { describe, expect, it } from 'vitest';
import {
  FX_MAX_TAIL_SECONDS,
  FX_PEAK_CEILING,
  applyBitcrush,
  applyDelay,
  applyDrive,
  applyFadeOut,
  applyFxChain,
  applyPeakCeiling,
  applyReverb,
  applyTone,
  fxDelaySeconds,
  fxTailSeconds,
} from './effects';
import { DEFAULT_SFX_PARAMS } from './sfx';

const SAMPLE_RATE = 22050;

function sineBuffer(length = 2048, amplitude = 0.5, frequency = 220): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * amplitude;
  }
  return samples;
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }
  return peak;
}

function allFinite(samples: Float32Array): boolean {
  for (let index = 0; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index] ?? 0)) {
      return false;
    }
  }
  return true;
}

describe('fx chain primitives', () => {
  it('soft-clips drive without exceeding unity', () => {
    const samples = sineBuffer(1024, 1.4);
    applyDrive(samples, 1);

    expect(allFinite(samples)).toBe(true);
    expect(peakOf(samples)).toBeLessThanOrEqual(1);
    expect(peakOf(samples)).toBeGreaterThan(0.9);
  });

  it('quantizes amplitude into few levels when bitcrushing', () => {
    const samples = sineBuffer(512, 0.9);
    applyBitcrush(samples, 0, 1);

    const levels = new Set<number>();
    for (let index = 0; index < samples.length; index += 1) {
      levels.add(Math.round((samples[index] ?? 0) * 1000));
    }

    expect(levels.size).toBeLessThanOrEqual(5);
  });

  it('holds samples when the crush rate is lowered', () => {
    const samples = sineBuffer(256, 0.5);
    applyBitcrush(samples, 1, 0);

    expect(samples[0]).toBe(samples[1]);
    expect(samples[0]).toBe(samples[2]);
  });

  it('tilts tone toward the requested band', () => {
    const dark = Float32Array.from([0, 0.5, -0.5, 0.25, -0.25, 0.1]);
    const bright = new Float32Array(dark);
    applyTone(dark, -1, SAMPLE_RATE);
    applyTone(bright, 1, SAMPLE_RATE);

    expect(peakOf(bright)).toBeGreaterThan(peakOf(dark));
    expect(allFinite(dark)).toBe(true);
  });

  it('places the first echo one delay later', () => {
    const samples = new Float32Array(4096);
    samples[0] = 1;
    const delaySeconds = fxDelaySeconds(0);
    applyDelay(samples, SAMPLE_RATE, delaySeconds, 0.4, 0.6);

    const echoIndex = Math.round(delaySeconds * SAMPLE_RATE);
    expect(Math.abs(samples[echoIndex] ?? 0)).toBeGreaterThan(0.1);
    expect(Math.abs(samples[echoIndex - 1] ?? 0)).toBeLessThan(0.01);
    expect(allFinite(samples)).toBe(true);
  });

  it('keeps echo energy bounded at maximum feedback', () => {
    const samples = new Float32Array(SAMPLE_RATE);
    samples[0] = 1;
    applyDelay(samples, SAMPLE_RATE, 0.05, 1, 1);

    expect(allFinite(samples)).toBe(true);
    expect(peakOf(samples)).toBeLessThan(10);
  });

  it('adds a bounded reverb tail after the dry signal', () => {
    const samples = new Float32Array(8192);
    samples[0] = 1;
    applyReverb(samples, SAMPLE_RATE, 0.8, 0.6);

    const dryWindowEnd = Math.round(0.01 * SAMPLE_RATE);
    let tailEnergy = 0;
    for (let index = dryWindowEnd; index < samples.length; index += 1) {
      tailEnergy += Math.abs(samples[index] ?? 0);
    }

    expect(tailEnergy).toBeGreaterThan(0);
    expect(allFinite(samples)).toBe(true);
    expect(peakOf(samples)).toBeLessThan(2);
  });

  it('scales only buffers louder than the ceiling', () => {
    const loud = Float32Array.from([0, 2, -1.5, 0.5]);
    applyPeakCeiling(loud);
    expect(peakOf(loud)).toBeCloseTo(FX_PEAK_CEILING, 5);

    const quiet = Float32Array.from([0, 0.2, -0.3]);
    const snapshot = Array.from(quiet);
    applyPeakCeiling(quiet);
    expect(Array.from(quiet)).toEqual(snapshot);
  });

  it('fades the buffer tail to silence', () => {
    const samples = new Float32Array(1024).fill(1);
    applyFadeOut(samples, SAMPLE_RATE, 10);

    expect(samples[samples.length - 1]).toBe(0);
    expect(samples[0]).toBe(1);
  });

  it('reports tail length from delay and reverb settings', () => {
    expect(fxTailSeconds(DEFAULT_SFX_PARAMS)).toBe(0);
    expect(fxTailSeconds({ ...DEFAULT_SFX_PARAMS, fxDelayMix: 0.5 })).toBeGreaterThan(0);
    expect(fxTailSeconds({ ...DEFAULT_SFX_PARAMS, fxReverbMix: 0.5 })).toBeGreaterThan(0);
    expect(
      fxTailSeconds({ ...DEFAULT_SFX_PARAMS, fxDelayMix: 1, fxReverbMix: 1, fxDelayFeedback: 1 }),
    ).toBeLessThanOrEqual(FX_MAX_TAIL_SECONDS);
  });
});

describe('full fx chain', () => {
  it('keeps normalized output under the peak ceiling', () => {
    const samples = sineBuffer(2048, 1.6);
    applyFxChain(samples, {
      ...DEFAULT_SFX_PARAMS,
      fxDrive: 0.8,
      fxDelayMix: 0.4,
      fxReverbMix: 0.5,
      fxNormalize: 1,
    }, SAMPLE_RATE);

    expect(peakOf(samples)).toBeLessThanOrEqual(FX_PEAK_CEILING + 1e-6);
    expect(allFinite(samples)).toBe(true);
  });

  it('allows overshoot when normalization is disabled', () => {
    const samples = sineBuffer(2048, 1.6);
    applyFxChain(samples, {
      ...DEFAULT_SFX_PARAMS,
      fxDrive: 0.6,
      fxReverbMix: 0.5,
      fxNormalize: 0,
    }, SAMPLE_RATE);

    expect(peakOf(samples)).toBeGreaterThan(FX_PEAK_CEILING);
  });

  it('is a no-op for a fully dry chain', () => {
    const dry = sineBuffer(512, 0.4);
    const reference = new Float32Array(dry);
    applyFadeOut(reference, SAMPLE_RATE);
    applyFxChain(dry, { ...DEFAULT_SFX_PARAMS, fxNormalize: 0 }, SAMPLE_RATE);

    expect(Array.from(dry)).toEqual(Array.from(reference));
  });
});
