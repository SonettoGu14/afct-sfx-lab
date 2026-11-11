import type { SfxPresetId } from './sfx';

export type PresetCategoryId = 'ui' | 'action' | 'cinematic' | 'footstep' | 'utility';

export type PresetCategory = {
  id: PresetCategoryId;
  presets: SfxPresetId[];
};

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    id: 'ui',
    presets: ['click', 'blipSelect', 'hoverTick', 'notifyPop', 'successChime', 'errorBuzz'],
  },
  {
    id: 'action',
    presets: ['pickupCoin', 'laserShoot', 'explosion', 'powerup', 'hitHurt', 'jump'],
  },
  {
    id: 'cinematic',
    presets: ['whoosh', 'riser', 'impact', 'glitch', 'synth', 'tone'],
  },
  {
    id: 'footstep',
    presets: [
      'footstepSnow',
      'footstepGrass',
      'footstepDirt',
      'footstepGravel',
      'footstepMud',
      'footstepWood',
      'footstepMetal',
      'footstepWater',
    ],
  },
  {
    id: 'utility',
    presets: ['random', 'mutate'],
  },
];

export const FOOTSTEP_PRESET_IDS: SfxPresetId[] =
  PRESET_CATEGORIES.find((category) => category.id === 'footstep')?.presets ?? [];

export const PRESET_IDS: SfxPresetId[] = PRESET_CATEGORIES.flatMap((category) => category.presets);

export function isPresetId(value: unknown): value is SfxPresetId {
  return typeof value === 'string' && PRESET_IDS.includes(value as SfxPresetId);
}

export function isFootstepPresetId(preset: SfxPresetId): boolean {
  return FOOTSTEP_PRESET_IDS.includes(preset);
}
