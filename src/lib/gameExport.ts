import { encodeSfxWavBytes, renderSfx, type SfxBitDepth, type SfxParams, type SfxPresetId, type SfxSampleRate } from './sfx';
import { masterForExport, measurePeakDb } from './mastering';
import { PRESET_CATEGORIES } from './presetCatalog';
import { createZipArchive, type ZipEntry } from './zip';

export type SfxExportSettings = {
  /** Trim leading and trailing silence before encoding. */
  trimSilence: boolean;
  /** Peak target in dBFS, or null to leave the level alone. */
  targetPeakDb: number | null;
  /** Prepended to every exported file name, e.g. "ui_". */
  namePrefix: string;
};

export const DEFAULT_EXPORT_SETTINGS: SfxExportSettings = {
  trimSilence: false,
  targetPeakDb: null,
  namePrefix: '',
};

export const EXPORT_SETTINGS_VERSION = 1;

const MANIFEST_SCHEMA_VERSION = 1;
const GENERATOR_ID = 'afct-sfx-lab';

export type GameExportRequest = {
  name: string;
  presetId: SfxPresetId | null;
  params: SfxParams;
  sampleRate: SfxSampleRate;
  bitDepth: SfxBitDepth;
  /** The seed used when this take was generated, when one was recorded. */
  seed: number | null;
};

export type ManifestItem = {
  file: string;
  name: string;
  category: string;
  presetId: SfxPresetId | null;
  sampleRate: number;
  bitDepth: number;
  durationSeconds: number;
  peakDb: number;
  seed: number | null;
  params: SfxParams;
};

export type GameExportManifest = {
  schemaVersion: number;
  generator: string;
  exportedAt: string;
  items: ManifestItem[];
};

export function categoryForPreset(presetId: SfxPresetId | null): string {
  if (!presetId) return 'custom';
  const category = PRESET_CATEGORIES.find((entry) => entry.presets.includes(presetId));
  return category?.id ?? 'custom';
}

export function sanitizeFileStem(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\.\.+/g, '-')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || 'afct-sfx';
}

/**
 * Renders one take through the export mastering chain and packs it with every
 * other take plus a manifest, so a game project can import the folder as-is.
 */
export function collectGamePackage(
  requests: GameExportRequest[],
  settings: SfxExportSettings,
  options: { exportedAt?: Date } = {},
): Promise<{ entries: ZipEntry[]; manifest: GameExportManifest }> {
  const entries: ZipEntry[] = [];
  const items: ManifestItem[] = [];

  return Promise.all(
    requests.map(async (request, index) => {
      const rendered = renderSfx(request.params, {
        sampleRate: request.sampleRate,
        bitDepth: request.bitDepth,
      });

      const samples = masterForExport(rendered.samples, request.sampleRate, {
        trim: settings.trimSilence,
        targetPeakDb: settings.targetPeakDb,
      });

      const stem = `${settings.namePrefix}${sanitizeFileStem(request.name)}`;
      const file = `sfx/${categoryForPreset(request.presetId)}/${String(index + 1).padStart(2, '0')}-${stem}.wav`;
      entries.push({
        name: file,
        data: encodeSfxWavBytes(samples, request.sampleRate, request.bitDepth),
        lastModified: options.exportedAt,
      });

      items.push({
        file,
        name: request.name,
        category: categoryForPreset(request.presetId),
        presetId: request.presetId,
        sampleRate: request.sampleRate,
        bitDepth: request.bitDepth,
        durationSeconds: samples.length / request.sampleRate,
        peakDb: Math.round(measurePeakDb(samples) * 10) / 10,
        seed: request.seed,
        params: request.params,
      });
    }),
  ).then(() => {
    const manifest: GameExportManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      generator: GENERATOR_ID,
      exportedAt: (options.exportedAt ?? new Date()).toISOString(),
      items,
    };

    entries.push({
      name: 'manifest.json',
      data: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
      lastModified: options.exportedAt,
    });

    return { entries, manifest };
  });
}

/** Wraps {@link collectGamePackage} into the downloadable ZIP. */
export async function buildGamePackage(
  requests: GameExportRequest[],
  settings: SfxExportSettings,
  options: { exportedAt?: Date } = {},
): Promise<Blob> {
  const { entries } = await collectGamePackage(requests, settings, options);
  return createZipArchive(entries);
}
