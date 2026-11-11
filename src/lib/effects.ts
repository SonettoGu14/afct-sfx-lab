import type { SfxParams, SfxSampleRate } from './sfx';

export const FX_PEAK_CEILING = 0.995;
export const FX_MAX_TAIL_SECONDS = 3;
export const FX_MAX_RENDER_SECONDS = 6;

const DELAY_MIN_SECONDS = 0.03;
const DELAY_MAX_SECONDS = 0.4;
const DELAY_MAX_FEEDBACK = 0.85;
const DELAY_DAMPING = 0.3;

const TONE_CUTOFF_HZ = 1000;
const TONE_AMOUNT = 0.9;

const REVERB_COMB_DELAYS_MS = [29.7, 37.1, 41.1, 43.7];
const REVERB_ALLPASS_DELAYS_MS = [5.0, 1.7];
const REVERB_ALLPASS_FEEDBACK = 0.5;
const REVERB_COMB_DAMPING = 0.35;
const REVERB_COMB_SPREAD = 0.25;

const CRUSH_MAX_HOLD_SAMPLES = 40;
const CRUSH_MIN_BITS = 2;

export function fxDelaySeconds(fxDelayTime: number): number {
  return DELAY_MIN_SECONDS + clampUnit(fxDelayTime) * (DELAY_MAX_SECONDS - DELAY_MIN_SECONDS);
}

/** Length of the echo/reverb tail that must be appended after the dry signal. */
export function fxTailSeconds(params: SfxParams): number {
  const delaySeconds = fxDelaySeconds(params.fxDelayTime);
  const delayTail = params.fxDelayMix > 0
    ? delaySeconds * (3 + clampUnit(params.fxDelayFeedback) * 4) * Math.min(1, clampUnit(params.fxDelayMix) * 2)
    : 0;
  const reverbTail = params.fxReverbMix > 0
    ? (0.35 + clampUnit(params.fxReverbSize) * 1.2) * Math.min(1, clampUnit(params.fxReverbMix) * 2)
    : 0;

  return Math.min(FX_MAX_TAIL_SECONDS, delayTail + reverbTail);
}

/** Soft saturation with makeup, blended against the dry signal. */
export function applyDrive(samples: Float32Array, amount: number): void {
  const wet = clampUnit(amount);
  if (wet <= 0) {
    return;
  }

  const gain = 1 + wet * 9;
  const normalizer = Math.tanh(gain);

  for (let index = 0; index < samples.length; index += 1) {
    const dry = samples[index] ?? 0;
    const shaped = Math.tanh(dry * gain) / normalizer;
    samples[index] = dry + (shaped - dry) * wet;
  }
}

/** Sample-and-hold decimation plus bit quantization. */
export function applyBitcrush(samples: Float32Array, rateAmount: number, bitsAmount: number): void {
  const hold = rateAmount > 0
    ? Math.max(1, Math.round(1 + clampUnit(rateAmount) * (CRUSH_MAX_HOLD_SAMPLES - 1)))
    : 1;
  const bits = bitsAmount > 0
    ? Math.max(CRUSH_MIN_BITS, Math.round(16 - clampUnit(bitsAmount) * 14))
    : 0;

  if (hold <= 1 && bits <= 0) {
    return;
  }

  const steps = bits > 0 ? 2 ** bits : 0;
  const halfSteps = steps / 2;
  let held = 0;

  for (let index = 0; index < samples.length; index += 1) {
    if (index % hold === 0) {
      const sample = samples[index] ?? 0;
      held = steps > 0 ? Math.round(sample * halfSteps) / halfSteps : sample;
    }

    samples[index] = held;
  }
}

/** One-knob tilt around 1 kHz: negative darkens, positive brightens. */
export function applyTone(samples: Float32Array, tilt: number, sampleRate: number): void {
  const amount = Math.max(-1, Math.min(1, tilt));
  if (Math.abs(amount) < 0.005) {
    return;
  }

  const alpha = 1 - Math.exp((-2 * Math.PI * TONE_CUTOFF_HZ) / sampleRate);
  let lowPassed = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    lowPassed += (sample - lowPassed) * alpha;
    const highBand = sample - lowPassed;
    samples[index] = sample + highBand * amount * TONE_AMOUNT;
  }
}

/** Feedback echo. The first repeat lands `timeSeconds` after the dry signal. */
export function applyDelay(
  samples: Float32Array,
  sampleRate: number,
  timeSeconds: number,
  feedback: number,
  mix: number,
): void {
  const wet = clampUnit(mix);
  if (wet <= 0) {
    return;
  }

  const delaySamples = Math.max(1, Math.round(timeSeconds * sampleRate));
  if (delaySamples >= samples.length) {
    return;
  }

  const buffer = new Float32Array(delaySamples);
  const feedbackAmount = Math.min(DELAY_MAX_FEEDBACK, Math.max(0, feedback));
  let writeIndex = 0;
  let dampingState = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const dry = samples[index] ?? 0;
    const echoed = buffer[writeIndex] ?? 0;
    dampingState = echoed * (1 - DELAY_DAMPING) + dampingState * DELAY_DAMPING;
    buffer[writeIndex] = dry + dampingState * feedbackAmount;
    samples[index] = dry + echoed * wet;
    writeIndex = (writeIndex + 1) % delaySamples;
  }
}

/** Small mono Schroeder reverb: four damped combs into two allpasses. */
export function applyReverb(
  samples: Float32Array,
  sampleRate: number,
  size: number,
  mix: number,
): void {
  const wet = clampUnit(mix);
  if (wet <= 0) {
    return;
  }

  const spread = 0.6 + clampUnit(size) * 0.8;
  const decay = 0.35 + clampUnit(size) * 0.6;

  const combs = REVERB_COMB_DELAYS_MS.map((milliseconds) => ({
    buffer: new Float32Array(
      Math.max(1, Math.round((milliseconds * spread * sampleRate) / 1000)),
    ),
    index: 0,
    dampingState: 0,
  }));
  const allpasses = REVERB_ALLPASS_DELAYS_MS.map((milliseconds) => ({
    buffer: new Float32Array(
      Math.max(1, Math.round((milliseconds * spread * sampleRate) / 1000)),
    ),
    index: 0,
  }));

  const wetSignal = new Float32Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const input = samples[index] ?? 0;
    let wetSum = 0;

    for (const comb of combs) {
      const delayed = comb.buffer[comb.index] ?? 0;
      comb.dampingState = delayed * (1 - REVERB_COMB_DAMPING)
        + comb.dampingState * REVERB_COMB_DAMPING;
      comb.buffer[comb.index] = input * REVERB_COMB_SPREAD + comb.dampingState * decay;
      comb.index = (comb.index + 1) % comb.buffer.length;
      wetSum += delayed;
    }

    let stage = wetSum / combs.length;

    for (const allpass of allpasses) {
      const delayed = allpass.buffer[allpass.index] ?? 0;
      const output = -stage + delayed;
      allpass.buffer[allpass.index] = stage + delayed * REVERB_ALLPASS_FEEDBACK;
      allpass.index = (allpass.index + 1) % allpass.buffer.length;
      stage = output;
    }

    wetSignal[index] = stage;
  }

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] ?? 0) + (wetSignal[index] ?? 0) * wet;
  }
}

/** Scales the whole buffer down only when it exceeds the ceiling. */
export function applyPeakCeiling(samples: Float32Array, ceiling = FX_PEAK_CEILING): void {
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const magnitude = Math.abs(samples[index] ?? 0);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  if (peak <= ceiling || peak === 0) {
    return;
  }

  const scale = ceiling / peak;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] ?? 0) * scale;
  }
}

/** Linear fade over the final milliseconds so exports never click. */
export function applyFadeOut(samples: Float32Array, sampleRate: number, milliseconds = 6): void {
  const count = Math.min(samples.length, Math.max(1, Math.round((sampleRate * milliseconds) / 1000)));
  const start = samples.length - count;

  for (let offset = 0; offset < count; offset += 1) {
    const gain = 1 - (offset + 1) / count;
    samples[start + offset] = (samples[start + offset] ?? 0) * gain;
  }
}

export function applyFxChain(
  samples: Float32Array,
  params: SfxParams,
  sampleRate: SfxSampleRate,
): void {
  applyDrive(samples, params.fxDrive);
  applyBitcrush(samples, params.fxCrushRate, params.fxCrushBits);
  applyTone(samples, params.fxTone, sampleRate);
  applyDelay(
    samples,
    sampleRate,
    fxDelaySeconds(params.fxDelayTime),
    params.fxDelayFeedback,
    params.fxDelayMix,
  );
  applyReverb(samples, sampleRate, params.fxReverbSize, params.fxReverbMix);

  if (params.fxNormalize >= 0.5) {
    applyPeakCeiling(samples, FX_PEAK_CEILING);
  }

  applyFadeOut(samples, sampleRate);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
