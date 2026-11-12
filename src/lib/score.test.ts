import { describe, expect, it } from 'vitest';
import {
  BPM_MAX,
  BPM_MIN,
  DEMO_SCORE,
  DRUM_PIECES,
  clampScore,
  createEmptyScore,
  deserializeScore,
  loopSampleCount,
  renderScore,
  secondsPerStep,
  serializeScore,
  stepsPerBar,
  totalSteps,
} from './score';
import type { Score, ScoreNote } from './score';

function scoreWith(notes: ScoreNote[], patch: Partial<Score> = {}): Score {
  return clampScore({
    ...createEmptyScore(),
    ...patch,
    notes,
  });
}

function note(partial: Partial<ScoreNote> & Pick<ScoreNote, 'track' | 'pitch' | 'start'>): ScoreNote {
  return {
    id: partial.id ?? `n-${partial.track}-${partial.start}-${partial.pitch}`,
    length: 1,
    velocity: 1,
    ...partial,
  };
}

function rmsOfWindow(samples: Float32Array, start: number, count: number): number {
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const value = samples[start + index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function maxAdjacentDelta(samples: Float32Array, from: number, to: number): number {
  let max = 0;
  for (let index = Math.max(1, from); index < Math.min(samples.length, to); index += 1) {
    max = Math.max(max, Math.abs((samples[index] ?? 0) - (samples[index - 1] ?? 0)));
  }
  return max;
}

describe('score grid', () => {
  it('maps time signatures to 16th-note steps per bar', () => {
    expect(stepsPerBar({ timeSignature: '4/4' })).toBe(16);
    expect(stepsPerBar({ timeSignature: '3/4' })).toBe(12);
    expect(stepsPerBar({ timeSignature: '2/4' })).toBe(8);
    expect(stepsPerBar({ timeSignature: '6/8' })).toBe(12);
  });

  it('counts 16th steps and seconds from bpm', () => {
    const score = scoreWith([], { bpm: 110, bars: 8, timeSignature: '4/4' });
    expect(totalSteps(score)).toBe(128);
    expect(secondsPerStep(score)).toBeCloseTo(60 / 110 / 4, 12);
    expect(loopSampleCount(score, 44100)).toBe(769745);
  });

  it('keeps the same absolute note length when the signature changes', () => {
    const score = scoreWith([], { bpm: 120, bars: 8, timeSignature: '3/4' });
    expect(totalSteps(score)).toBe(96);
    expect(loopSampleCount(score, 44100)).toBe(529200);

    const sixEight = scoreWith([], { bpm: 120, bars: 4, timeSignature: '6/8' });
    expect(totalSteps(sixEight)).toBe(48);
    expect(loopSampleCount(sixEight, 44100)).toBe(264600);
  });
});

describe('score normalization', () => {
  it('clamps bpm, bars and unknown time signatures', () => {
    expect(clampScore({ ...createEmptyScore(), bpm: 999 }).bpm).toBe(BPM_MAX);
    expect(clampScore({ ...createEmptyScore(), bpm: 1 }).bpm).toBe(BPM_MIN);
    expect(clampScore({ ...createEmptyScore(), bars: 3 }).bars).toBe(4);
    expect(clampScore({ ...createEmptyScore(), bars: 12 }).bars).toBe(8);
    expect(
      clampScore({ ...createEmptyScore(), timeSignature: '7/8' as Score['timeSignature'] }).timeSignature,
    ).toBe('4/4');
  });

  it('drops notes that fall outside a shortened loop', () => {
    const score = scoreWith(
      [note({ track: 'lead', pitch: 60, start: 0 }), note({ track: 'lead', pitch: 62, start: 100 })],
      { bars: 4 },
    );
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0]?.start).toBe(0);
  });

  it('clips note length at the loop end and clamps drum pitch to the kit', () => {
    const score = scoreWith(
      [
        note({ track: 'lead', pitch: 60, start: 62, length: 16 }),
        note({ track: 'drums', pitch: 9, start: 0 }),
      ],
      { bars: 4 },
    );
    expect(score.notes.find((entry) => entry.track === 'lead')?.length).toBe(2);
    expect(score.notes.find((entry) => entry.track === 'drums')?.pitch).toBe(DRUM_PIECES.length - 1);
  });

  it('round-trips through JSON and rejects a wrong version', () => {
    const serialized = serializeScore(DEMO_SCORE);
    const parsed = deserializeScore(serialized);
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(clampScore(DEMO_SCORE)));
    expect(parsed?.notes).toHaveLength(DEMO_SCORE.notes.length);

    expect(deserializeScore('{"version":99,"tracks":[],"notes":[]}')).toBeNull();
    expect(deserializeScore('not json')).toBeNull();
  });
});

describe('score rendering', () => {
  it('renders the demo loop at exactly 769,745 samples', () => {
    const render = renderScore(DEMO_SCORE, { sampleRate: 44100 });
    expect(render.loopSamples).toBe(769745);
    expect(render.samples).toHaveLength(769745);
    expect(render.noteCount).toBe(154);
    expect(render.peak).toBeLessThanOrEqual(0.995 + 1e-6);
    expect(render.peak).toBeGreaterThan(0.05);
    expect(render.clippedSamples).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(render.rmsDb)).toBe(true);
    expect(render.samples.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('is deterministic for the same score and seed', () => {
    const score = scoreWith(
      [
        note({ track: 'lead', pitch: 69, start: 0, length: 8 }),
        note({ track: 'drums', pitch: 1, start: 4 }),
        note({ track: 'drums', pitch: 2, start: 8 }),
      ],
      { bpm: 140 },
    );
    const first = renderScore(score, { sampleRate: 8000, seed: 1234 });
    const second = renderScore(score, { sampleRate: 8000, seed: 1234 });
    expect(Array.from(first.samples)).toEqual(Array.from(second.samples));
  });

  it('builds a 2.667 s long note without a seam click or level drift', () => {
    const score = scoreWith(
      [note({ track: 'bass', pitch: 45, start: 0, length: 16 })],
      { bpm: 90 },
    );
    const sampleRate = 44100;
    const render = renderScore(score, { sampleRate, seed: 42 });
    // 8 bars at 90 bpm is 21.33 s; the note itself is 16 steps = 2.667 s.
    expect(render.loopSamples).toBe(940800);

    const window = Math.round(0.1 * sampleRate);
    const levels: number[] = [];
    const noteEnd = Math.round(2.5 * sampleRate);
    for (let start = Math.round(0.5 * sampleRate); start + window < noteEnd; start += window) {
      levels.push(rmsOfWindow(render.samples, start, window));
    }

    const min = Math.min(...levels);
    const max = Math.max(...levels);
    expect(min).toBeGreaterThan(0);
    expect(max / min).toBeLessThan(1.15);

    // A sine at 110 Hz moves at most ~2*pi*110/44100 * amplitude per sample.
    // A splice click would be orders of magnitude larger.
    const delta = maxAdjacentDelta(render.samples, Math.round(0.4 * sampleRate), Math.round(2.5 * sampleRate));
    expect(delta).toBeLessThan(0.02);
  });

  it('keeps a very short note inside its step at 240 bpm', () => {
    const score = scoreWith([note({ track: 'lead', pitch: 69, start: 0, length: 1 })], { bpm: 240 });
    const render = renderScore(score, { sampleRate: 44100 });
    expect(render.loopSamples).toBe(352800);
    expect(render.peak).toBeGreaterThan(0);
    expect(render.samples.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('wraps a drum tail past the loop point into the start of the buffer', () => {
    const score = scoreWith([note({ track: 'drums', pitch: 0, start: 127 })], { bpm: 110 });
    const render = renderScore(score, { sampleRate: 44100, seed: 3 });
    expect(render.samples[0]).not.toBe(0);
    expect(rmsOfWindow(render.samples, 0, 256)).toBeGreaterThan(0);
  });

  it('returns an exact-length silent buffer for an empty score', () => {
    const score = scoreWith([], { bpm: 110 });
    const render = renderScore(score, { sampleRate: 44100 });
    expect(render.loopSamples).toBe(769745);
    expect(render.peak).toBe(0);
    expect(render.samples.every((value) => value === 0)).toBe(true);
    expect(render.rmsDb).toBe(Number.NEGATIVE_INFINITY);
  });

  it('counts only unmuted tracks in noteCount and renders them differently', () => {
    const score = scoreWith(
      [
        note({ track: 'lead', pitch: 69, start: 0, length: 4 }),
        note({ track: 'bass', pitch: 45, start: 0, length: 4 }),
      ],
    );
    const full = renderScore(score, { sampleRate: 8000 });
    expect(full.noteCount).toBe(2);

    const muted = clampScore({
      ...score,
      tracks: score.tracks.map((track) => (track.id === 'bass' ? { ...track, mute: true } : track)),
    });
    const withoutBass = renderScore(muted, { sampleRate: 8000 });
    expect(withoutBass.noteCount).toBe(1);
    expect(Array.from(withoutBass.samples)).not.toEqual(Array.from(full.samples));
  });
});
