import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SFX_PARAMS,
  SFX_PRESET_ORDER,
  createSfxPreset,
  deserializeSfxParams,
  encodeSfxWav,
  renderSfx,
} from './sfx';
import type { SfxFootstepTerrain, SfxPresetId } from './sfx';

describe('sfx renderer', () => {
  it('renders a bounded sample buffer with stats', () => {
    const rendered = renderSfx(
      {
        ...DEFAULT_SFX_PARAMS,
        waveform: 'square',
        sustain: 0.2,
        decay: 0.24,
        startFrequency: 0.78,
        slide: -0.25,
      },
      {
        sampleRate: 22050,
        bitDepth: 16,
      },
    );

    expect(rendered.samples.length).toBe(rendered.stats.samples);
    expect(rendered.samples.length).toBeGreaterThan(1000);
    expect(rendered.stats.durationSeconds).toBeGreaterThan(0.18);
    expect(rendered.stats.peak).toBeLessThanOrEqual(1);
    expect(rendered.stats.peak).toBeGreaterThan(0.05);
  });

  it('renders the footstep engine with terrain-specific output', () => {
    const rendered = renderSfx(
      {
        ...DEFAULT_SFX_PARAMS,
        engine: 'footsteppr',
        footstepTerrain: 'gravel',
        footstepHeel: 0.72,
        footstepRoll: 0.44,
        footstepBall: 0.52,
        footstepSwiftness: 0.58,
      },
      {
        sampleRate: 22050,
        bitDepth: 16,
      },
    );

    expect(rendered.samples.length).toBe(rendered.stats.samples);
    expect(rendered.samples.length).toBeGreaterThan(1500);
    expect(rendered.stats.durationSeconds).toBeGreaterThan(0.2);
    expect(rendered.stats.peak).toBeLessThanOrEqual(1);
    expect(rendered.stats.peak).toBeGreaterThan(0.02);
  });

  it('produces distinct buffers for different footstep terrains', () => {
    const snow = renderSfx(
      {
        ...DEFAULT_SFX_PARAMS,
        engine: 'footsteppr',
        footstepTerrain: 'snow',
        footstepHeel: 0.52,
        footstepRoll: 0.46,
        footstepBall: 0.41,
        footstepSwiftness: 0.63,
      },
      {
        sampleRate: 22050,
        bitDepth: 16,
      },
    );
    const gravel = renderSfx(
      {
        ...DEFAULT_SFX_PARAMS,
        engine: 'footsteppr',
        footstepTerrain: 'gravel',
        footstepHeel: 0.52,
        footstepRoll: 0.46,
        footstepBall: 0.41,
        footstepSwiftness: 0.63,
      },
      {
        sampleRate: 22050,
        bitDepth: 16,
      },
    );

    const difference = Array.from({ length: 256 }).reduce<number>((sum, _, index) => (
      sum + Math.abs((snow.samples[index] ?? 0) - (gravel.samples[index] ?? 0))
    ), 0);

    expect(difference).toBeGreaterThan(0.5);
  });

  it('serializes to a valid wav header', async () => {
    const wav = encodeSfxWav(Float32Array.from([0, -1, 1, 0.5]), 8000, 8);
    const bytes = new Uint8Array(await readBlobAsArrayBuffer(wav));
    const view = new DataView(bytes.buffer);

    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(8);
    expect(view.getUint32(40, true)).toBe(4);
  });

  it('clamps deserialized params into the supported range', () => {
    const params = deserializeSfxParams(
      JSON.stringify({
        waveform: 'noise',
        attack: 10,
        slide: -4,
        masterVolume: 2,
      }),
    );

    expect(params.waveform).toBe('noise');
    expect(params.attack).toBe(1);
    expect(params.slide).toBe(-1);
    expect(params.masterVolume).toBe(1);
  });
});

describe('preset catalog', () => {
  it('exposes 28 unique presets that all render bounded audio', () => {
    expect(SFX_PRESET_ORDER).toHaveLength(28);
    expect(new Set(SFX_PRESET_ORDER).size).toBe(SFX_PRESET_ORDER.length);

    for (const preset of SFX_PRESET_ORDER) {
      const rendered = renderSfx(createSfxPreset(preset), { sampleRate: 22050, bitDepth: 16 });

      expect(rendered.samples.length).toBe(rendered.stats.samples);
      expect(rendered.stats.samples).toBeGreaterThan(0);
      expect(rendered.stats.peak).toBeLessThanOrEqual(1);
      expect(rendered.stats.peak).toBeGreaterThan(0.001);

      for (let index = 0; index < rendered.samples.length; index += 97) {
        expect(Number.isFinite(rendered.samples[index] ?? 0)).toBe(true);
      }
    }
  });

  it('renders the new cinematic presets as long sweeps', () => {
    const cinematicPresets: SfxPresetId[] = ['whoosh', 'riser', 'impact', 'glitch'];

    for (const preset of cinematicPresets) {
      const rendered = renderSfx(createSfxPreset(preset), { sampleRate: 22050, bitDepth: 16 });
      expect(rendered.stats.durationSeconds).toBeGreaterThan(0.3);
    }

    expect(
      renderSfx(createSfxPreset('whoosh'), { sampleRate: 22050, bitDepth: 16 }).stats.durationSeconds,
    ).toBeGreaterThan(0.8);
    expect(
      renderSfx(createSfxPreset('riser'), { sampleRate: 22050, bitDepth: 16 }).stats.durationSeconds,
    ).toBeGreaterThan(0.8);
  });

  it('marks every footstep preset as the footsteppr engine with its own terrain', () => {
    const footstepTerrains: Array<[SfxPresetId, SfxFootstepTerrain]> = [
      ['footstepSnow', 'snow'],
      ['footstepGrass', 'grass'],
      ['footstepDirt', 'dirt'],
      ['footstepGravel', 'gravel'],
      ['footstepMud', 'mud'],
      ['footstepWood', 'wood'],
      ['footstepMetal', 'metal'],
      ['footstepWater', 'water'],
    ];

    for (const [preset, terrain] of footstepTerrains) {
      const params = createSfxPreset(preset);
      expect(params.engine).toBe('footsteppr');
      expect(params.footstepTerrain).toBe(terrain);
    }
  });

  it('renders all eight footstep terrains as distinct bounded output', () => {
    const terrains: SfxFootstepTerrain[] = [
      'snow',
      'grass',
      'dirt',
      'gravel',
      'mud',
      'wood',
      'metal',
      'water',
    ];
    const rendered = new Map<SfxFootstepTerrain, Float32Array>();

    for (const terrain of terrains) {
      const result = renderSfx(
        {
          ...DEFAULT_SFX_PARAMS,
          engine: 'footsteppr',
          footstepTerrain: terrain,
          footstepHeel: 0.55,
          footstepRoll: 0.55,
          footstepBall: 0.5,
          footstepSwiftness: 0.55,
        },
        { sampleRate: 22050, bitDepth: 16 },
      );

      expect(result.stats.peak).toBeLessThanOrEqual(1);
      expect(result.stats.peak).toBeGreaterThan(0.02);
      rendered.set(terrain, result.samples);
    }

    for (let left = 0; left < terrains.length; left += 1) {
      for (let right = left + 1; right < terrains.length; right += 1) {
        const leftSamples = rendered.get(terrains[left]) ?? new Float32Array();
        const rightSamples = rendered.get(terrains[right]) ?? new Float32Array();
        const difference = Array.from({ length: 512 }).reduce<number>((sum, _, index) => (
          sum + Math.abs((leftSamples[index] ?? 0) - (rightSamples[index] ?? 0))
        ), 0);

        expect(difference, `${terrains[left]} vs ${terrains[right]}`).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('fx integration', () => {
  it('normalizes the default preset to the peak ceiling without clipping', () => {
    const rendered = renderSfx(createSfxPreset('laserShoot'), { sampleRate: 22050, bitDepth: 16 });

    expect(rendered.stats.peak).toBeLessThanOrEqual(0.9951);
    expect(rendered.stats.clippedSamples).toBe(0);
  });

  it('still reports clipping when normalization is switched off', () => {
    const rendered = renderSfx(
      { ...DEFAULT_SFX_PARAMS, sustain: 0.6, masterVolume: 1, fxNormalize: 0 },
      { sampleRate: 22050, bitDepth: 16 },
    );

    expect(rendered.stats.clippedSamples).toBeGreaterThan(0);
    expect(rendered.stats.peak).toBe(1);
  });

  it('extends the buffer with an fx tail', () => {
    const dry = renderSfx(
      { ...DEFAULT_SFX_PARAMS, sustain: 0.2, decay: 0.2, fxDelayMix: 0, fxReverbMix: 0 },
      { sampleRate: 22050, bitDepth: 16 },
    );
    const wet = renderSfx(
      { ...DEFAULT_SFX_PARAMS, sustain: 0.2, decay: 0.2, fxDelayMix: 0.4, fxDelayFeedback: 0.5 },
      { sampleRate: 22050, bitDepth: 16 },
    );

    expect(wet.stats.samples).toBeGreaterThan(dry.stats.samples);
    expect(wet.stats.durationSeconds).toBeLessThanOrEqual(6);
    expect(wet.stats.peak).toBeLessThanOrEqual(0.9951);
  });

  it('gives cinematic presets an audible fx tail', () => {
    const whoosh = createSfxPreset('whoosh');
    const rendered = renderSfx(whoosh, { sampleRate: 22050, bitDepth: 16 });

    expect(whoosh.fxDelayMix).toBeGreaterThan(0);
    expect(whoosh.fxReverbMix).toBeGreaterThan(0);
    expect(rendered.stats.samples).toBeGreaterThan(
      Math.round(rendered.stats.durationSeconds * 0) + 22050 * 0.8,
    );
  });
});

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('failed to read blob'));
    };

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }

      reject(new Error('blob result is not ArrayBuffer'));
    };

    reader.readAsArrayBuffer(blob);
  });
}
