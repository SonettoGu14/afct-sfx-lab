/**
 * Export-only mastering helpers.
 *
 * The live preview and the readout keep the raw render, so what you hear while
 * designing stays untouched. These functions run on the way out, when a sound
 * is going into a game engine that expects trimmed, consistently loud clips.
 */

export type TrimOptions = {
  /** Anything quieter than this counts as silence. */
  thresholdDb?: number;
  /** Audio kept before the first transient, so an attack is never clipped. */
  keepMs?: number;
  /** Audio kept after the last audible sample, so a tail decay is not cut. */
  tailMs?: number;
};

export type TargetPeakOptions = {
  /** Target peak in dBFS, e.g. -3. Null disables the gain stage. */
  targetPeakDb?: number | null;
};

const DEFAULT_TRIM_THRESHOLD_DB = -60;
const DEFAULT_KEEP_MS = 5;
const DEFAULT_TAIL_MS = 20;
const MAX_TARGET_PEAK_DB = -0.1;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}

export function measurePeak(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index] ?? 0);
    if (value > peak) peak = value;
  }
  return peak;
}

export function measurePeakDb(samples: Float32Array): number {
  return gainToDb(measurePeak(samples));
}

export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  options: TrimOptions = {},
): Float32Array {
  const threshold = dbToGain(options.thresholdDb ?? DEFAULT_TRIM_THRESHOLD_DB);
  const keep = Math.max(0, Math.round(((options.keepMs ?? DEFAULT_KEEP_MS) / 1000) * sampleRate));
  const tail = Math.max(0, Math.round(((options.tailMs ?? DEFAULT_TAIL_MS) / 1000) * sampleRate));

  let first = -1;
  let last = -1;

  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index] ?? 0) >= threshold) {
      if (first === -1) first = index;
      last = index;
    }
  }

  if (first === -1) {
    return new Float32Array(0);
  }

  const start = Math.max(0, first - keep);
  const end = Math.min(samples.length, last + 1 + tail);

  return samples.slice(start, end);
}

/**
 * Scales the whole clip so its loudest sample sits at `targetPeakDb`.
 * This is a peak ceiling, not loudness normalization: quiet-by-design sounds
 * stay quiet relative to each other only if you pick different targets.
 */
export function applyTargetPeak(
  samples: Float32Array,
  targetPeakDb: number | null | undefined,
): Float32Array {
  if (targetPeakDb === null || targetPeakDb === undefined || !Number.isFinite(targetPeakDb)) {
    return samples;
  }

  const peak = measurePeak(samples);
  if (peak <= 0) {
    return samples;
  }

  const ceiling = dbToGain(Math.min(MAX_TARGET_PEAK_DB, targetPeakDb));
  const gain = ceiling / peak;
  const scaled = new Float32Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    scaled[index] = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
  }

  return scaled;
}

export type ExportMasteringOptions = TrimOptions & TargetPeakOptions & {
  trim?: boolean;
};

/** Applies the export pipeline: optional trim, then optional peak targeting. */
export function masterForExport(
  samples: Float32Array,
  sampleRate: number,
  options: ExportMasteringOptions = {},
): Float32Array {
  const trimmed = options.trim
    ? trimSilence(samples, sampleRate, {
      thresholdDb: options.thresholdDb,
      keepMs: options.keepMs,
      tailMs: options.tailMs,
    })
    : samples;

  return applyTargetPeak(trimmed, options.targetPeakDb);
}
