import { describe, expect, it } from 'vitest';
import { DEFAULT_SFX_PARAMS, createSfxPreset, type SfxParams, type SfxPresetId } from './sfx';
import {
  DEFAULT_EXPORT_SETTINGS,
  categoryForPreset,
  collectGamePackage,
  sanitizeFileStem,
  type GameExportRequest,
} from './gameExport';

const clickParams = createSfxPreset('click', DEFAULT_SFX_PARAMS, { seed: 12 });

function makeRequest(overrides: Partial<GameExportRequest> = {}): GameExportRequest {
  return {
    name: 'Click',
    presetId: 'click' as SfxPresetId,
    params: clickParams as SfxParams,
    sampleRate: 44100,
    bitDepth: 16,
    seed: 12,
    ...overrides,
  };
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe('game export package', () => {
  it('groups files by preset category and writes a manifest', async () => {
    const { entries, manifest } = await collectGamePackage(
      [makeRequest()],
      DEFAULT_EXPORT_SETTINGS,
      { exportedAt: new Date('2026-01-02T03:04:05Z') },
    );

    expect(entries.map((entry) => entry.name)).toEqual(['sfx/ui/01-Click.wav', 'manifest.json']);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generator).toBe('afct-sfx-lab');
    expect(manifest.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]).toMatchObject({
      file: 'sfx/ui/01-Click.wav',
      category: 'ui',
      presetId: 'click',
      sampleRate: 44100,
      bitDepth: 16,
      seed: 12,
    });
    expect(manifest.items[0]?.params).toEqual(clickParams);
  });

  it('writes a valid 44.1 kHz PCM wav inside the zip', async () => {
    const { entries } = await collectGamePackage([makeRequest()], DEFAULT_EXPORT_SETTINGS);
    const wav = entries[0]?.data as Uint8Array;

    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    const sampleRate = new DataView(wav.buffer, wav.byteOffset).getUint32(24, true);
    expect(sampleRate).toBe(44100);
    expect(wav.length).toBeGreaterThan(44);
  });

  it('applies the name prefix and the mastering chain', async () => {
    const { entries, manifest } = await collectGamePackage(
      [makeRequest()],
      { trimSilence: true, targetPeakDb: -3, namePrefix: 'ui_' },
    );

    expect(entries[0]?.name).toBe('sfx/ui/01-ui_Click.wav');
    expect(manifest.items[0]?.durationSeconds).toBeLessThan(2);
    expect(manifest.items[0]?.peakDb).toBeCloseTo(-3, 0);
  });

  it('keeps custom takes out of the preset folders', async () => {
    const { entries, manifest } = await collectGamePackage(
      [makeRequest({ name: 'Mine', presetId: null, params: { ...clickParams, waveform: 'sine' } })],
      DEFAULT_EXPORT_SETTINGS,
    );

    expect(categoryForPreset(null)).toBe('custom');
    expect(entries[0]?.name).toBe('sfx/custom/01-Mine.wav');
    expect(manifest.items[0]?.category).toBe('custom');
  });

  it('sanitises file names without letting them escape the folder', () => {
    expect(sanitizeFileStem('../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeFileStem('   ')).toBe('afct-sfx');
    expect(sanitizeFileStem('My Sound')).toBe('My-Sound');
  });
});
