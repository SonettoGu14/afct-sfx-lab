import { FX_MAX_RENDER_SECONDS, applyFxChain, fxTailSeconds } from './effects';
import { createSeededRandom } from './prng';

export type SfxWaveform = 'square' | 'sawtooth' | 'sine' | 'noise';
export type SfxEngine = 'sfxr' | 'footsteppr';
export type SfxFootstepTerrain =
  | 'snow'
  | 'grass'
  | 'dirt'
  | 'gravel'
  | 'mud'
  | 'wood'
  | 'metal'
  | 'water';

export type SfxPresetId =
  | 'random'
  | 'mutate'
  | 'click'
  | 'blipSelect'
  | 'hoverTick'
  | 'notifyPop'
  | 'successChime'
  | 'errorBuzz'
  | 'pickupCoin'
  | 'laserShoot'
  | 'explosion'
  | 'powerup'
  | 'hitHurt'
  | 'jump'
  | 'whoosh'
  | 'riser'
  | 'impact'
  | 'glitch'
  | 'synth'
  | 'tone'
  | 'footstepSnow'
  | 'footstepGrass'
  | 'footstepDirt'
  | 'footstepGravel'
  | 'footstepMud'
  | 'footstepWood'
  | 'footstepMetal'
  | 'footstepWater';

export type SfxParams = {
  engine: SfxEngine;
  waveform: SfxWaveform;
  footstepTerrain: SfxFootstepTerrain;
  footstepHeel: number;
  footstepRoll: number;
  footstepBall: number;
  footstepSwiftness: number;
  attack: number;
  sustain: number;
  sustainPunch: number;
  decay: number;
  startFrequency: number;
  minFrequency: number;
  slide: number;
  deltaSlide: number;
  vibratoDepth: number;
  vibratoSpeed: number;
  changeAmount: number;
  changeSpeed: number;
  squareDuty: number;
  dutySweep: number;
  repeatSpeed: number;
  phaserOffset: number;
  phaserSweep: number;
  lowPassCutoff: number;
  lowPassSweep: number;
  lowPassResonance: number;
  highPassCutoff: number;
  highPassSweep: number;
  masterVolume: number;
  fxDrive: number;
  fxCrushRate: number;
  fxCrushBits: number;
  fxTone: number;
  fxDelayTime: number;
  fxDelayFeedback: number;
  fxDelayMix: number;
  fxReverbSize: number;
  fxReverbMix: number;
  fxNormalize: number;
};

export type SfxBitDepth = 8 | 16;
export type SfxSampleRate = 8000 | 11025 | 22050 | 44100 | 48000;

export type SfxGenerateOptions = {
  /** Same seed + same preset + same starting params produce the same sound. */
  seed?: number;
};

let activeRandom: () => number = Math.random;

function rnd(): number {
  return activeRandom();
}

function withRandomSource<T>(seed: number | undefined, fn: () => T): T {
  if (seed === undefined) return fn();

  const previous = activeRandom;
  activeRandom = createSeededRandom(seed);
  try {
    return fn();
  } finally {
    activeRandom = previous;
  }
}

export type SfxRenderOptions = {
  sampleRate: SfxSampleRate;
  bitDepth: SfxBitDepth;
};

export type SfxRenderStats = {
  durationSeconds: number;
  samples: number;
  clippedSamples: number;
  peak: number;
  estimatedByteSize: number;
};

export type SfxRenderResult = {
  samples: Float32Array;
  stats: SfxRenderStats;
};

export const DEFAULT_SFX_PARAMS: SfxParams = {
  engine: 'sfxr',
  waveform: 'square',
  footstepTerrain: 'dirt',
  footstepHeel: 0.5,
  footstepRoll: 0.5,
  footstepBall: 0.5,
  footstepSwiftness: 0.5,
  attack: 0,
  sustain: 0.18,
  sustainPunch: 0.28,
  decay: 0.26,
  startFrequency: 0.42,
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
  lowPassCutoff: 1,
  lowPassSweep: 0,
  lowPassResonance: 0,
  highPassCutoff: 0,
  highPassSweep: 0,
  masterVolume: 0.56,
  fxDrive: 0,
  fxCrushRate: 0,
  fxCrushBits: 0,
  fxTone: 0,
  fxDelayTime: 0.25,
  fxDelayFeedback: 0.3,
  fxDelayMix: 0,
  fxReverbSize: 0.5,
  fxReverbMix: 0,
  fxNormalize: 1,
};

export const SFX_PRESET_ORDER: SfxPresetId[] = [
  'random',
  'mutate',
  'click',
  'blipSelect',
  'hoverTick',
  'notifyPop',
  'successChime',
  'errorBuzz',
  'pickupCoin',
  'laserShoot',
  'explosion',
  'powerup',
  'hitHurt',
  'jump',
  'whoosh',
  'riser',
  'impact',
  'glitch',
  'synth',
  'tone',
  'footstepSnow',
  'footstepGrass',
  'footstepDirt',
  'footstepGravel',
  'footstepMud',
  'footstepWood',
  'footstepMetal',
  'footstepWater',
];

const PHASER_BUFFER_SIZE = 2048;
const PD_COSTABLE_SIZE = 2048;
const PD_COSTABLE = createPdCosTable();
const MAX_FREQUENCY = 12000;
const MIN_DURATION_SECONDS = 0.18;

export function clampSfxParams(params: Partial<SfxParams>): SfxParams {
  const merged = {
    ...DEFAULT_SFX_PARAMS,
    ...params,
  };

  return {
    engine: merged.engine === 'footsteppr' ? 'footsteppr' : 'sfxr',
    waveform: isWaveform(merged.waveform) ? merged.waveform : DEFAULT_SFX_PARAMS.waveform,
    footstepTerrain: isFootstepTerrain(merged.footstepTerrain) ? merged.footstepTerrain : DEFAULT_SFX_PARAMS.footstepTerrain,
    footstepHeel: clamp(merged.footstepHeel, 0, 1),
    footstepRoll: clamp(merged.footstepRoll, 0, 1),
    footstepBall: clamp(merged.footstepBall, 0, 1),
    footstepSwiftness: clamp(merged.footstepSwiftness, 0, 1),
    attack: clamp(merged.attack, 0, 1),
    sustain: clamp(merged.sustain, 0, 1),
    sustainPunch: clamp(merged.sustainPunch, 0, 1),
    decay: clamp(merged.decay, 0, 1),
    startFrequency: clamp(merged.startFrequency, 0, 1),
    minFrequency: clamp(merged.minFrequency, 0, 1),
    slide: clamp(merged.slide, -1, 1),
    deltaSlide: clamp(merged.deltaSlide, -1, 1),
    vibratoDepth: clamp(merged.vibratoDepth, 0, 1),
    vibratoSpeed: clamp(merged.vibratoSpeed, 0, 1),
    changeAmount: clamp(merged.changeAmount, -1, 1),
    changeSpeed: clamp(merged.changeSpeed, 0, 1),
    squareDuty: clamp(merged.squareDuty, 0, 1),
    dutySweep: clamp(merged.dutySweep, -1, 1),
    repeatSpeed: clamp(merged.repeatSpeed, 0, 1),
    phaserOffset: clamp(merged.phaserOffset, -1, 1),
    phaserSweep: clamp(merged.phaserSweep, -1, 1),
    lowPassCutoff: clamp(merged.lowPassCutoff, 0, 1),
    lowPassSweep: clamp(merged.lowPassSweep, -1, 1),
    lowPassResonance: clamp(merged.lowPassResonance, 0, 1),
    highPassCutoff: clamp(merged.highPassCutoff, 0, 1),
    highPassSweep: clamp(merged.highPassSweep, -1, 1),
    masterVolume: clamp(merged.masterVolume, 0, 1),
    fxDrive: clamp(merged.fxDrive, 0, 1),
    fxCrushRate: clamp(merged.fxCrushRate, 0, 1),
    fxCrushBits: clamp(merged.fxCrushBits, 0, 1),
    fxTone: clamp(merged.fxTone, -1, 1),
    fxDelayTime: clamp(merged.fxDelayTime, 0, 1),
    fxDelayFeedback: clamp(merged.fxDelayFeedback, 0, 1),
    fxDelayMix: clamp(merged.fxDelayMix, 0, 1),
    fxReverbSize: clamp(merged.fxReverbSize, 0, 1),
    fxReverbMix: clamp(merged.fxReverbMix, 0, 1),
    fxNormalize: Number.isFinite(merged.fxNormalize)
      ? (merged.fxNormalize >= 0.5 ? 1 : 0)
      : DEFAULT_SFX_PARAMS.fxNormalize,
  };
}

export function serializeSfxParams(params: SfxParams): string {
  return JSON.stringify(params, null, 2);
}

export function deserializeSfxParams(serialized: string): SfxParams {
  const parsed = JSON.parse(serialized) as Partial<SfxParams>;
  return clampSfxParams(parsed);
}

export function mutateSfxParams(
  current: SfxParams,
  options: SfxGenerateOptions = {},
): SfxParams {
  return withRandomSource(options.seed, () => mutateSfxParamsWithActiveRandom(current));
}

function mutateSfxParamsWithActiveRandom(current: SfxParams): SfxParams {
  if (current.engine === 'footsteppr') {
    return clampSfxParams({
      ...current,
      footstepHeel: current.footstepHeel + randomRange(-0.12, 0.12),
      footstepRoll: current.footstepRoll + randomRange(-0.12, 0.12),
      footstepBall: current.footstepBall + randomRange(-0.12, 0.12),
      footstepSwiftness: current.footstepSwiftness + randomRange(-0.1, 0.1),
      masterVolume: current.masterVolume + randomRange(-0.05, 0.05),
      fxDrive: current.fxDrive + randomRange(-0.04, 0.04),
      fxTone: current.fxTone + randomRange(-0.08, 0.08),
      fxReverbSize: current.fxReverbSize + randomRange(-0.1, 0.1),
      fxReverbMix: current.fxReverbMix + randomRange(-0.06, 0.06),
    });
  }

  return clampSfxParams({
    ...current,
    attack: current.attack + randomRange(-0.08, 0.08),
    sustain: current.sustain + randomRange(-0.12, 0.12),
    sustainPunch: current.sustainPunch + randomRange(-0.15, 0.15),
    decay: current.decay + randomRange(-0.12, 0.12),
    startFrequency: current.startFrequency + randomRange(-0.18, 0.18),
    minFrequency: current.minFrequency + randomRange(-0.12, 0.12),
    slide: current.slide + randomRange(-0.24, 0.24),
    deltaSlide: current.deltaSlide + randomRange(-0.16, 0.16),
    vibratoDepth: current.vibratoDepth + randomRange(-0.2, 0.2),
    vibratoSpeed: current.vibratoSpeed + randomRange(-0.18, 0.18),
    changeAmount: current.changeAmount + randomRange(-0.24, 0.24),
    changeSpeed: current.changeSpeed + randomRange(-0.24, 0.24),
    squareDuty: current.squareDuty + randomRange(-0.18, 0.18),
    dutySweep: current.dutySweep + randomRange(-0.24, 0.24),
    repeatSpeed: current.repeatSpeed + randomRange(-0.2, 0.2),
    phaserOffset: current.phaserOffset + randomRange(-0.28, 0.28),
    phaserSweep: current.phaserSweep + randomRange(-0.18, 0.18),
    lowPassCutoff: current.lowPassCutoff + randomRange(-0.2, 0.2),
    lowPassSweep: current.lowPassSweep + randomRange(-0.18, 0.18),
    lowPassResonance: current.lowPassResonance + randomRange(-0.14, 0.14),
    highPassCutoff: current.highPassCutoff + randomRange(-0.14, 0.14),
    highPassSweep: current.highPassSweep + randomRange(-0.12, 0.12),
    masterVolume: current.masterVolume + randomRange(-0.08, 0.08),
    fxDrive: current.fxDrive + randomRange(-0.05, 0.05),
    fxCrushRate: current.fxCrushRate + randomRange(-0.05, 0.05),
    fxCrushBits: current.fxCrushBits + randomRange(-0.05, 0.05),
    fxTone: current.fxTone + randomRange(-0.12, 0.12),
    fxDelayTime: current.fxDelayTime + randomRange(-0.08, 0.08),
    fxDelayFeedback: current.fxDelayFeedback + randomRange(-0.08, 0.08),
    fxDelayMix: current.fxDelayMix + randomRange(-0.08, 0.08),
    fxReverbSize: current.fxReverbSize + randomRange(-0.1, 0.1),
    fxReverbMix: current.fxReverbMix + randomRange(-0.1, 0.1),
  });
}

function createSfxPresetCore(
  preset: SfxPresetId,
  current: SfxParams = DEFAULT_SFX_PARAMS,
): SfxParams {
  switch (preset) {
    case 'random':
      return clampSfxParams({
        waveform: randomWaveform(),
        attack: rnd() * 0.12,
        sustain: randomRange(0.05, 0.44),
        sustainPunch: rnd(),
        decay: randomRange(0.08, 0.52),
        startFrequency: randomRange(0.12, 0.95),
        minFrequency: rnd() * 0.3,
        slide: randomRange(-0.65, 0.42),
        deltaSlide: randomRange(-0.22, 0.22),
        vibratoDepth: rnd() * 0.7,
        vibratoSpeed: rnd() * 0.8,
        changeAmount: randomRange(-0.7, 0.7),
        changeSpeed: rnd() * 0.9,
        squareDuty: rnd(),
        dutySweep: randomRange(-0.4, 0.4),
        repeatSpeed: rnd() * 0.7,
        phaserOffset: randomRange(-0.8, 0.8),
        phaserSweep: randomRange(-0.3, 0.3),
        lowPassCutoff: randomRange(0.2, 1),
        lowPassSweep: randomRange(-0.25, 0.18),
        lowPassResonance: rnd() * 0.7,
        highPassCutoff: rnd() * 0.25,
        highPassSweep: randomRange(-0.12, 0.1),
        masterVolume: randomRange(0.38, 0.72),
      });
    case 'pickupCoin':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'square' : 'sine',
        sustain: randomRange(0.04, 0.12),
        sustainPunch: randomRange(0.35, 0.8),
        decay: randomRange(0.08, 0.16),
        startFrequency: randomRange(0.66, 0.92),
        changeAmount: randomRange(0.18, 0.42),
        changeSpeed: randomRange(0.18, 0.38),
        squareDuty: randomRange(0.25, 0.58),
        lowPassCutoff: 0.96,
        highPassCutoff: randomRange(0.02, 0.08),
        masterVolume: 0.54,
      });
    case 'laserShoot':
      return clampSfxParams({
        waveform: 'noise',
        sustain: randomRange(0.08, 0.22),
        sustainPunch: randomRange(0.12, 0.34),
        decay: randomRange(0.14, 0.34),
        startFrequency: randomRange(0.48, 0.92),
        minFrequency: randomRange(0.02, 0.16),
        slide: randomRange(-0.72, -0.24),
        deltaSlide: randomRange(-0.08, 0.12),
        vibratoDepth: randomRange(0, 0.24),
        vibratoSpeed: randomRange(0.2, 0.62),
        squareDuty: randomRange(0.05, 0.4),
        dutySweep: randomRange(-0.34, 0.18),
        phaserOffset: randomRange(-0.45, 0.45),
        phaserSweep: randomRange(-0.08, 0.08),
        highPassCutoff: randomRange(0.05, 0.16),
        masterVolume: 0.56,
      });
    case 'explosion':
      return clampSfxParams({
        waveform: 'noise',
        sustain: randomRange(0.18, 0.44),
        sustainPunch: randomRange(0.12, 0.44),
        decay: randomRange(0.24, 0.62),
        startFrequency: randomRange(0.06, 0.22),
        minFrequency: 0,
        slide: randomRange(-0.38, -0.08),
        repeatSpeed: randomRange(0.02, 0.16),
        phaserOffset: randomRange(-0.4, 0.4),
        phaserSweep: randomRange(-0.06, 0.06),
        lowPassCutoff: randomRange(0.2, 0.52),
        lowPassSweep: randomRange(-0.12, -0.02),
        lowPassResonance: randomRange(0.2, 0.55),
        highPassCutoff: randomRange(0.02, 0.12),
        masterVolume: 0.66,
      });
    case 'powerup':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'square' : 'sawtooth',
        sustain: randomRange(0.14, 0.28),
        sustainPunch: randomRange(0.18, 0.45),
        decay: randomRange(0.16, 0.3),
        startFrequency: randomRange(0.24, 0.44),
        slide: randomRange(0.18, 0.42),
        changeAmount: randomRange(0.08, 0.32),
        changeSpeed: randomRange(0.18, 0.42),
        squareDuty: randomRange(0.2, 0.6),
        dutySweep: randomRange(0.04, 0.2),
        lowPassCutoff: 0.9,
        masterVolume: 0.56,
      });
    case 'hitHurt':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'noise' : 'square',
        sustain: randomRange(0.02, 0.12),
        sustainPunch: randomRange(0.2, 0.55),
        decay: randomRange(0.08, 0.2),
        startFrequency: randomRange(0.26, 0.68),
        slide: randomRange(-0.44, -0.08),
        highPassCutoff: randomRange(0.06, 0.18),
        lowPassCutoff: randomRange(0.45, 0.9),
        masterVolume: 0.56,
      });
    case 'jump':
      return clampSfxParams({
        waveform: rnd() > 0.35 ? 'square' : 'sine',
        sustain: randomRange(0.08, 0.16),
        sustainPunch: randomRange(0.12, 0.28),
        decay: randomRange(0.12, 0.24),
        startFrequency: randomRange(0.38, 0.62),
        slide: randomRange(0.08, 0.28),
        squareDuty: randomRange(0.2, 0.5),
        highPassCutoff: randomRange(0.02, 0.1),
        masterVolume: 0.54,
      });
    case 'footstepSnow':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: 'noise',
        footstepTerrain: 'snow',
        footstepHeel: randomRange(0.28, 0.42),
        footstepRoll: randomRange(0.72, 0.9),
        footstepBall: randomRange(0.36, 0.56),
        footstepSwiftness: randomRange(0.34, 0.5),
        attack: randomRange(0.01, 0.05),
        sustain: randomRange(0.06, 0.14),
        sustainPunch: randomRange(0.14, 0.3),
        decay: randomRange(0.08, 0.16),
        startFrequency: randomRange(0.12, 0.24),
        minFrequency: randomRange(0.02, 0.08),
        slide: randomRange(-0.18, 0),
        squareDuty: randomRange(0.2, 0.45),
        repeatSpeed: randomRange(0.02, 0.08),
        lowPassCutoff: randomRange(0.26, 0.46),
        lowPassSweep: randomRange(-0.06, 0.04),
        lowPassResonance: randomRange(0.08, 0.22),
        highPassCutoff: randomRange(0.08, 0.16),
        highPassSweep: randomRange(-0.02, 0.04),
        masterVolume: 0.48,
      });
    case 'footstepGrass':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: 'noise',
        footstepTerrain: 'grass',
        footstepHeel: randomRange(0.28, 0.4),
        footstepRoll: randomRange(0.56, 0.74),
        footstepBall: randomRange(0.44, 0.66),
        footstepSwiftness: randomRange(0.42, 0.58),
        attack: randomRange(0.01, 0.03),
        sustain: randomRange(0.05, 0.12),
        sustainPunch: randomRange(0.1, 0.24),
        decay: randomRange(0.08, 0.14),
        startFrequency: randomRange(0.18, 0.32),
        minFrequency: randomRange(0.04, 0.12),
        slide: randomRange(-0.12, 0.04),
        repeatSpeed: randomRange(0.03, 0.1),
        lowPassCutoff: randomRange(0.42, 0.64),
        lowPassSweep: randomRange(-0.04, 0.05),
        lowPassResonance: randomRange(0.06, 0.18),
        highPassCutoff: randomRange(0.1, 0.18),
        highPassSweep: randomRange(-0.02, 0.04),
        masterVolume: 0.46,
      });
    case 'footstepDirt':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: rnd() > 0.75 ? 'square' : 'noise',
        footstepTerrain: 'dirt',
        footstepHeel: randomRange(0.48, 0.68),
        footstepRoll: randomRange(0.48, 0.68),
        footstepBall: randomRange(0.32, 0.5),
        footstepSwiftness: randomRange(0.44, 0.62),
        attack: randomRange(0, 0.02),
        sustain: randomRange(0.05, 0.11),
        sustainPunch: randomRange(0.16, 0.32),
        decay: randomRange(0.09, 0.16),
        startFrequency: randomRange(0.1, 0.22),
        minFrequency: randomRange(0.02, 0.08),
        slide: randomRange(-0.2, -0.04),
        squareDuty: randomRange(0.1, 0.28),
        lowPassCutoff: randomRange(0.24, 0.44),
        lowPassSweep: randomRange(-0.08, 0.02),
        lowPassResonance: randomRange(0.1, 0.24),
        highPassCutoff: randomRange(0.04, 0.12),
        highPassSweep: randomRange(-0.03, 0.02),
        masterVolume: 0.5,
      });
    case 'footstepGravel':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: 'noise',
        footstepTerrain: 'gravel',
        footstepHeel: randomRange(0.56, 0.76),
        footstepRoll: randomRange(0.34, 0.56),
        footstepBall: randomRange(0.4, 0.6),
        footstepSwiftness: randomRange(0.5, 0.7),
        attack: randomRange(0, 0.02),
        sustain: randomRange(0.06, 0.16),
        sustainPunch: randomRange(0.22, 0.42),
        decay: randomRange(0.1, 0.18),
        startFrequency: randomRange(0.26, 0.42),
        minFrequency: randomRange(0.08, 0.16),
        slide: randomRange(-0.08, 0.08),
        deltaSlide: randomRange(-0.03, 0.03),
        repeatSpeed: randomRange(0.04, 0.14),
        phaserOffset: randomRange(-0.08, 0.08),
        phaserSweep: randomRange(-0.02, 0.02),
        lowPassCutoff: randomRange(0.52, 0.78),
        lowPassResonance: randomRange(0.04, 0.16),
        highPassCutoff: randomRange(0.16, 0.28),
        highPassSweep: randomRange(0, 0.05),
        masterVolume: 0.5,
      });
    case 'footstepMud':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: 'noise',
        footstepTerrain: 'mud',
        footstepHeel: randomRange(0.4, 0.58),
        footstepRoll: randomRange(0.58, 0.76),
        footstepBall: randomRange(0.3, 0.48),
        footstepSwiftness: randomRange(0.24, 0.38),
        attack: randomRange(0.01, 0.04),
        sustain: randomRange(0.14, 0.24),
        sustainPunch: randomRange(0.18, 0.36),
        decay: randomRange(0.18, 0.3),
        startFrequency: randomRange(0.08, 0.16),
        minFrequency: randomRange(0.01, 0.05),
        slide: randomRange(-0.24, -0.06),
        lowPassCutoff: randomRange(0.16, 0.3),
        lowPassSweep: randomRange(-0.1, 0.02),
        lowPassResonance: randomRange(0.2, 0.38),
        highPassCutoff: randomRange(0.01, 0.06),
        masterVolume: 0.5,
      });
    case 'footstepWood':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: rnd() > 0.8 ? 'square' : 'noise',
        footstepTerrain: 'wood',
        footstepHeel: randomRange(0.6, 0.8),
        footstepRoll: randomRange(0.3, 0.5),
        footstepBall: randomRange(0.42, 0.6),
        footstepSwiftness: randomRange(0.56, 0.74),
        attack: 0,
        sustain: randomRange(0.03, 0.09),
        sustainPunch: randomRange(0.3, 0.5),
        decay: randomRange(0.06, 0.12),
        startFrequency: randomRange(0.3, 0.46),
        minFrequency: randomRange(0.12, 0.24),
        slide: randomRange(-0.14, 0),
        lowPassCutoff: randomRange(0.6, 0.82),
        lowPassResonance: randomRange(0.12, 0.28),
        highPassCutoff: randomRange(0.1, 0.2),
        masterVolume: 0.48,
      });
    case 'footstepMetal':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: 'noise',
        footstepTerrain: 'metal',
        footstepHeel: randomRange(0.52, 0.7),
        footstepRoll: randomRange(0.4, 0.58),
        footstepBall: randomRange(0.5, 0.68),
        footstepSwiftness: randomRange(0.52, 0.68),
        attack: 0,
        sustain: randomRange(0.06, 0.12),
        sustainPunch: randomRange(0.26, 0.46),
        decay: randomRange(0.1, 0.16),
        startFrequency: randomRange(0.56, 0.74),
        minFrequency: randomRange(0.2, 0.34),
        slide: randomRange(-0.08, 0.06),
        phaserOffset: randomRange(-0.14, 0.14),
        lowPassCutoff: randomRange(0.78, 0.96),
        lowPassResonance: randomRange(0.3, 0.5),
        highPassCutoff: randomRange(0.24, 0.38),
        masterVolume: 0.52,
      });
    case 'footstepWater':
      return clampSfxParams({
        engine: 'footsteppr',
        waveform: 'noise',
        footstepTerrain: 'water',
        footstepHeel: randomRange(0.44, 0.62),
        footstepRoll: randomRange(0.5, 0.68),
        footstepBall: randomRange(0.46, 0.64),
        footstepSwiftness: randomRange(0.4, 0.56),
        attack: 0,
        sustain: randomRange(0.1, 0.2),
        sustainPunch: randomRange(0.2, 0.4),
        decay: randomRange(0.14, 0.24),
        startFrequency: randomRange(0.34, 0.5),
        minFrequency: randomRange(0.08, 0.18),
        slide: randomRange(-0.1, 0.06),
        lowPassCutoff: randomRange(0.5, 0.72),
        lowPassSweep: randomRange(-0.06, 0.04),
        lowPassResonance: randomRange(0.18, 0.34),
        highPassCutoff: randomRange(0.14, 0.26),
        masterVolume: 0.5,
      });
    case 'click':
      return clampSfxParams({
        waveform: 'sine',
        sustain: randomRange(0.01, 0.04),
        sustainPunch: randomRange(0.18, 0.48),
        decay: randomRange(0.01, 0.06),
        startFrequency: randomRange(0.42, 0.78),
        squareDuty: randomRange(0.1, 0.34),
        highPassCutoff: randomRange(0.08, 0.22),
        masterVolume: 0.44,
      });
    case 'blipSelect':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'square' : 'sine',
        sustain: randomRange(0.02, 0.08),
        sustainPunch: randomRange(0.08, 0.3),
        decay: randomRange(0.04, 0.12),
        startFrequency: randomRange(0.44, 0.82),
        squareDuty: randomRange(0.25, 0.6),
        highPassCutoff: randomRange(0.02, 0.1),
        masterVolume: 0.5,
      });
    case 'hoverTick':
      return clampSfxParams({
        waveform: 'sine',
        sustain: randomRange(0.005, 0.02),
        sustainPunch: randomRange(0.06, 0.18),
        decay: randomRange(0.015, 0.04),
        startFrequency: randomRange(0.72, 0.9),
        squareDuty: randomRange(0.2, 0.4),
        highPassCutoff: randomRange(0.3, 0.46),
        masterVolume: 0.3,
      });
    case 'notifyPop':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'sine' : 'square',
        sustain: randomRange(0.06, 0.14),
        sustainPunch: randomRange(0.1, 0.26),
        decay: randomRange(0.08, 0.16),
        startFrequency: randomRange(0.5, 0.7),
        slide: randomRange(0.16, 0.3),
        changeAmount: randomRange(0.14, 0.3),
        changeSpeed: randomRange(0.2, 0.4),
        squareDuty: randomRange(0.25, 0.5),
        lowPassCutoff: randomRange(0.8, 0.98),
        masterVolume: 0.44,
      });
    case 'successChime':
      return clampSfxParams({
        waveform: rnd() > 0.4 ? 'sine' : 'square',
        attack: randomRange(0.005, 0.02),
        sustain: randomRange(0.16, 0.3),
        sustainPunch: randomRange(0.04, 0.16),
        decay: randomRange(0.2, 0.36),
        startFrequency: randomRange(0.46, 0.6),
        slide: randomRange(0.12, 0.26),
        changeAmount: randomRange(0.16, 0.34),
        changeSpeed: randomRange(0.24, 0.44),
        squareDuty: randomRange(0.3, 0.55),
        lowPassCutoff: randomRange(0.86, 1),
        lowPassResonance: randomRange(0.04, 0.16),
        masterVolume: 0.5,
      });
    case 'errorBuzz':
      return clampSfxParams({
        waveform: 'square',
        sustain: randomRange(0.18, 0.32),
        sustainPunch: randomRange(0.1, 0.24),
        decay: randomRange(0.14, 0.26),
        startFrequency: randomRange(0.16, 0.28),
        minFrequency: randomRange(0.04, 0.1),
        vibratoDepth: randomRange(0.45, 0.75),
        vibratoSpeed: randomRange(0.55, 0.85),
        squareDuty: randomRange(0.3, 0.5),
        lowPassCutoff: randomRange(0.42, 0.62),
        lowPassResonance: randomRange(0.1, 0.26),
        masterVolume: 0.5,
      });
    case 'synth':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'sawtooth' : 'sine',
        attack: randomRange(0.02, 0.1),
        sustain: randomRange(0.22, 0.54),
        sustainPunch: randomRange(0, 0.2),
        decay: randomRange(0.22, 0.54),
        startFrequency: randomRange(0.16, 0.68),
        slide: randomRange(-0.08, 0.12),
        vibratoDepth: randomRange(0.06, 0.36),
        vibratoSpeed: randomRange(0.18, 0.62),
        changeAmount: randomRange(-0.12, 0.12),
        squareDuty: randomRange(0.22, 0.7),
        lowPassCutoff: randomRange(0.5, 0.92),
        lowPassResonance: randomRange(0.06, 0.38),
        highPassCutoff: randomRange(0.01, 0.08),
        masterVolume: 0.58,
      });
    case 'tone':
      return clampSfxParams({
        waveform: 'sine',
        attack: randomRange(0.01, 0.08),
        sustain: randomRange(0.38, 0.62),
        sustainPunch: 0,
        decay: randomRange(0.18, 0.42),
        startFrequency: randomRange(0.18, 0.82),
        lowPassCutoff: 1,
        highPassCutoff: 0,
        masterVolume: 0.52,
      });
    case 'whoosh':
      return clampSfxParams({
        waveform: 'noise',
        attack: randomRange(0.18, 0.3),
        sustain: randomRange(0.2, 0.34),
        sustainPunch: randomRange(0.02, 0.12),
        decay: randomRange(0.42, 0.62),
        startFrequency: randomRange(0.3, 0.46),
        minFrequency: randomRange(0.02, 0.1),
        slide: randomRange(-0.5, -0.28),
        vibratoDepth: randomRange(0.06, 0.18),
        vibratoSpeed: randomRange(0.2, 0.4),
        lowPassCutoff: randomRange(0.34, 0.56),
        lowPassSweep: randomRange(-0.34, -0.16),
        lowPassResonance: randomRange(0.28, 0.5),
        highPassCutoff: randomRange(0.02, 0.08),
        masterVolume: 0.48,
      });
    case 'riser':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'sawtooth' : 'square',
        attack: randomRange(0.14, 0.26),
        sustain: randomRange(0.48, 0.68),
        sustainPunch: randomRange(0.02, 0.1),
        decay: randomRange(0.3, 0.46),
        startFrequency: randomRange(0.14, 0.26),
        slide: randomRange(0.52, 0.82),
        deltaSlide: randomRange(0.04, 0.14),
        changeAmount: randomRange(0.16, 0.34),
        changeSpeed: randomRange(0.24, 0.42),
        squareDuty: randomRange(0.3, 0.6),
        lowPassCutoff: randomRange(0.74, 0.94),
        lowPassResonance: randomRange(0.06, 0.2),
        masterVolume: 0.46,
      });
    case 'impact':
      return clampSfxParams({
        waveform: rnd() > 0.5 ? 'sawtooth' : 'sine',
        sustain: randomRange(0.08, 0.16),
        sustainPunch: randomRange(0.5, 0.8),
        decay: randomRange(0.34, 0.52),
        startFrequency: randomRange(0.12, 0.2),
        minFrequency: 0,
        slide: randomRange(-0.6, -0.34),
        deltaSlide: randomRange(-0.06, 0),
        lowPassCutoff: randomRange(0.3, 0.5),
        lowPassSweep: randomRange(-0.2, -0.06),
        lowPassResonance: randomRange(0.26, 0.46),
        highPassCutoff: randomRange(0.02, 0.08),
        masterVolume: 0.72,
      });
    case 'glitch':
      return clampSfxParams({
        waveform: rnd() > 0.3 ? 'square' : 'sawtooth',
        sustain: randomRange(0.1, 0.2),
        sustainPunch: randomRange(0.2, 0.44),
        decay: randomRange(0.12, 0.22),
        startFrequency: randomRange(0.38, 0.62),
        changeAmount: randomRange(0.5, 0.86) * (rnd() > 0.5 ? 1 : -1),
        changeSpeed: randomRange(0.55, 0.9),
        squareDuty: randomRange(0.08, 0.3),
        dutySweep: randomRange(0.3, 0.56) * (rnd() > 0.5 ? 1 : -1),
        repeatSpeed: randomRange(0.28, 0.5),
        phaserOffset: randomRange(0.3, 0.7) * (rnd() > 0.5 ? 1 : -1),
        phaserSweep: randomRange(0.2, 0.5) * (rnd() > 0.5 ? 1 : -1),
        lowPassCutoff: randomRange(0.6, 0.9),
        highPassCutoff: randomRange(0.06, 0.18),
        masterVolume: 0.44,
      });
    case 'mutate':
      return mutateSfxParams(current);
    default:
      return clampSfxParams(current);
  }
}

const PRESET_FX: Partial<Record<SfxPresetId, Partial<SfxParams>>> = {
  pickupCoin: { fxDelayMix: 0.1, fxDelayFeedback: 0.3 },
  laserShoot: { fxDelayMix: 0.16, fxDelayFeedback: 0.34, fxTone: 0.1 },
  explosion: { fxDrive: 0.42, fxTone: -0.14, fxReverbMix: 0.4, fxReverbSize: 0.78 },
  powerup: { fxDelayMix: 0.14, fxDelayFeedback: 0.32 },
  hitHurt: { fxDrive: 0.18 },
  successChime: { fxReverbMix: 0.2, fxReverbSize: 0.5 },
  errorBuzz: { fxDrive: 0.14, fxCrushBits: 0.2 },
  whoosh: { fxDelayMix: 0.26, fxDelayFeedback: 0.44, fxReverbMix: 0.3, fxReverbSize: 0.7, fxTone: 0.1 },
  riser: { fxDelayMix: 0.28, fxDelayFeedback: 0.48, fxReverbMix: 0.3, fxReverbSize: 0.78 },
  impact: { fxDrive: 0.52, fxReverbMix: 0.42, fxReverbSize: 0.82 },
  glitch: { fxCrushRate: 0.42, fxCrushBits: 0.6, fxDelayMix: 0.18, fxDelayFeedback: 0.4 },
  footstepMud: { fxTone: -0.16, fxReverbMix: 0.12, fxReverbSize: 0.45 },
  footstepWood: { fxTone: 0.12, fxReverbMix: 0.1, fxReverbSize: 0.4 },
  footstepMetal: { fxTone: 0.16, fxReverbMix: 0.26, fxReverbSize: 0.55 },
  footstepWater: { fxReverbMix: 0.3, fxReverbSize: 0.62 },
  synth: { fxReverbMix: 0.18, fxReverbSize: 0.55 },
  tone: { fxReverbMix: 0.16, fxReverbSize: 0.5 },
};

function randomFxOverlay(): Partial<SfxParams> {
  return {
    fxDrive: randomRange(0, 0.22),
    fxCrushRate: rnd() > 0.7 ? randomRange(0.1, 0.4) : 0,
    fxCrushBits: rnd() > 0.75 ? randomRange(0.1, 0.5) : 0,
    fxTone: randomRange(-0.3, 0.3),
    fxDelayMix: rnd() > 0.5 ? randomRange(0.05, 0.22) : 0,
    fxDelayFeedback: randomRange(0.2, 0.45),
    fxReverbMix: rnd() > 0.4 ? randomRange(0.08, 0.26) : 0,
    fxReverbSize: randomRange(0.35, 0.8),
  };
}

export function createSfxPreset(
  preset: SfxPresetId,
  current: SfxParams = DEFAULT_SFX_PARAMS,
  options: SfxGenerateOptions = {},
): SfxParams {
  return withRandomSource(options.seed, () => {
    const base = createSfxPresetCore(preset, current);
    const overlay = preset === 'random' ? randomFxOverlay() : PRESET_FX[preset];

    return overlay ? clampSfxParams({ ...base, ...overlay }) : base;
  });
}

/**
 * Re-rolls an existing sound as a new take. Uses the preset recipe when the
 * take still knows its preset, otherwise it nudges the current parameters.
 */
export function createSfxVariant(
  params: SfxParams,
  presetId: SfxPresetId | null,
  seed: number,
): SfxParams {
  const recipe = presetId && presetId !== 'mutate' ? presetId : null;
  return recipe
    ? createSfxPreset(recipe, params, { seed })
    : mutateSfxParams(params, { seed });
}

export function renderSfx(
  params: SfxParams,
  options: SfxRenderOptions,
): SfxRenderResult {
  const safeParams = clampSfxParams(params);
  const baseSamples = safeParams.engine === 'footsteppr'
    ? renderFootstepprSamples(safeParams, options)
    : renderSfxrSamples(safeParams, options);

  return finalizeSfx(baseSamples, safeParams, options);
}

function finalizeSfx(
  baseSamples: Float32Array,
  params: SfxParams,
  options: SfxRenderOptions,
): SfxRenderResult {
  const tailSamples = Math.max(0, Math.round(fxTailSeconds(params) * options.sampleRate));
  const maxSamples = Math.round(FX_MAX_RENDER_SECONDS * options.sampleRate);
  const totalSamples = Math.min(maxSamples, baseSamples.length + tailSamples);
  const samples = new Float32Array(totalSamples);
  samples.set(baseSamples.subarray(0, Math.min(baseSamples.length, totalSamples)));

  applyFxChain(samples, params, options.sampleRate);

  let clippedSamples = 0;
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    if (Math.abs(sample) > 1) {
      clippedSamples += 1;
    }

    const clampedSample = clamp(sample, -1, 1);
    peak = Math.max(peak, Math.abs(clampedSample));
    samples[index] = clampedSample;
  }

  return {
    samples,
    stats: {
      durationSeconds: totalSamples / options.sampleRate,
      samples: totalSamples,
      clippedSamples,
      peak,
      estimatedByteSize: 44 + totalSamples * (options.bitDepth / 8),
    },
  };
}

function renderSfxrSamples(
  safeParams: SfxParams,
  options: SfxRenderOptions,
): Float32Array {
  const attackSeconds = safeParams.attack * 0.4;
  const sustainSeconds = 0.02 + safeParams.sustain * 1.2;
  const decaySeconds = safeParams.decay * 1.8;
  const durationSeconds = Math.max(
    MIN_DURATION_SECONDS,
    attackSeconds + sustainSeconds + decaySeconds,
  );

  const attackSamples = Math.max(0, Math.floor(attackSeconds * options.sampleRate));
  const sustainSamples = Math.max(1, Math.floor(sustainSeconds * options.sampleRate));
  const decaySamples = Math.max(1, Math.floor(decaySeconds * options.sampleRate));
  const totalSamples = Math.max(
    Math.floor(durationSeconds * options.sampleRate),
    attackSamples + sustainSamples + decaySamples,
  );

  const samples = new Float32Array(totalSamples);
  const startFrequency = normalizedFrequency(safeParams.startFrequency);
  const minFrequency = Math.min(startFrequency, normalizedFrequency(safeParams.minFrequency));
  const initialSlide = signedCurve(safeParams.slide) * 0.00008;
  const slideDelta = signedCurve(safeParams.deltaSlide) * 0.00000008;
  const initialDuty = clamp(0.05 + safeParams.squareDuty * 0.9, 0.05, 0.95);
  const dutyDelta = safeParams.dutySweep * 0.00004;
  const vibratoRate = 0.5 + safeParams.vibratoSpeed * 18;
  const vibratoDepth = safeParams.vibratoDepth * 0.35;
  const repeatLimit = safeParams.repeatSpeed > 0.01
    ? Math.max(128, Math.floor(options.sampleRate * (0.12 + (1 - safeParams.repeatSpeed) * 1.48)))
    : 0;
  const changeLimit = safeParams.changeSpeed > 0.01
    ? Math.max(128, Math.floor(options.sampleRate * (0.05 + (1 - safeParams.changeSpeed) * 1.3)))
    : 0;
  const changeMultiplier = safeParams.changeAmount >= 0
    ? 1 + safeParams.changeAmount * 1.5
    : 1 / (1 + Math.abs(safeParams.changeAmount) * 1.5);

  const phaserBuffer = new Float32Array(PHASER_BUFFER_SIZE);
  let phaserOffset = safeParams.phaserOffset * 1024;
  const phaserSweep = safeParams.phaserSweep * 0.3;
  let phaserIndex = 0;

  let lowPassCutoff = clamp(0.02 + safeParams.lowPassCutoff ** 2 * 0.48, 0.02, 1);
  const lowPassSweep = safeParams.lowPassSweep * 0.00002;
  const lowPassDamping = clamp(1 - safeParams.lowPassResonance * 0.4, 0.45, 0.995);
  let lowPassState = 0;
  let lowPassDelta = 0;

  let highPassAlpha = clamp(0.999 - safeParams.highPassCutoff ** 2 * 0.94, 0.02, 0.999);
  const highPassSweep = safeParams.highPassSweep * 0.00002;
  let highPassPrevInput = 0;
  let highPassPrevOutput = 0;

  let frequency = startFrequency;
  let slide = initialSlide;
  let duty = initialDuty;
  let phase = 0;
  let repeatCounter = 0;
  let changeCounter = 0;
  let changeTriggered = false;
  let vibratoPhase = 0;
  let noiseValue = randomSigned();

  const resetCycle = (): void => {
    frequency = startFrequency;
    slide = initialSlide;
    duty = initialDuty;
    phase = 0;
    repeatCounter = 0;
    changeCounter = 0;
    changeTriggered = false;
    noiseValue = randomSigned();
  };

  for (let index = 0; index < totalSamples; index += 1) {
    if (repeatLimit > 0 && repeatCounter >= repeatLimit) {
      resetCycle();
    }

    repeatCounter += 1;
    changeCounter += 1;

    if (!changeTriggered && changeLimit > 0 && changeCounter >= changeLimit) {
      frequency = clamp(frequency * changeMultiplier, minFrequency, MAX_FREQUENCY);
      changeTriggered = true;
    }

    slide += slideDelta;
    frequency = clamp(frequency * (1 + slide), minFrequency, MAX_FREQUENCY);
    duty = clamp(duty + dutyDelta, 0.02, 0.98);
    vibratoPhase += (Math.PI * 2 * vibratoRate) / options.sampleRate;

    const effectiveFrequency = clamp(
      frequency * (1 + Math.sin(vibratoPhase) * vibratoDepth),
      minFrequency,
      MAX_FREQUENCY,
    );

    phase += effectiveFrequency / options.sampleRate;
    while (phase >= 1) {
      phase -= 1;
      if (safeParams.waveform === 'noise') {
        noiseValue = randomSigned();
      }
    }

    let sample = getWaveformSample(safeParams.waveform, phase, duty, noiseValue);

    lowPassCutoff = clamp(lowPassCutoff + lowPassSweep, 0.001, 1);
    lowPassDelta += (sample - lowPassState) * lowPassCutoff;
    lowPassDelta *= lowPassDamping;
    lowPassState += lowPassDelta;
    sample = lowPassState;

    highPassAlpha = clamp(highPassAlpha + highPassSweep, 0.02, 0.999);
    const highPassed = highPassAlpha * (highPassPrevOutput + sample - highPassPrevInput);
    highPassPrevInput = sample;
    highPassPrevOutput = highPassed;
    sample = highPassed;

    phaserOffset = clamp(
      phaserOffset + phaserSweep,
      -(PHASER_BUFFER_SIZE - 1),
      PHASER_BUFFER_SIZE - 1,
    );
    const phaserDelay = Math.abs(Math.round(phaserOffset));
    const delayedIndex = (phaserIndex - phaserDelay + PHASER_BUFFER_SIZE) % PHASER_BUFFER_SIZE;
    sample += phaserBuffer[delayedIndex] * 0.65 * Math.sign(phaserOffset || 1);
    phaserBuffer[phaserIndex] = sample;
    phaserIndex = (phaserIndex + 1) % PHASER_BUFFER_SIZE;

    sample *= getEnvelopeLevel(
      index,
      attackSamples,
      sustainSamples,
      decaySamples,
      safeParams.sustainPunch,
    );
    sample *= safeParams.masterVolume;

    samples[index] = sample;
  }

  return samples;
}

function renderFootstepprSamples(
  params: SfxParams,
  options: SfxRenderOptions,
): Float32Array {
  const durationSeconds = 0.1 + 0.7 * (1 - params.footstepSwiftness);
  const internalSampleRate = 44100;
  const totalSamples = Math.max(1, Math.floor(durationSeconds * internalSampleRate));
  const envelopeSignal = createFootstepEnvelopeSignal(totalSamples, internalSampleRate, params);
  const rawSignal = renderFootstepTerrain(
    params.footstepTerrain,
    envelopeSignal,
    internalSampleRate,
  );
  const scaledSignal = pdMulScalar(rawSignal, params.masterVolume);
  const boostedSignal = pdMulScalar(scaledSignal, 4);

  return options.sampleRate === internalSampleRate
    ? boostedSignal
    : resampleSignal(boostedSignal, internalSampleRate, options.sampleRate);
}

/** Encodes a mono PCM wav. Kept separate from the Blob wrapper so game export
 *  packages can write zip entries without a Blob round-trip. */
export function encodeSfxWavBytes(
  samples: Float32Array,
  sampleRate: SfxSampleRate,
  bitDepth: SfxBitDepth,
): Uint8Array<ArrayBuffer> {
  const channelCount = 1;
  const bytesPerSample = bitDepth / 8;
  const byteRate = sampleRate * channelCount * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = clamp(samples[index] ?? 0, -1, 1);
    if (bitDepth === 16) {
      const value = sample < 0
        ? Math.round(sample * 0x8000)
        : Math.round(sample * 0x7fff);
      view.setInt16(offset, value, true);
      offset += 2;
    } else {
      const value = Math.round((sample * 0.5 + 0.5) * 255);
      view.setUint8(offset, clamp(value, 0, 255));
      offset += 1;
    }
  }

  return new Uint8Array(buffer);
}

export function encodeSfxWav(
  samples: Float32Array,
  sampleRate: SfxSampleRate,
  bitDepth: SfxBitDepth,
): Blob {
  return new Blob([encodeSfxWavBytes(samples, sampleRate, bitDepth)], { type: 'audio/wav' });
}

function getWaveformSample(
  waveform: SfxWaveform,
  phase: number,
  duty: number,
  noiseValue: number,
): number {
  switch (waveform) {
    case 'square':
      return phase < duty ? 1 : -1;
    case 'sawtooth':
      return 1 - phase * 2;
    case 'sine':
      return Math.sin(phase * Math.PI * 2);
    case 'noise':
      return noiseValue;
    default:
      return 0;
  }
}

function getEnvelopeLevel(
  index: number,
  attackSamples: number,
  sustainSamples: number,
  decaySamples: number,
  sustainPunch: number,
): number {
  if (attackSamples > 0 && index < attackSamples) {
    return index / attackSamples;
  }

  const sustainStart = attackSamples;
  const sustainEnd = sustainStart + sustainSamples;
  if (index < sustainEnd) {
    const sustainProgress = sustainSamples <= 1
      ? 1
      : (index - sustainStart) / sustainSamples;
    return 1 + (1 - sustainProgress) * sustainPunch * 0.8;
  }

  const decayStart = sustainEnd;
  const decayEnd = decayStart + decaySamples;
  if (index < decayEnd) {
    const decayProgress = decaySamples <= 1
      ? 1
      : (index - decayStart) / decaySamples;
    return Math.max(0, 1 - decayProgress);
  }

  return 0;
}

function createFootstepEnvelopeSignal(
  totalSamples: number,
  sampleRate: number,
  params: SfxParams,
): Float32Array {
  const stepLength = totalSamples / sampleRate;
  const heelEnvelope = resizeFn(stepFn(params.footstepHeel), 0, 1, 0, 0.3333);
  const rollEnvelope = resizeFn(stepFn(params.footstepRoll), 0, 1, 0.125, 0.875);
  const ballEnvelope = resizeFn(stepFn(params.footstepBall), 0, 1, 0.6667, 1);
  const baseEnvelope = (time: number): number => (
    heelEnvelope(time) + rollEnvelope(time) + ballEnvelope(time)
  );
  const resizedEnvelope = resizeFn(baseEnvelope, 0, 1, 0, stepLength);
  const envelope = new Float32Array(totalSamples);

  for (let index = 0; index < totalSamples; index += 1) {
    envelope[index] = resizedEnvelope(index / sampleRate);
  }

  return envelope;
}

function renderFootstepTerrain(
  terrain: SfxFootstepTerrain,
  envelope: Float32Array,
  sampleRate: number,
): Float32Array {
  switch (terrain) {
    case 'snow':
      return renderSnowTerrain(envelope, sampleRate);
    case 'grass':
      return renderGrassTerrain(envelope, sampleRate);
    case 'dirt':
      return renderDirtTerrain(envelope, sampleRate);
    case 'gravel':
      return renderGravelTerrain(envelope, sampleRate);
    case 'mud':
      return renderMudTerrain(envelope, sampleRate);
    case 'wood':
      return renderWoodTerrain(envelope, sampleRate);
    case 'metal':
      return renderMetalTerrain(envelope, sampleRate);
    case 'water':
      return renderWaterTerrain(envelope, sampleRate);
    default:
      return new Float32Array(envelope.length);
  }
}

function renderSnowTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const crunchNoise = pdNoise(envelope.length);
  const crunchLow = pdLop(crunchNoise, pdConstant(envelope.length, 110), sampleRate);
  const crunchHigh = pdLop(crunchNoise, pdConstant(envelope.length, 900), sampleRate);
  const crunchRatio = pdDiv(crunchLow, crunchHigh);

  const powderNoise = pdNoise(envelope.length);
  const powderBed = pdLop(powderNoise, pdConstant(envelope.length, 50), sampleRate);
  const powderTop = pdLop(powderNoise, pdConstant(envelope.length, 70), sampleRate);
  const powderRatio = pdDiv(powderBed, powderTop);

  const shapeNoise = pdNoise(envelope.length);
  const shapeLow = pdLop(shapeNoise, pdConstant(envelope.length, 10), sampleRate);
  const shapeScaled = pdMulScalar(shapeLow, 17);
  const powderShape = pdAdd(pdMul(shapeScaled, shapeScaled), pdConstant(envelope.length, 0.5));

  const combined = pdMul(pdMul(crunchRatio, powderRatio), powderShape);
  const clipped = pdClip(combined, -1, 1);
  const brightened = pdHip(clipped, pdConstant(envelope.length, 300), sampleRate);
  const sweep = pdAdd(pdMulScalar(envelope, 9000), pdConstant(envelope.length, 700));
  const resonant = pdVcf(brightened, sweep, pdConstant(envelope.length, 0.5), sampleRate);
  return pdMulScalar(pdMul(resonant, envelope), 0.2);
}

function renderGrassTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const envelopeSquared = pdMul(envelope, envelope);
  const envelopeFourth = pdMul(envelopeSquared, envelopeSquared);
  const bodyFrequency = pdAdd(pdMulScalar(envelopeFourth, 600), pdConstant(envelope.length, 30));
  const bodyOsc = pdOsc(bodyFrequency, sampleRate);
  const body = pdMulScalar(
    pdMul(pdClip(bodyOsc, 0, 0.5), envelopeFourth),
    0.8,
  );

  const rustleNoise = pdNoise(envelope.length);
  const noiseLow16 = pdLop(rustleNoise, pdConstant(envelope.length, 16), sampleRate);
  const noiseLow300 = pdLop(rustleNoise, pdConstant(envelope.length, 300), sampleRate);
  const noiseLow2000 = pdLop(rustleNoise, pdConstant(envelope.length, 2000), sampleRate);
  const rustleRatio = pdDiv(noiseLow300, noiseLow2000);
  const rustleHigh = pdHip(rustleRatio, pdConstant(envelope.length, 2500), sampleRate);
  const rustleSquared = pdMul(rustleHigh, rustleHigh);
  const rustleFourth = pdMul(rustleSquared, rustleSquared);
  const rustleInput = pdClip(pdMulScalar(rustleFourth, 0.00001), -0.9, 0.9);
  const rustleSweep = pdClip(
    pdAdd(pdMulScalar(noiseLow16, 23800), pdConstant(envelope.length, 3400)),
    2000,
    10000,
  );
  const rustleFiltered = pdVcf(
    rustleInput,
    rustleSweep,
    pdConstant(envelope.length, 1),
    sampleRate,
  );
  const rustle = pdMul(
    pdMulScalar(pdHip(rustleFiltered, pdConstant(envelope.length, 900), sampleRate), 0.3),
    envelope,
  );

  return pdAdd(body, rustle);
}

function renderDirtTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const envelopeSquared = pdMul(envelope, envelope);
  const envelopeFourth = pdMul(envelopeSquared, envelopeSquared);
  const thudFrequency = pdAdd(pdMulScalar(envelopeFourth, 500), pdConstant(envelope.length, 40));
  const thud = pdMulScalar(pdMul(pdOsc(thudFrequency, sampleRate), envelopeFourth), 0.5);

  const dirtNoise = pdNoise(envelope.length);
  const dirtDriver = pdMul(
    pdAdd(envelope, pdConstant(envelope.length, 0.3)),
    pdMulScalar(pdLop(dirtNoise, pdConstant(envelope.length, 80), sampleRate), 70),
  );
  const gritFrequency = pdAdd(pdMulScalar(dirtDriver, 70), pdConstant(envelope.length, 70));
  const gritTone = pdOsc(gritFrequency, sampleRate);
  const grit = pdMulScalar(
    pdClip(pdHip(gritTone, pdConstant(envelope.length, 200), sampleRate), -1, 1),
    0.04,
  );

  return pdAdd(thud, grit);
}

function renderGravelTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const gravelNoise = pdNoise(envelope.length);
  const low300 = pdLop(gravelNoise, pdConstant(envelope.length, 300), sampleRate);
  const low2000 = pdLop(gravelNoise, pdConstant(envelope.length, 2000), sampleRate);
  const gritRatio = pdDiv(low300, low2000);
  const gritHigh = pdHip(gritRatio, pdConstant(envelope.length, 400), sampleRate);
  const gritSquared = pdMul(gritHigh, gritHigh);
  const gritInput = pdClip(pdMulScalar(gritSquared, 0.01), -0.9, 0.9);
  const gritSweep = pdClip(
    pdAdd(
      pdMulScalar(pdLop(gravelNoise, pdConstant(envelope.length, 50), sampleRate), 50000),
      pdMulScalar(envelope, 1000),
    ),
    500,
    10000,
  );
  const gritFiltered = pdVcf(
    gritInput,
    gritSweep,
    pdConstant(envelope.length, 3),
    sampleRate,
  );
  return pdMul(
    pdMulScalar(pdHip(gritFiltered, pdConstant(envelope.length, 200), sampleRate), 2),
    envelope,
  );
}

function renderMudTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const envelopeSquared = pdMul(envelope, envelope);
  const envelopeFourth = pdMul(envelopeSquared, envelopeSquared);

  const squelchNoise = pdNoise(envelope.length);
  const squelchLow = pdLop(squelchNoise, pdConstant(envelope.length, 70), sampleRate);
  const squelchMid = pdLop(squelchNoise, pdConstant(envelope.length, 260), sampleRate);
  const squelchRatio = pdDiv(squelchLow, squelchMid);
  const squelchSweep = pdClip(
    pdAdd(pdMulScalar(envelopeFourth, 900), pdConstant(envelope.length, 140)),
    90,
    2400,
  );
  const squelch = pdMul(
    pdMulScalar(
      pdVcf(
        pdClip(squelchRatio, -1, 1),
        squelchSweep,
        pdConstant(envelope.length, 0.6),
        sampleRate,
      ),
      0.6,
    ),
    envelope,
  );

  const bubbleFrequency = pdAdd(
    pdMulScalar(envelopeSquared, 700),
    pdConstant(envelope.length, 55),
  );
  const bubble = pdMulScalar(
    pdMul(pdOsc(bubbleFrequency, sampleRate), envelopeSquared),
    0.35,
  );

  const thudFrequency = pdAdd(
    pdMulScalar(envelopeFourth, 260),
    pdConstant(envelope.length, 34),
  );
  const thud = pdMulScalar(
    pdMul(pdOsc(thudFrequency, sampleRate), envelopeSquared),
    0.5,
  );

  return pdAdd(pdAdd(squelch, bubble), thud);
}

function renderWoodTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const envelopeSquared = pdMul(envelope, envelope);
  const envelopeFourth = pdMul(envelopeSquared, envelopeSquared);

  const knockFrequency = pdAdd(
    pdMulScalar(envelopeSquared, 320),
    pdConstant(envelope.length, 90),
  );
  const knock = pdMulScalar(pdMul(pdOsc(knockFrequency, sampleRate), envelopeSquared), 1.6);

  const clickNoise = pdNoise(envelope.length);
  const click = pdMulScalar(
    pdMul(pdHip(clickNoise, pdConstant(envelope.length, 2200), sampleRate), envelopeFourth),
    6,
  );

  const bodyNoise = pdLop(
    pdNoise(envelope.length),
    pdConstant(envelope.length, 180),
    sampleRate,
  );
  const body = pdMulScalar(pdMul(bodyNoise, envelopeSquared), 0.2);

  return pdAdd(pdAdd(knock, click), body);
}

function renderMetalTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const envelopeSquared = pdMul(envelope, envelope);

  const ringWobble = pdMulScalar(
    pdLop(pdNoise(envelope.length), pdConstant(envelope.length, 40), sampleRate),
    240,
  );
  const ringFrequency = pdAdd(
    pdAdd(pdMulScalar(envelopeSquared, 2600), pdConstant(envelope.length, 520)),
    ringWobble,
  );
  const ring = pdMulScalar(pdMul(pdOsc(ringFrequency, sampleRate), envelopeSquared), 0.5);

  const tingNoise = pdNoise(envelope.length);
  const ting = pdMulScalar(
    pdMul(pdHip(tingNoise, pdConstant(envelope.length, 3800), sampleRate), envelopeSquared),
    0.55,
  );

  const clankSweep = pdClip(
    pdAdd(pdMulScalar(envelope, 4200), pdConstant(envelope.length, 900)),
    700,
    8000,
  );
  const clank = pdMulScalar(
    pdVcf(pdClip(tingNoise, -1, 1), clankSweep, pdConstant(envelope.length, 2), sampleRate),
    0.34,
  );

  return pdAdd(pdAdd(ring, ting), clank);
}

function renderWaterTerrain(envelope: Float32Array, sampleRate: number): Float32Array {
  const envelopeSquared = pdMul(envelope, envelope);
  const envelopeFourth = pdMul(envelopeSquared, envelopeSquared);

  const splashNoise = pdNoise(envelope.length);
  const splashSweep = pdClip(
    pdAdd(pdMulScalar(envelope, 5200), pdConstant(envelope.length, 900)),
    600,
    9000,
  );
  const splash = pdMulScalar(
    pdMul(
      pdVcf(
        pdClip(splashNoise, -1, 1),
        splashSweep,
        pdConstant(envelope.length, 1.2),
        sampleRate,
      ),
      envelope,
    ),
    0.9,
  );

  const droplet = pdMulScalar(
    pdMul(
      pdHip(pdNoise(envelope.length), pdConstant(envelope.length, 2600), sampleRate),
      envelopeFourth,
    ),
    0.5,
  );

  const swell = pdMulScalar(
    pdMul(pdLop(splashNoise, pdConstant(envelope.length, 260), sampleRate), envelopeSquared),
    0.5,
  );

  return pdAdd(pdAdd(splash, droplet), swell);
}

function stepFn(threshold: number): (time: number) => number {
  return (time: number) => {
    if (time <= 0 || time >= 1) {
      return 0;
    }

    return -1.5 * (1 - time) * (threshold * time * time * time - threshold * time);
  };
}

function resizeFn(
  fn: (time: number) => number,
  inputStart: number,
  inputEnd: number,
  outputStart: number,
  outputEnd: number,
): (time: number) => number {
  return (time: number) => fn(
    ((time - outputStart) / (outputEnd - outputStart)) * (inputEnd - inputStart) + inputStart,
  );
}

function pdConstant(length: number, value: number): Float32Array {
  const signal = new Float32Array(length);
  signal.fill(value);
  return signal;
}

function pdNoise(length: number): Float32Array {
  const signal = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    signal[index] = randomSigned();
  }
  return signal;
}

function pdAdd(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    result[index] = (left[index] ?? 0) + (right[index] ?? 0);
  }
  return result;
}

function pdMul(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    result[index] = (left[index] ?? 0) * (right[index] ?? 0);
  }
  return result;
}

function pdMulScalar(signal: Float32Array, value: number): Float32Array {
  const result = new Float32Array(signal.length);
  for (let index = 0; index < signal.length; index += 1) {
    result[index] = (signal[index] ?? 0) * value;
  }
  return result;
}

function pdDiv(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    result[index] = (left[index] ?? 0) / (right[index] ?? 0);
  }
  return result;
}

function pdClip(signal: Float32Array, min: number, max: number): Float32Array {
  const result = new Float32Array(signal.length);
  for (let index = 0; index < signal.length; index += 1) {
    const sample = signal[index] ?? 0;
    if (Number.isNaN(sample)) {
      result[index] = 0;
    } else if (sample === Number.POSITIVE_INFINITY) {
      result[index] = max;
    } else if (sample === Number.NEGATIVE_INFINITY) {
      result[index] = min;
    } else if (sample > max) {
      result[index] = max;
    } else if (sample < min) {
      result[index] = min;
    } else {
      result[index] = sample;
    }
  }
  return result;
}

function pdOsc(frequencySignal: Float32Array, sampleRate: number): Float32Array {
  const result = new Float32Array(frequencySignal.length);
  const conversionFactor = (2 * Math.PI) / sampleRate;
  let phase = 0;

  for (let index = 0; index < frequencySignal.length; index += 1) {
    phase += (frequencySignal[index] ?? 0) * conversionFactor;
    while (phase >= Math.PI) {
      phase -= Math.PI * 2;
    }
    while (phase < -Math.PI) {
      phase += Math.PI * 2;
    }

    const tableIndex = ((phase + Math.PI) / (Math.PI * 2)) * PD_COSTABLE_SIZE;
    const indexFloor = Math.floor(tableIndex);
    const wrappedIndex = ((indexFloor % PD_COSTABLE_SIZE) + PD_COSTABLE_SIZE) % PD_COSTABLE_SIZE;
    const nextIndex = (wrappedIndex + 1) % PD_COSTABLE_SIZE;
    const fraction = tableIndex - indexFloor;
    const valueA = PD_COSTABLE[wrappedIndex] ?? 0;
    const valueB = PD_COSTABLE[nextIndex] ?? valueA;
    result[index] = valueA + fraction * (valueB - valueA);
  }

  return result;
}

function pdLop(signal: Float32Array, cutoffSignal: Float32Array, sampleRate: number): Float32Array {
  const result = new Float32Array(signal.length);
  const conversionFactor = (2 * Math.PI) / sampleRate;
  let last = signal[0] ?? 0;

  for (let index = 0; index < signal.length; index += 1) {
    let coefficient = (cutoffSignal[index] ?? 0) * conversionFactor;
    coefficient = clamp(coefficient, 0, 1);
    last = coefficient * (signal[index] ?? 0) + (1 - coefficient) * last;
    result[index] = last;
  }

  return result;
}

function pdHip(signal: Float32Array, cutoffSignal: Float32Array, sampleRate: number): Float32Array {
  const result = new Float32Array(signal.length);
  const conversionFactor = (2 * Math.PI) / sampleRate;
  let last = signal[0] ?? 0;

  for (let index = 0; index < signal.length; index += 1) {
    const frequency = cutoffSignal[index] ?? 0;
    let coefficient = 1 - frequency * conversionFactor;
    coefficient = clamp(coefficient, 0, 1);

    if (coefficient < 1) {
      const normal = 0.5 * (1 + coefficient);
      const current = (signal[index] ?? 0) + coefficient * last;
      result[index] = normal * (current - last);
      last = current;
    } else {
      result[index] = signal[index] ?? 0;
    }
  }

  return result;
}

function pdVcf(
  signal: Float32Array,
  resonanceFrequencySignal: Float32Array,
  qSignal: Float32Array,
  sampleRate: number,
): Float32Array {
  const result = new Float32Array(signal.length);
  const conversionFactor = (2 * Math.PI) / sampleRate;
  let real = 0;
  let imaginary = 0;

  for (let index = 0; index < signal.length; index += 1) {
    const q = qSignal[index] ?? 0;
    const qInverse = q > 0 ? 1 / q : 0;
    const amplitudeCorrection = 2 - 2 / (q + 2);
    const angularFrequency = Math.max(0, (resonanceFrequencySignal[index] ?? 0) * conversionFactor);
    let resonance = qInverse > 0 ? 1 - angularFrequency * qInverse : 0;
    resonance = Math.max(0, resonance);
    const oneMinusResonance = 1 - resonance;
    const coefficientReal = resonance * pdCosLookup(angularFrequency);
    const coefficientImaginary = resonance * pdSinLookup(angularFrequency);
    const previousReal = real;

    real = amplitudeCorrection * oneMinusResonance * (signal[index] ?? 0)
      + coefficientReal * previousReal
      - coefficientImaginary * imaginary;
    imaginary = coefficientImaginary * previousReal + coefficientReal * imaginary;

    if (Math.abs(real) < 0.0000000001) {
      real = 0;
    }
    if (Math.abs(imaginary) < 0.0000000001) {
      imaginary = 0;
    }

    result[index] = real;
  }

  return result;
}

function createPdCosTable(): Float32Array {
  const table = new Float32Array(PD_COSTABLE_SIZE + 1);
  for (let index = 0; index < PD_COSTABLE_SIZE; index += 1) {
    table[index] = Math.cos((2 * Math.PI * index) / PD_COSTABLE_SIZE);
  }
  table[0] = 1;
  table[PD_COSTABLE_SIZE] = 1;
  table[Math.floor(PD_COSTABLE_SIZE / 4)] = 0;
  table[Math.floor((3 * PD_COSTABLE_SIZE) / 4)] = 0;
  table[Math.floor(PD_COSTABLE_SIZE / 2)] = -1;
  return table;
}

function pdCosLookup(angle: number): number {
  const tableIndex = angle * (PD_COSTABLE_SIZE / 6.28318);
  const indexFloor = Math.floor(tableIndex);
  const wrappedIndex = ((indexFloor % PD_COSTABLE_SIZE) + PD_COSTABLE_SIZE) % PD_COSTABLE_SIZE;
  const nextIndex = wrappedIndex + 1;
  const fraction = tableIndex - indexFloor;
  const valueA = PD_COSTABLE[wrappedIndex] ?? 0;
  const valueB = PD_COSTABLE[nextIndex] ?? valueA;
  return valueA + fraction * (valueB - valueA);
}

function pdSinLookup(angle: number): number {
  const shiftedAngle = angle - Math.PI / 2;
  return pdCosLookup(shiftedAngle);
}

function resampleSignal(
  signal: Float32Array,
  fromSampleRate: number,
  toSampleRate: number,
): Float32Array {
  if (signal.length <= 1 || fromSampleRate === toSampleRate) {
    return signal;
  }

  const nextLength = Math.max(1, Math.round(signal.length * (toSampleRate / fromSampleRate)));
  const result = new Float32Array(nextLength);

  for (let index = 0; index < nextLength; index += 1) {
    const sourcePosition = (index / Math.max(nextLength - 1, 1)) * Math.max(signal.length - 1, 0);
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(signal.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    const leftValue = signal[leftIndex] ?? 0;
    const rightValue = signal[rightIndex] ?? leftValue;
    result[index] = leftValue + (rightValue - leftValue) * fraction;
  }

  return result;
}

function normalizedFrequency(value: number): number {
  return 32 * 2 ** (clamp(value, 0, 1) * 6.5);
}

function signedCurve(value: number): number {
  const clamped = clamp(value, -1, 1);
  return Math.sign(clamped) * Math.abs(clamped) ** 3;
}

function randomWaveform(): SfxWaveform {
  const waveforms: SfxWaveform[] = ['square', 'sawtooth', 'sine', 'noise'];
  return waveforms[Math.floor(rnd() * waveforms.length)] ?? 'square';
}

function randomRange(min: number, max: number): number {
  return min + rnd() * (max - min);
}

function randomSigned(): number {
  return rnd() * 2 - 1;
}

function isWaveform(value: unknown): value is SfxWaveform {
  return value === 'square' || value === 'sawtooth' || value === 'sine' || value === 'noise';
}

function isFootstepTerrain(value: unknown): value is SfxFootstepTerrain {
  return value === 'snow'
    || value === 'grass'
    || value === 'dirt'
    || value === 'gravel'
    || value === 'mud'
    || value === 'wood'
    || value === 'metal'
    || value === 'water';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
