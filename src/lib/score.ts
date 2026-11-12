/**
 * Score layer: turn the SFX synth into an instrument for short loops.
 *
 * Nothing here changes the synth. Every note is still a single `renderSfx()`
 * call; this module only supplies the timeline, the instruments, the mixing and
 * the loop. The engine invariant that matters: a rendered note is at most
 * ~1.22 s (attack + sustain + decay), so longer notes are built by tiling the
 * steady part of a `sustain = 1, decay = 0` render with a short crossfade.
 */

import { FX_PEAK_CEILING } from './effects';
import { measurePeak } from './mastering';
import {
  DEFAULT_SFX_PARAMS,
  renderSfx,
  type SfxParams,
  type SfxSampleRate,
} from './sfx';

export const SCORE_VERSION = 1;

export type TimeSignature = '4/4' | '3/4' | '2/4' | '6/8';

export const TIME_SIGNATURES: TimeSignature[] = ['4/4', '3/4', '2/4', '6/8'];

const SIGNATURE_GRID: Record<TimeSignature, { numerator: number; denominator: number }> = {
  '4/4': { numerator: 4, denominator: 4 },
  '3/4': { numerator: 3, denominator: 4 },
  '2/4': { numerator: 2, denominator: 4 },
  '6/8': { numerator: 6, denominator: 8 },
};

export type TrackId = 'lead' | 'bass' | 'chords' | 'drums';

export type TonalInstrumentId =
  | 'leadSquare'
  | 'leadPulse'
  | 'bassSine'
  | 'bassSquare'
  | 'padWarm'
  | 'pluck';

export type DrumPieceId = 'kick' | 'snare' | 'hatClosed' | 'hatOpen' | 'tom';

export type InstrumentId = TonalInstrumentId | DrumPieceId;

export type TonalInstrument = {
  id: TonalInstrumentId;
  kind: 'tonal';
  /** 'sustain' tiles the steady part; 'decay' lets the envelope ring down. */
  envelope: 'sustain' | 'decay';
  params: SfxParams;
  gain: number;
};

export type PercussiveInstrument = {
  id: DrumPieceId;
  kind: 'percussive';
  params: SfxParams;
  gain: number;
};

export type Instrument = TonalInstrument | PercussiveInstrument;

export type TonalTrack = {
  id: 'lead' | 'bass' | 'chords';
  kind: 'tonal';
  instrument: TonalInstrumentId;
  gain: number;
  mute: boolean;
};

export type DrumTrack = {
  id: 'drums';
  kind: 'percussive';
  instrument: null;
  gain: number;
  mute: boolean;
};

export type ScoreTrack = TonalTrack | DrumTrack;

export type ScoreNote = {
  id: string;
  track: TrackId;
  /** MIDI note for tonal tracks; a DRUM_PIECES index for the drum track. */
  pitch: number;
  /** 16th-note step within the loop. */
  start: number;
  /** Length in 16th-note steps; ignored by the drum track. */
  length: number;
  velocity: number;
};

export type Score = {
  version: typeof SCORE_VERSION;
  bpm: number;
  timeSignature: TimeSignature;
  bars: number;
  stepsPerBeat: 4;
  seed: number;
  tracks: ScoreTrack[];
  notes: ScoreNote[];
};

export type ScoreRender = {
  samples: Float32Array;
  loopSamples: number;
  loopSeconds: number;
  peak: number;
  rmsDb: number;
  clippedSamples: number;
  noteCount: number;
  renderMs: number;
};

/** Loop head taken from the sustain render before tiling starts. */
const SUSTAIN_HEAD_SECONDS = 0.4;
/** Steady slice copied for each extra tile. */
const SUSTAIN_TILE_SECONDS = 0.25;
const SUSTAIN_TILE_OFFSET_SECONDS = 0.4;
const SUSTAIN_XFADE_SECONDS = 0.006;
const NOTE_RELEASE_SECONDS = 0.06;
/** Peak of every note must stay under the FX ceiling; the bus only limits down. */
const BUS_CEILING = FX_PEAK_CEILING;

const TONAL_BASE: SfxParams = {
  ...DEFAULT_SFX_PARAMS,
  engine: 'sfxr',
  attack: 0,
  sustain: 1,
  sustainPunch: 0,
  decay: 0,
  startFrequency: 0.5,
  minFrequency: 0,
  slide: 0,
  deltaSlide: 0,
  vibratoDepth: 0,
  vibratoSpeed: 0,
  changeAmount: 0,
  changeSpeed: 0,
  squareDuty: 0.5,
  dutySweep: 0,
  repeatSpeed: 0,
  phaserOffset: 0,
  phaserSweep: 0,
  lowPassCutoff: 0.7,
  lowPassSweep: 0,
  lowPassResonance: 1,
  highPassCutoff: 0,
  highPassSweep: 0,
  masterVolume: 0.7,
  fxDrive: 0,
  fxCrushRate: 0,
  fxCrushBits: 0,
  fxTone: 0,
  fxDelayTime: 0.25,
  fxDelayFeedback: 0.3,
  fxDelayMix: 0,
  fxReverbSize: 0.5,
  fxReverbMix: 0,
  fxNormalize: 0,
};

function tonalParams(overrides: Partial<SfxParams>): SfxParams {
  return { ...TONAL_BASE, ...overrides };
}

function percussiveParams(overrides: Partial<SfxParams>): SfxParams {
  return {
    ...TONAL_BASE,
    sustain: 0.02,
    decay: 0.12,
    masterVolume: 0.7,
    ...overrides,
  };
}

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  leadSquare: {
    id: 'leadSquare',
    kind: 'tonal',
    envelope: 'sustain',
    gain: 0.45,
    params: tonalParams({ waveform: 'square', attack: 0.012, squareDuty: 0.5, lowPassCutoff: 0.7 }),
  },
  leadPulse: {
    id: 'leadPulse',
    kind: 'tonal',
    envelope: 'sustain',
    gain: 0.4,
    params: tonalParams({ waveform: 'square', attack: 0.008, squareDuty: 0.25, lowPassCutoff: 0.75, lowPassResonance: 0.8 }),
  },
  bassSine: {
    id: 'bassSine',
    kind: 'tonal',
    envelope: 'sustain',
    gain: 0.55,
    params: tonalParams({ waveform: 'sine', attack: 0.006, lowPassCutoff: 0.35 }),
  },
  bassSquare: {
    id: 'bassSquare',
    kind: 'tonal',
    envelope: 'sustain',
    gain: 0.42,
    params: tonalParams({ waveform: 'square', attack: 0.006, squareDuty: 0.35, lowPassCutoff: 0.45, lowPassResonance: 0.9 }),
  },
  padWarm: {
    id: 'padWarm',
    kind: 'tonal',
    envelope: 'sustain',
    gain: 0.3,
    params: tonalParams({ waveform: 'sine', attack: 0.18, lowPassCutoff: 0.5 }),
  },
  pluck: {
    id: 'pluck',
    kind: 'tonal',
    envelope: 'decay',
    gain: 0.45,
    params: tonalParams({ waveform: 'square', sustain: 0.1, decay: 0.18, squareDuty: 0.5, lowPassCutoff: 0.75 }),
  },
  kick: {
    id: 'kick',
    kind: 'percussive',
    gain: 0.9,
    params: percussiveParams({
      waveform: 'sine',
      sustain: 0.02,
      decay: 0.12,
      startFrequency: 0.6,
      slide: -0.45,
      lowPassCutoff: 0.9,
      highPassCutoff: 0,
    }),
  },
  snare: {
    id: 'snare',
    kind: 'percussive',
    gain: 0.55,
    params: percussiveParams({
      waveform: 'noise',
      sustain: 0.03,
      decay: 0.14,
      highPassCutoff: 0.08,
      lowPassCutoff: 0.8,
    }),
  },
  hatClosed: {
    id: 'hatClosed',
    kind: 'percussive',
    gain: 0.3,
    params: percussiveParams({
      waveform: 'noise',
      sustain: 0.004,
      decay: 0.035,
      highPassCutoff: 0.55,
      lowPassCutoff: 1,
    }),
  },
  hatOpen: {
    id: 'hatOpen',
    kind: 'percussive',
    gain: 0.25,
    params: percussiveParams({
      waveform: 'noise',
      sustain: 0.01,
      decay: 0.22,
      highPassCutoff: 0.5,
      lowPassCutoff: 1,
    }),
  },
  tom: {
    id: 'tom',
    kind: 'percussive',
    gain: 0.6,
    params: percussiveParams({
      waveform: 'sine',
      sustain: 0.02,
      decay: 0.2,
      startFrequency: 0.5,
      slide: -0.2,
      lowPassCutoff: 0.6,
    }),
  },
};

export const TONAL_INSTRUMENT_IDS: TonalInstrumentId[] = [
  'leadSquare',
  'leadPulse',
  'bassSine',
  'bassSquare',
  'padWarm',
  'pluck',
];

export const DRUM_PIECES: DrumPieceId[] = ['kick', 'snare', 'hatClosed', 'hatOpen', 'tom'];

export const TRACK_IDS: TrackId[] = ['lead', 'bass', 'chords', 'drums'];

export const TRACK_BASE_PITCH: Record<'lead' | 'bass' | 'chords', number> = {
  lead: 60,
  bass: 36,
  chords: 48,
};

export const TRACK_PITCH_ROWS = 24;

export const DEFAULT_TRACKS: ScoreTrack[] = [
  { id: 'lead', kind: 'tonal', instrument: 'leadSquare', gain: 0.9, mute: false },
  { id: 'bass', kind: 'tonal', instrument: 'bassSine', gain: 0.6, mute: false },
  { id: 'chords', kind: 'tonal', instrument: 'padWarm', gain: 0.3, mute: false },
  { id: 'drums', kind: 'percussive', instrument: null, gain: 0.7, mute: false },
];

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const BARS_CHOICES = [4, 8];

export function isTimeSignature(value: unknown): value is TimeSignature {
  return typeof value === 'string' && (TIME_SIGNATURES as string[]).includes(value);
}

export function isTrackId(value: unknown): value is TrackId {
  return typeof value === 'string' && (TRACK_IDS as string[]).includes(value);
}

export function isTonalInstrumentId(value: unknown): value is TonalInstrumentId {
  return typeof value === 'string' && (TONAL_INSTRUMENT_IDS as string[]).includes(value);
}

export function isDrumPieceId(value: unknown): value is DrumPieceId {
  return typeof value === 'string' && (DRUM_PIECES as string[]).includes(value);
}

export function stepsPerBar(score: Pick<Score, 'timeSignature'>): number {
  const grid = SIGNATURE_GRID[score.timeSignature] ?? SIGNATURE_GRID['4/4'];
  return (grid.numerator * 16) / grid.denominator;
}

export function secondsPerStep(score: Pick<Score, 'bpm'>): number {
  return 60 / clampBpm(score.bpm) / 4;
}

export function totalSteps(score: Pick<Score, 'bars' | 'timeSignature'>): number {
  return clampBars(score.bars) * stepsPerBar(score);
}

export function loopSampleCount(score: Score, sampleRate: number): number {
  return Math.max(1, Math.round(totalSteps(score) * secondsPerStep(score) * sampleRate));
}

export function loopSeconds(score: Pick<Score, 'bpm' | 'bars' | 'timeSignature'>): number {
  return totalSteps(score) * secondsPerStep(score);
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Inverse of the engine's `32 * 2 ** (value * 6.5)` frequency mapping. */
export function hzToSfxFrequency(hz: number): number {
  const value = Math.log2(hz / 32) / 6.5;
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

function clampBpm(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 110;
  }
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(value)));
}

function clampBars(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 8;
  }
  return value >= 6 ? 8 : 4;
}

function clampUnit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function createEmptyScore(): Score {
  return {
    version: SCORE_VERSION,
    bpm: 110,
    timeSignature: '4/4',
    bars: 8,
    stepsPerBeat: 4,
    seed: 1,
    tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
    notes: [],
  };
}

/**
 * Normalizes an untrusted score into a usable one. Never throws: unknown
 * values fall back to defaults and notes that cannot be placed are dropped.
 */
export function clampScore(input: Score): Score {
  const raw = input as unknown as Record<string, unknown>;
  const timeSignature = isTimeSignature(raw.timeSignature) ? raw.timeSignature : '4/4';
  const bpm = clampBpm(raw.bpm);
  const bars = clampBars(raw.bars);
  const seed = finiteNumber(raw.seed) ? raw.seed >>> 0 : 1;

  const rawTracks = Array.isArray(raw.tracks) ? (raw.tracks as unknown[]) : [];
  const trackById = new Map<string, Record<string, unknown>>();

  for (const candidate of rawTracks) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    if (isTrackId(record.id) && !trackById.has(record.id)) {
      trackById.set(record.id, record);
    }
  }

  const tracks: ScoreTrack[] = DEFAULT_TRACKS.map((fallback) => {
    const candidate = trackById.get(fallback.id);

    if (!candidate) {
      return { ...fallback };
    }

    if (fallback.kind === 'percussive') {
      return {
        id: 'drums',
        kind: 'percussive',
        instrument: null,
        gain: clampUnit(candidate.gain),
        mute: candidate.mute === true,
      };
    }

    const instrument = isTonalInstrumentId(candidate.instrument)
      ? candidate.instrument
      : fallback.instrument;

    return {
      id: fallback.id,
      kind: 'tonal',
      instrument,
      gain: clampUnit(candidate.gain),
      mute: candidate.mute === true,
    };
  });

  const safe: Score = {
    version: SCORE_VERSION,
    bpm,
    timeSignature,
    bars,
    stepsPerBeat: 4,
    seed,
    tracks,
    notes: [],
  };

  const steps = totalSteps(safe);
  const rawNotes = Array.isArray(raw.notes) ? (raw.notes as unknown[]) : [];
  const notes: ScoreNote[] = [];

  for (const candidate of rawNotes) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const record = candidate as Record<string, unknown>;

    if (!isTrackId(record.track)) {
      continue;
    }

    if (!finiteNumber(record.start) || !finiteNumber(record.length) || !finiteNumber(record.pitch)) {
      continue;
    }

    const trackId = record.track;
    const isDrums = trackId === 'drums';
    const start = Math.round(record.start);

    if (start < 0 || start >= steps) {
      continue;
    }

    const length = isDrums ? 1 : Math.round(record.length);
    if (length < 1) {
      continue;
    }

    const clippedLength = Math.min(length, steps - start);
    const pitch = Math.round(record.pitch);
    const safePitch = isDrums
      ? Math.min(DRUM_PIECES.length - 1, Math.max(0, pitch))
      : Math.min(127, Math.max(0, pitch));

    notes.push({
      id: typeof record.id === 'string' && record.id.length > 0 ? record.id : `n${notes.length + 1}`,
      track: trackId,
      pitch: safePitch,
      start,
      length: clippedLength,
      velocity: clampUnit(record.velocity),
    });
  }

  notes.sort((left, right) => left.start - right.start || left.pitch - right.pitch);
  safe.notes = notes;

  return safe;
}

export function serializeScore(score: Score): string {
  return JSON.stringify(clampScore(score), null, 2);
}

export function deserializeScore(raw: unknown): Score | null {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (record.version !== SCORE_VERSION) {
    return null;
  }

  if (!Array.isArray(record.notes) || !Array.isArray(record.tracks)) {
    return null;
  }

  return clampScore(parsed as Score);
}

function applyRelease(samples: Float32Array, releaseSamples: number): void {
  const count = Math.min(samples.length, Math.max(0, Math.round(releaseSamples)));

  if (count <= 0) {
    return;
  }

  const start = samples.length - count;

  for (let offset = 0; offset < count; offset += 1) {
    const gain = 0.5 * (1 + Math.cos((Math.PI * offset) / count));
    samples[start + offset] = (samples[start + offset] ?? 0) * gain;
  }
}

/**
 * Copies the head of a sustain render and tiles its steady slice with a short
 * crossfade until `totalSamples` is filled. The first tile does not overlap.
 */
function tileSustained(source: Float32Array, totalSamples: number, sampleRate: SfxSampleRate): Float32Array {
  const output = new Float32Array(totalSamples);
  const headSamples = Math.min(
    totalSamples,
    Math.max(1, Math.round(SUSTAIN_HEAD_SECONDS * sampleRate)),
  );
  output.set(source.subarray(0, Math.min(source.length, headSamples)), 0);

  if (totalSamples <= headSamples) {
    return output;
  }

  const tileSamples = Math.max(1, Math.round(SUSTAIN_TILE_SECONDS * sampleRate));
  const tileOffset = Math.max(0, Math.round(SUSTAIN_TILE_OFFSET_SECONDS * sampleRate));
  const xfadeSamples = Math.min(
    Math.max(1, Math.round(SUSTAIN_XFADE_SECONDS * sampleRate)),
    Math.floor(tileSamples / 2),
  );

  let start = headSamples;

  while (start < totalSamples) {
    const count = Math.min(tileSamples, totalSamples - start);
    const overlap = start === headSamples ? 0 : xfadeSamples;

    for (let index = 0; index < count; index += 1) {
      const sourceIndex = tileOffset + index;
      const sample = source[sourceIndex] ?? 0;
      const targetIndex = start + index;

      if (index < overlap) {
        const weight = (index + 1) / (overlap + 1);
        output[targetIndex] = (output[targetIndex] ?? 0) * (1 - weight) + sample * weight;
      } else {
        output[targetIndex] = sample;
      }
    }

    if (start + count >= totalSamples) {
      break;
    }

    start += tileSamples - xfadeSamples;
  }

  return output;
}

function renderTonalNote(
  instrument: TonalInstrument,
  hz: number,
  bodySamples: number,
  releaseSamples: number,
  sampleRate: SfxSampleRate,
  seed: number,
): Float32Array {
  const totalSamples = bodySamples + releaseSamples;
  const params: SfxParams = {
    ...instrument.params,
    startFrequency: hzToSfxFrequency(hz),
  };

  if (instrument.envelope === 'sustain') {
    params.sustain = 1;
    params.decay = 0;
    params.sustainPunch = 0;
  }

  const rendered = renderSfx(params, { sampleRate, bitDepth: 16, seed }).samples;
  let output: Float32Array;

  if (instrument.envelope === 'sustain') {
    output = tileSustained(rendered, totalSamples, sampleRate);
  } else {
    output = new Float32Array(totalSamples);
    output.set(rendered.subarray(0, Math.min(rendered.length, totalSamples)), 0);
  }

  applyRelease(output, releaseSamples);
  return output;
}

function mixInto(target: Float32Array, source: Float32Array, offset: number, gain: number): void {
  const length = target.length;
  const start = ((offset % length) + length) % length;
  const head = Math.min(source.length, length - start);

  for (let index = 0; index < head; index += 1) {
    target[start + index] = (target[start + index] ?? 0) + (source[index] ?? 0) * gain;
  }

  for (let index = head; index < source.length; index += 1) {
    const wrapped = index - head;
    target[wrapped] = (target[wrapped] ?? 0) + (source[index] ?? 0) * gain;
  }
}

function trackNoteGain(track: ScoreTrack, note: ScoreNote, instrument: Instrument): number {
  return track.gain * note.velocity * instrument.gain;
}

export function renderScore(
  score: Score,
  options: { sampleRate: SfxSampleRate; seed?: number },
): ScoreRender {
  const startedAt = Date.now();
  const safe = clampScore(score);
  const sampleRate = options.sampleRate;
  const steps = totalSteps(safe);
  const loopSamples = Math.max(1, Math.round(steps * secondsPerStep(safe) * sampleRate));
  const mix = new Float32Array(loopSamples);
  const trackById = new Map<TrackId, ScoreTrack>(safe.tracks.map((track) => [track.id, track]));
  const releaseSamples = Math.max(1, Math.round(NOTE_RELEASE_SECONDS * sampleRate));

  for (let index = 0; index < safe.notes.length; index += 1) {
    const note = safe.notes[index];
    const track = trackById.get(note.track);

    if (!track || track.mute) {
      continue;
    }

    const noteSeed = ((options.seed ?? safe.seed) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;

    if (track.kind === 'percussive') {
      const pieceId = DRUM_PIECES[note.pitch] ?? 'kick';
      const instrument = INSTRUMENTS[pieceId];
      const offset = Math.round((note.start / steps) * loopSamples);
      const rendered = renderSfx(instrument.params, {
        sampleRate,
        bitDepth: 16,
        seed: noteSeed,
      }).samples;
      mixInto(mix, rendered, offset, trackNoteGain(track, note, instrument));
      continue;
    }

    const instrument = INSTRUMENTS[track.instrument];

    if (instrument.kind !== 'tonal') {
      continue;
    }

    const startSample = Math.round((note.start / steps) * loopSamples);
    const endSample = Math.round(((note.start + note.length) / steps) * loopSamples);
    const bodySamples = Math.max(1, endSample - startSample);
    const noteRelease = Math.min(releaseSamples, Math.max(1, Math.floor(bodySamples / 3)));
    const hz = midiToFrequency(note.pitch);
    const rendered = renderTonalNote(instrument, hz, bodySamples, noteRelease, sampleRate, noteSeed);
    mixInto(mix, rendered, startSample, trackNoteGain(track, note, instrument));
  }

  let clippedSamples = 0;
  let peak = 0;

  for (let index = 0; index < mix.length; index += 1) {
    const magnitude = Math.abs(mix[index] ?? 0);

    if (magnitude > 1) {
      clippedSamples += 1;
    }

    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  if (peak > BUS_CEILING && peak > 0) {
    const scale = BUS_CEILING / peak;
    for (let index = 0; index < mix.length; index += 1) {
      mix[index] = (mix[index] ?? 0) * scale;
    }
    peak = BUS_CEILING;
  }

  let sumSquares = 0;
  for (let index = 0; index < mix.length; index += 1) {
    const value = Math.min(1, Math.max(-1, mix[index] ?? 0));
    mix[index] = value;
    sumSquares += value * value;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, mix.length));
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;

  return {
    samples: mix,
    loopSamples,
    loopSeconds: loopSamples / sampleRate,
    peak: measurePeak(mix),
    rmsDb,
    clippedSamples,
    noteCount: safe.notes.reduce((count, note) => {
      const track = trackById.get(note.track);
      return track && !track.mute ? count + 1 : count;
    }, 0),
    renderMs: Date.now() - startedAt,
  };
}

type NoteSpec = [track: TrackId, pitch: number, startBeat: number, lengthBeats: number, velocity?: number];

function buildDemoScore(): Score {
  const specs: NoteSpec[] = [];

  const melody: Array<[number, number, number]> = [
    [69, 0, 1], [72, 1, 1], [76, 2, 2],
    [77, 4, 1], [76, 5, 1], [72, 6, 1], [74, 7, 1],
    [76, 8, 1.5], [72, 9.5, 0.5], [69, 10, 1], [67, 11, 1],
    [74, 12, 2],
    [72, 16, 1], [76, 17, 1], [81, 18, 2],
    [79, 20, 1], [77, 21, 1], [76, 22, 1], [72, 23, 1],
    [74, 24, 1.5], [76, 25.5, 0.5], [79, 26, 1], [76, 27, 1],
    [74, 28, 1], [72, 29, 1], [69, 30, 2],
  ];

  for (const [pitch, startBeat, lengthBeats] of melody) {
    specs.push(['lead', pitch, startBeat, lengthBeats]);
  }

  const bass: Array<[number, number, number]> = [
    [45, 0, 2], [52, 2, 2], [41, 4, 2], [48, 6, 2],
    [48, 8, 2], [55, 10, 2], [43, 12, 2], [50, 14, 2],
    [45, 16, 2], [52, 18, 2], [41, 20, 2], [48, 22, 2],
    [43, 24, 2], [50, 26, 2], [48, 28, 2], [55, 30, 2],
  ];

  for (const [pitch, startBeat, lengthBeats] of bass) {
    specs.push(['bass', pitch, startBeat, lengthBeats]);
  }

  const padChords: number[][] = [
    [57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62],
    [57, 60, 64], [53, 57, 60], [55, 59, 62], [60, 64, 67],
  ];

  padChords.forEach((chord, bar) => {
    for (const half of [0, 2]) {
      for (const pitch of chord) {
        specs.push(['chords', pitch, bar * 4 + half, 2, 0.9]);
      }
    }
  });

  for (let bar = 0; bar < 8; bar += 1) {
    const barStart = bar * 4;
    // pitch 0 = kick, 1 = snare, 2 = closed hat
    specs.push(['drums', 0, barStart, 1, 1], ['drums', 0, barStart + 2, 1, 0.9]);
    specs.push(['drums', 1, barStart + 1, 1, 0.95], ['drums', 1, barStart + 3, 1, 0.95]);
    for (const beat of [0, 1, 2, 3]) {
      specs.push(['drums', 2, barStart + beat, 1, 0.7]);
    }
  }

  const notes: ScoreNote[] = specs.map(([track, pitch, startBeat, lengthBeats, velocity], index) => ({
    id: `n${index + 1}`,
    track,
    pitch,
    start: Math.round(startBeat * 4),
    length: Math.max(1, Math.round(lengthBeats * 4)),
    velocity: velocity ?? 1,
  }));

  return {
    version: SCORE_VERSION,
    bpm: 110,
    timeSignature: '4/4',
    bars: 8,
    stepsPerBeat: 4,
    seed: 7,
    tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
    notes,
  };
}

export const DEMO_SCORE: Score = clampScore(buildDemoScore());
